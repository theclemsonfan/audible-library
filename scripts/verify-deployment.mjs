// Read-only readiness probe. No user data or credentials are requested.
const url=new URL(process.argv[2]||'http://localhost:8787');
if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('Supply only the app origin');
if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('An external deployment must use HTTPS');
for(const [path,status]of[['/healthz',200],['/api/status',200],['/api/library',401],['/data/setup-key.txt',404],['/data/next-chapter.sqlite',404]]){
 const r=await fetch(url.origin+path,{redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status!==status)throw Error(`${path}: expected ${status}, received ${r.status}`);console.log('PASS',path,r.status);
}
console.log('Basic server reachability and access guards passed. Complete pairing and a real Audible sync next.');
