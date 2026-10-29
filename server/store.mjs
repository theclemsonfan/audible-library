import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash, randomBytes, timingSafeEqual, scryptSync} from 'node:crypto';
import {normalize, validateTask, mergeObservation, publicBook, fail} from './model.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64, {N: 32768, maxmem: 64*1024*1024}).toString('hex');
}
export function passwordMatches(password, encoded) {
  try { const actual = passwordHash(password, encoded.split(':')[0]); return timingSafeEqual(Buffer.from(actual), Buffer.from(encoded)); } catch { return false; }
}
export class Store {
  constructor(dir) {
    this.dir = dir; mkdirSync(dir, {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(join(dir, 'next-chapter.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, origin TEXT NOT NULL, created TEXT NOT NULL, last_seen TEXT, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pairings (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, device TEXT NOT NULL, started TEXT NOT NULL, completed TEXT, status TEXT NOT NULL, report TEXT);
      CREATE TABLE IF NOT EXISTS tasks (run_id TEXT NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, PRIMARY KEY(run_id,key), FOREIGN KEY(run_id) REFERENCES runs(id));
      CREATE TABLE IF NOT EXISTS pages (run_id TEXT NOT NULL, task TEXT NOT NULL, page INTEGER NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,task,page));
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS overrides (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (at TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL);
    `);
  }
  get(key) { const r = this.db.prepare('SELECT value FROM config WHERE key=?').get(key); return r ? JSON.parse(r.value) : null; }
  set(key, value) { this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  audit(event, detail = {}) { this.db.prepare('INSERT INTO audit VALUES (?,?,?)').run(new Date().toISOString(), event, JSON.stringify(detail)); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value=fn(); this.db.exec('COMMIT'); return value; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  createSession() { const value=secret(); this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); this.db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(value), Date.now()+14*86400000); return value; }
  hasSession(value) { return typeof value === 'string' && !!this.db.prepare('SELECT 1 FROM sessions WHERE digest=? AND expires>?').get(hash(value), Date.now()); }
  deleteSession(value) { if (value) this.db.prepare('DELETE FROM sessions WHERE digest=?').run(hash(value)); }
  pairing() { const code = randomBytes(10).toString('hex').toUpperCase(); this.db.prepare('DELETE FROM pairings WHERE expires<?').run(Date.now()); this.db.prepare('INSERT INTO pairings VALUES (?,?)').run(hash(code), Date.now()+600000); return code.match(/.{1,5}/g).join('-'); }
  claim(code, name, origin) {
    if (typeof code !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin || '')) fail('Invalid extension origin or pairing code');
    return this.transaction(() => {
      const digest=hash(code.replaceAll('-', '').toUpperCase());
      if (!this.db.prepare('DELETE FROM pairings WHERE digest=? AND expires>? RETURNING digest').get(digest, Date.now())) fail('Pairing code expired or already used', 401);
      const token='nc_sync_'+secret(), id=randomBytes(12).toString('hex');
      this.db.prepare('INSERT INTO devices(id,name,digest,origin,created) VALUES (?,?,?,?,?)').run(id, String(name || 'Desktop browser').slice(0,100), hash(token), origin, new Date().toISOString());
      this.audit('device_paired', {id}); return {token, deviceId:id};
    });
  }
  device(token, origin) {
    if (typeof token !== 'string') return null;
    const d=this.db.prepare('SELECT * FROM devices WHERE digest=? AND origin=? AND revoked=0').get(hash(token), origin || '');
    if (d) this.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(new Date().toISOString(), d.id);
    return d;
  }
  startRun(id, device, tasks) {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail('Invalid run identifier');
    if (!Array.isArray(tasks) || !tasks.some(t=>t.source==='library') || tasks.length>600) fail('Library scan is required');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
      if (old && old.device!==device) fail('Run belongs to another device',403);
      if (old) return {id,status:old.status};
      const active=this.db.prepare("SELECT id FROM runs WHERE status='running' AND id<>?").get(id);
      if (active) fail('Another browser has an unfinished sync; stop it in Sync settings first',409);
      this.db.prepare("INSERT INTO runs(id,device,started,status) VALUES (?,?,?,'running')").run(id,device,new Date().toISOString());
      for (const t of tasks) this.addTask(id,t);
      return {id,status:'running'};
    });
  }
  ownedRun(id,device) { const r=this.db.prepare('SELECT * FROM runs WHERE id=? AND device=?').get(id,device); if(!r) fail('Sync not found',404); return r; }
  addTask(id, task) { const t=validateTask(task); this.db.prepare('INSERT OR IGNORE INTO tasks(run_id,key,source,scope) VALUES (?,?,?,?)').run(id,t.key,t.source,t.scope); }
  page(id,device,input) {
    if(this.ownedRun(id,device).status!=='running') fail('Run is not accepting pages',409);
    const t=this.db.prepare('SELECT * FROM tasks WHERE run_id=? AND key=?').get(id,input.task);
    if(!t) fail('Unknown scan task');
    if(!Number.isInteger(input.page)||input.page<1||input.page>500||typeof input.hasNext!=='boolean'||!Array.isArray(input.items)||input.items.length>200) fail('Invalid page');
    const items=input.items.map(x=>normalize(x,t.source));
    const payload={items,hasNext:input.hasNext,expectedPages:Number.isInteger(input.expectedPages)?input.expectedPages:null};
    const raw=JSON.stringify(payload), digest=hash(raw);
    return this.transaction(()=>{
      const prior=this.db.prepare('SELECT digest FROM pages WHERE run_id=? AND task=? AND page=?').get(id,input.task,input.page);
      if(prior) { if(prior.digest!==digest) fail('Page contents changed; restart this scan',409); return {accepted:true,replayed:true}; }
      if(t.status!=='pending') fail('Task has already ended',409);
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM pages WHERE run_id=? AND task=?').get(id,input.task).n;
      if(input.page!==count+1) fail('Out-of-order page',409);
      if(t.source==='library') {
        if(!items.length) fail('Empty library scan rejected; existing library retained');
        const ids=new Set();
        for (const r of this.db.prepare('SELECT payload FROM pages WHERE run_id=? AND task=?').all(id,input.task)) for(const i of JSON.parse(r.payload).items) ids.add(i.id);
        for(const i of items) { if(ids.has(i.id)) fail('Repeated library product across pages; restart to avoid an incomplete scan',409); ids.add(i.id); }
      }
      const first=this.db.prepare('SELECT payload FROM pages WHERE run_id=? AND task=? AND page=1').get(id,input.task);
      const initiallyExpected=first?JSON.parse(first.payload).expectedPages:null;
      if(initiallyExpected!=null && payload.expectedPages!=null && initiallyExpected!==payload.expectedPages) fail('Pagination total changed during collection; restart the scan',409);
      if(!input.hasNext && payload.expectedPages!=null && input.page!==payload.expectedPages) fail('Page total does not match final page',409);
      this.db.prepare('INSERT INTO pages VALUES (?,?,?,?,?)').run(id,input.task,input.page,digest,raw);
      if(!input.hasNext) this.db.prepare("UPDATE tasks SET status='complete' WHERE run_id=? AND key=?").run(id,input.task);
      return {accepted:true,replayed:false};
    });
  }
  skip(id,device,key,error) {
    if(this.ownedRun(id,device).status!=='running') fail('Run has ended',409);
    const task=this.db.prepare('SELECT * FROM tasks WHERE run_id=? AND key=?').get(id,key);
    if(!task||task.source==='library') fail('Library collection may not be skipped');
    this.db.prepare("UPDATE tasks SET status='skipped',error=? WHERE run_id=? AND key=?").run(String(error).slice(0,300),id,key);
  }
  finish(id,device) {
    const run=this.ownedRun(id,device);
    if(run.status==='complete') return JSON.parse(run.report);
    if(run.status!=='running') fail('Run has ended',409);
    const tasks=this.db.prepare('SELECT * FROM tasks WHERE run_id=?').all(id);
    if(!tasks.length || tasks.some(t=>t.status==='pending')) fail('Scan tasks are incomplete',409);
    if(!tasks.some(t=>t.source==='library'&&t.status==='complete')) fail('Library scan was not completed',409);
    const now=new Date().toISOString();
    const rows=this.db.prepare('SELECT * FROM pages WHERE run_id=? ORDER BY task,page').all(id);
    const libraryIds=new Set(rows.filter(r=>tasks.find(t=>t.key===r.task)?.source==='library').flatMap(r=>JSON.parse(r.payload).items.map(i=>i.id)));
    const previous=this.libraryRaw();
    const previousCount=previous.filter(b=>b.inLibrary&&!b.notSeenInLatest).length;
    if(previousCount>=20&&libraryIds.size<previousCount*0.70) fail('Library count fell by more than 30%; prior library preserved. Review account and coverage before resetting the baseline.',409);
    this.backup();
    const report={runId:id,completedAt:now,libraryCount:libraryIds.size,pages:rows.length,archiveCoverage:'unverified',listeningCoverage:'recent web history only',
      tasks:tasks.map(({key,source,scope,status,error})=>({key,source,scope,status,error})),warnings:tasks.filter(t=>t.status==='skipped').map(t=>`${t.key}: ${t.error}`)};
    return this.transaction(()=>{
      const map=new Map(previous.map(b=>[b.id,{...b,notSeenInLatest:b.inLibrary&&!libraryIds.has(b.id)?true:b.notSeenInLatest}]));
      // Preserve purchases/history already captured in earlier runs. Failed task pages are not merged.
      const order=['catalog','purchases','refunds','listens','library'];
      for(const source of order) for(const row of rows) {
        const task=tasks.find(t=>t.key===row.task);
        if(task.source!==source||task.status!=='complete') continue;
        for(const item of JSON.parse(row.payload).items) map.set(item.id,mergeObservation(map.get(item.id),item,source,now));
      }
      const save=this.db.prepare('INSERT INTO books VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body');
      for(const b of map.values()) save.run(b.id,JSON.stringify(b));
      this.db.prepare("UPDATE runs SET status='complete',completed=?,report=? WHERE id=?").run(now,JSON.stringify(report),id);
      this.set('lastSync',report); this.audit('sync_completed',{id,books:libraryIds.size,pages:rows.length});
      // Keep resumable runs and 10 recent completed runs; book evidence remains in books.
      this.db.prepare("DELETE FROM pages WHERE run_id IN (SELECT id FROM runs WHERE status='complete' ORDER BY completed DESC LIMIT -1 OFFSET 10)").run();
      return report;
    });
  }
  libraryRaw() { return this.db.prepare('SELECT body FROM books').all().map(r=>JSON.parse(r.body)); }
  library() { const overrides=new Map(this.db.prepare('SELECT * FROM overrides').all().map(r=>[r.id,JSON.parse(r.body)])); return this.libraryRaw().map(b=>publicBook(b,overrides.get(b.id))); }
  backup() {
    if(!this.db.prepare('SELECT 1 FROM books LIMIT 1').get()) return null;
    const dir=join(this.dir,'backups'); mkdirSync(dir,{recursive:true,mode:0o700});
    const name='next-chapter-'+new Date().toISOString().replaceAll(':','-')+'-'+randomBytes(3).toString('hex')+'.sqlite';
    this.db.prepare('VACUUM INTO ?').run(join(dir,name));
    const old=readdirSync(dir).filter(x=>x.endsWith('.sqlite')).sort().slice(0,-10);
    for(const file of old) unlinkSync(join(dir,file));
    return name;
  }
  close() { this.db.close(); }
}
