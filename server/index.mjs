import http from 'node:http';
import {readFileSync, existsSync, writeFileSync, unlinkSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store, secret, hash, passwordHash, passwordMatches} from './store.mjs';
import {fail, asin, text} from './model.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
export function createApp({dataDir=process.env.DATA_DIR||join(root,'data'),publicUrl=process.env.PUBLIC_URL||'http://localhost:8787',setupToken=process.env.SETUP_TOKEN}={}) {
  const origin=new URL(publicUrl).origin, secure=origin.startsWith('https:');
  if(!secure&&!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Use HTTPS for any non-loopback deployment');
  const store=new Store(dataDir);
  const keyPath=join(dataDir,'setup-key.txt');
  if(!store.get('passwordHash')) {
    if(!setupToken) setupToken=existsSync(keyPath)?readFileSync(keyPath,'utf8').trim():secret();
    if(setupToken.length<24) throw Error('Setup token must contain at least 24 characters');
    writeFileSync(keyPath,setupToken+'\n',{mode:0o600});
    store.set('setupDigest',hash(setupToken));
  }
  const attempts=new Map();
  function limit(key,max=10,span=600000) { const now=Date.now(); let a=attempts.get(key); if(!a||a.reset<now) a={n:0,reset:now+span}; a.n++; attempts.set(key,a); if(a.n>max) fail('Too many attempts. Try again in ten minutes.',429); if(attempts.size>10000) for(const [k,v] of attempts) if(v.reset<now) attempts.delete(k); }
  const sessionOf=req=>{ const m=(req.headers.cookie||'').match(/(?:^|;\s*)nc_session=([^;]+)/); return m?.[1]; };
  const cookie=value=>`nc_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value?14*86400:0}${secure?'; Secure':''}`;
  function requireSession(req) { if(!store.hasSession(sessionOf(req))) fail('Sign in to Next Chapter',401); }
  function checkOrigin(req) { if(req.headers.origin!==origin) fail('Request origin rejected',403); }
  function extensionOrigin(req) { const id=req.headers['x-next-chapter-extension']; const declared=/^[a-p]{32}$/.test(id||'')?'chrome-extension://'+id:null; const actual=req.headers.origin; return actual ? (/^chrome-extension:\/\/[a-p]{32}$/.test(actual)&&(!declared||declared===actual)?actual:null) : declared; }
  function requireDevice(req) { const token=req.headers.authorization?.match(/^Bearer (nc_sync_[A-Za-z0-9_-]{43})$/)?.[1]; const d=store.device(token,extensionOrigin(req)); if(!d) fail('Extension is not paired or access was revoked',401); return d; }
  async function body(req,max=1024*1024) {
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) fail('JSON required',415);
    const chunks=[];let size=0;
    for await(const chunk of req) { size+=chunk.length;if(size>max) fail('Request too large',413);chunks.push(chunk); }
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Invalid JSON');}
  }
  function send(res,status,obj,headers={}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj)); }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://m.media-amazon.com https://images-na.ssl-images-amazon.com https://images-eu.ssl-images-amazon.com https://images-audible-com.ssl-images-amazon.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const u=new URL(req.url,origin),path=u.pathname,method=req.method;
      const permittedHosts=new Set([new URL(origin).host,...(!secure?['localhost:'+new URL(origin).port,'127.0.0.1:'+new URL(origin).port]:[])]);
      if(!permittedHosts.has(req.headers.host)) fail('Unexpected host',403);
      // Extension requests carry an import-only token and are bound to their exact origin.
      const extensionRequest=/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin||'');
      if(extensionRequest && (path.startsWith('/api/sync/')||path==='/api/pairings/claim'||path==='/api/extension/status')) {
        res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Next-Chapter-Extension');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
        if(method==='OPTIONS'){res.writeHead(204);res.end();return;}
      }
      if(path==='/healthz'&&method==='GET') return send(res,200,{ok:true,version:'0.2.0'});
      if(path==='/api/status'&&method==='GET') return send(res,200,{setupRequired:!store.get('passwordHash'),signedIn:store.hasSession(sessionOf(req)),version:'0.2.0'});
      if(path==='/api/setup'&&method==='POST') {
        checkOrigin(req);limit('setup:'+req.socket.remoteAddress,5); const b=await body(req,4096);
        if(store.get('passwordHash'))fail('Already configured',409);
        if(typeof b.token!=='string'||hash(b.token)!==store.get('setupDigest'))fail('Setup key is incorrect',401);
        if(typeof b.password!=='string'||b.password.length<12||b.password.length>256)fail('Choose a password of 12–256 characters');
        store.transaction(()=>{store.set('passwordHash',passwordHash(b.password));store.set('setupDigest',null);store.audit('account_initialized');});
        if(existsSync(keyPath))unlinkSync(keyPath);
        return send(res,200,{ok:true},{'Set-Cookie':cookie(store.createSession())});
      }
      if(path==='/api/login'&&method==='POST') {
        checkOrigin(req);limit('login:'+req.socket.remoteAddress,8);const b=await body(req,4096);
        if(typeof b.password!=='string'||b.password.length>256||!store.get('passwordHash')||!passwordMatches(b.password,store.get('passwordHash')))fail('Incorrect password',401);
        return send(res,200,{ok:true},{'Set-Cookie':cookie(store.createSession())});
      }
      if(path==='/api/logout'&&method==='POST'){requireSession(req);checkOrigin(req);store.deleteSession(sessionOf(req));return send(res,200,{ok:true},{'Set-Cookie':cookie('')});}
      if(path==='/api/pairings/claim'&&method==='POST') {
        limit('pair:'+req.socket.remoteAddress,10);const b=await body(req,4096);
        return send(res,200,{...store.claim(b.code,b.name,extensionOrigin(req)),version:'0.2.0'});
      }
      if(path.startsWith('/api/sync/')||path==='/api/extension/status') {
        const device=requireDevice(req);
        if(path==='/api/extension/status'&&method==='GET') return send(res,200,{ok:true,deviceName:device.name,lastSync:store.get('lastSync'),version:'0.2.0'});
        if(method!=='POST')fail('Method not allowed',405);
        const b=await body(req);
        if(path==='/api/sync/runs')return send(res,200,store.startRun(b.id,device.id,b.tasks));
        const match=path.match(/^\/api\/sync\/runs\/([a-f0-9-]{36})\/(tasks|pages|skip|finish|abort)$/);
        if(!match)fail('Not found',404);
        const [,id,action]=match,run=store.ownedRun(id,device.id);
        if(action==='tasks') {
          if(run.status!=='running')fail('Run has ended',409);
          if(!Array.isArray(b.tasks)||b.tasks.length>500)fail('Invalid tasks');
          if(store.db.prepare('SELECT COUNT(*) n FROM tasks WHERE run_id=?').get(id).n+b.tasks.length>600)fail('Task safety limit exceeded');
          store.transaction(()=>{for(const t of b.tasks)store.addTask(id,t);});return send(res,200,{ok:true});
        }
        if(action==='pages')return send(res,200,store.page(id,device.id,b));
        if(action==='skip'){store.skip(id,device.id,b.task,b.error);return send(res,200,{ok:true});}
        if(action==='finish')return send(res,200,store.finish(id,device.id));
        if(action==='abort'){if(run.status==='running')store.db.prepare("UPDATE runs SET status='aborted',report=? WHERE id=?").run(JSON.stringify({error:String(b.error||'Stopped').slice(0,300)}),id);return send(res,200,{ok:true});}
      }
      if(path.startsWith('/api/')) {
        requireSession(req);if(!['GET','HEAD'].includes(method))checkOrigin(req);
        if(path==='/api/library'&&method==='GET')return send(res,200,{books:store.library(),lastSync:store.get('lastSync')});
        if(path==='/api/pairings'&&method==='POST')return send(res,200,{appUrl:origin,code:store.pairing(),expiresInSeconds:600});
        if(path==='/api/devices'&&method==='GET')return send(res,200,{devices:store.db.prepare('SELECT id,name,created,last_seen,revoked FROM devices').all()});
        if(/^\/api\/devices\/[a-f0-9]{24}\/revoke$/.test(path)&&method==='POST') {
          const id=path.split('/')[3];store.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id);store.audit('device_revoked',{id});return send(res,200,{ok:true});
        }
        if(path==='/api/runs'&&method==='GET')return send(res,200,{runs:store.db.prepare('SELECT id,started,completed,status,report FROM runs ORDER BY started DESC LIMIT 20').all().map(r=>({...r,report:r.report?JSON.parse(r.report):null}))});
        if(/^\/api\/runs\/[a-f0-9-]{36}\/abort$/.test(path)&&method==='POST'){store.db.prepare("UPDATE runs SET status='aborted' WHERE id=? AND status='running'").run(path.split('/')[3]);return send(res,200,{ok:true});}
        if(/^\/api\/books\/[A-Z0-9]{10}$/.test(path)&&method==='PATCH') {
          const id=asin(path.split('/')[3]),b=await body(req,12000);
          if(!store.db.prepare('SELECT 1 FROM books WHERE id=?').get(id))fail('Book not found',404);
          if(b.finished!==null&&typeof b.finished!=='boolean')fail('Invalid completion override');
          const value={finished:b.finished,notes:text(b.notes,5000)||'',favorite:!!b.favorite};
          store.db.prepare('INSERT INTO overrides VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(value));return send(res,200,{ok:true});
        }
        if(path==='/api/export'&&method==='GET')return send(res,200,{schemaVersion:2,exportedAt:new Date().toISOString(),books:store.library(),lastSync:store.get('lastSync')},{'Content-Disposition':'attachment; filename="next-chapter-library.json"'});
        if(path==='/api/backup'&&method==='POST')return send(res,200,{file:store.backup(),note:'Stored on the server in the private data/backups directory'});
        fail('Not found',404);
      }
      if(method!=='GET'&&method!=='HEAD')fail('Method not allowed',405);
      // Explicit allowlist: configuration, SQLite and extension secrets are never served.
      const allowed=new Set(['index.html','app.js','model.js','style.css','manifest.webmanifest','icon.svg','sw.js','help.html','help.js','help.css']);
      const name=path==='/'?'index.html':path.slice(1);
      if(!allowed.has(name))fail('Not found',404);
      const file=join(root,'app',name);if(!existsSync(file))fail('Not found',404);
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(method==='HEAD'?undefined:readFileSync(file));
    }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'Server error; see the server log'});if(!e.status)console.error('Request failed:',e.name,e.message);}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,store,origin,setupToken};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp();const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
  app.server.listen(port,host,()=>{console.log(`Next Chapter 0.2.0 is listening on ${host}:${port}\nApp URL: ${app.origin}`);if(!app.store.get('passwordHash'))console.log('First-time setup: use the key in data/setup-key.txt (or your SETUP_TOKEN).');});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.store.close();process.exit(0);}));
}
