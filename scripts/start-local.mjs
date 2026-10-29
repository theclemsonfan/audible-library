import {spawn} from 'node:child_process';import {existsSync,readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {resolve,join} from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<16)){console.error('Install Node.js 24 LTS from nodejs.org, then run this launcher again.');process.exit(1);}
const port=8787,origin='http://localhost:'+port;
try{const r=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok){const b=await r.json();if(b.version)throw Object.assign(Error('Next Chapter is already running. Open '+origin),{already:true});}}catch(e){if(e.already){console.log(e.message);process.exit(0);}}
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_URL:origin,DATA_DIR:join(root,'data')},stdio:'inherit'});
child.on('error',e=>{console.error('Could not start:',e.message);process.exitCode=1;});
let ready=false;
for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));try{const r=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;}
if(!ready){console.error('Server did not start. Check whether port 8787 is already in use.');child.kill();process.exitCode=1;}
else{
  const key=join(root,'data','setup-key.txt'),url=origin+(existsSync(key)?'/#setup='+encodeURIComponent(readFileSync(key,'utf8').trim()):'/');
  console.log('\nLocal desktop mode. Keep this window open while syncing.\nPhone-away-from-home access requires HTTPS deployment; see START_HERE.html.\n');
  const command=process.platform==='win32'?'cmd':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['/c','start','',url]:[url];
  const opener=spawn(command,args,{stdio:'ignore'});opener.on('error',()=>console.log('Open '+origin+' in your desktop browser.'));
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
