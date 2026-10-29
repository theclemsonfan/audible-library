import {readdirSync,readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
let checked=0;
for(const dir of ['server','app','extension','scripts','tests'])for(const name of readdirSync(dir))if(/\.(?:mjs|js)$/.test(name)){
 const r=spawnSync(process.execPath,['--check',join(dir,name)],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exit(1);}checked++;
}
for(const file of ['package.json','extension/manifest.json','app/manifest.webmanifest'])JSON.parse(readFileSync(file,'utf8'));
const manifest=JSON.parse(readFileSync('extension/manifest.json','utf8'));
for(const p of ['cookies','webRequest','debugger','nativeMessaging','unlimitedStorage'])if(manifest.permissions.includes(p))throw Error('Unexpected powerful permission: '+p);
for(const file of ['extension/'+manifest.background.service_worker,'extension/'+manifest.action.default_popup,'server/index.mjs','app/index.html','Dockerfile','compose.yaml'])if(!existsSync(file))throw Error('Missing release file '+file);
console.log(`PASS: ${checked} JavaScript files parsed, JSON validated, release entry points present, extension permission guard passed.`);
