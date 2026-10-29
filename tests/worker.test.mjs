// Runs the actual background worker logic with a simulated Chrome API and a real local HTTP backend.
// Extractor results come from the separate rendered synthetic-DOM checks, not a live Audible account.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {webcrypto} from 'node:crypto';import {createApp} from '../server/index.mjs';import * as core from '../extension/core.js';import {gunzipSync} from 'node:zlib';
const ROOT=new URL('..',import.meta.url),fixtures=JSON.parse(gunzipSync(readFileSync(new URL('tests/fixtures/parser-results.json.gz',ROOT))).toString('utf8'));
const EXT='a'.repeat(32),ORIGIN='http://localhost:18789',extensionOrigin='chrome-extension://'+EXT;
let app,cookie;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test.before(async()=>{app=createApp({dataDir:mkdtempSync(join(tmpdir(),'nc-worker-')),publicUrl:ORIGIN,setupToken:'test-worker-setup-key-not-private-0001'});await new Promise(r=>app.server.listen(18789,'127.0.0.1',r));const r=await fetch(ORIGIN+'/api/setup',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token:'test-worker-setup-key-not-private-0001',password:'test-worker-password-123'})});cookie=r.headers.get('set-cookie').split(';')[0];});
test.after(async()=>{await new Promise(r=>app.server.close(r));app.store.close();rmSync(app.store.dir,{recursive:true,force:true});});
async function admin(path,body){return (await fetch(ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})).json();}
function event(){const handlers=[];return {addListener:fn=>handlers.push(fn),emit:(...args)=>handlers.forEach(fn=>fn(...args)),handlers};}
function harness(existing){
  const memory=existing?.memory||{},tabs=existing?.tabs||new Map(),alarms=existing?.alarms||new Map(),loads=[],apiCalls=[];
  let fault=null,seq=tabs.size+1;
  const clone=value=>structuredClone(value);
  const changed=event(),updated=event();
  const chrome={runtime:{id:EXT,getURL:path=>extensionOrigin+'/'+path,onMessage:event(),onInstalled:event(),onStartup:event()},
    storage:{onChanged:changed,local:{get:async keys=>{if(typeof keys==='string')keys=[keys];return Object.fromEntries(keys.map(k=>[k,clone(memory[k])]));},set:async object=>{Object.assign(memory,clone(object));changed.emit({});},remove:async keys=>{for(const k of keys)delete memory[k];},setAccessLevel:async()=>{}}},
    tabs:{onUpdated:updated,create:async({url,active})=>{const t={id:seq++,url,status:'complete',active};tabs.set(t.id,t);loads.push(url);return clone(t);},get:async id=>{if(!tabs.has(id))throw Error('Tab closed');return clone(tabs.get(id));},update:async(id,options)=>{if(!tabs.has(id))throw Error('Tab closed');Object.assign(tabs.get(id),options);if(options.url)loads.push(options.url);return clone(tabs.get(id));},remove:async id=>tabs.delete(id)},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    permissions:{contains:async()=>true},
    alarms:{get:async name=>alarms.get(name),create:async(name,spec)=>{alarms.set(name,{name,...spec});},clear:async name=>alarms.delete(name),onAlarm:event()},
    scripting:{executeScript:async options=>{if(options.files)return [];const tab=tabs.get(options.target.tabId);if(fault==='verify')return [{result:{ok:false,code:'VERIFY_REQUIRED',error:'Synthetic verification requested'}}];const data=Object.entries(fixtures).find(([u,v])=>v.ok&&core.safeAudibleUrl(u)===core.safeAudibleUrl(tab.url))?.[1];if(!data)throw Error('Missing synthetic fixture for '+tab.url);return [{result:clone(data)}];}}
  };
  const wrappedFetch=(url,options)=>{apiCalls.push(url);if(fault==='network')throw Error('Synthetic server outage');return fetch(url,{...options,headers:{...options.headers,Origin:extensionOrigin}});};
  const ctx=vm.createContext({chrome,crypto:webcrypto,URL,URLSearchParams,AbortSignal,structuredClone,console,...core,fetch:wrappedFetch,setTimeout:fn=>setTimeout(fn,0),clearTimeout});
  const code=readFileSync(new URL('extension/background.js',ROOT),'utf8').replace(/^import[^\n]+\n/,'');vm.runInContext(code,ctx);
  const command=m=>ctx.message(m,{id:EXT,url:extensionOrigin+'/popup.html'});
  async function drive(max=100){for(let i=0;i<max;i++){await ctx.tick();if(!memory.job)return;if(memory.job.status==='paused')return;}}
  return {memory,tabs,alarms,loads,apiCalls,chrome,ctx,command,drive,setFault:value=>fault=value};
}
let h;
test('worker pairs with real backend using one-time code',async()=>{h=harness();const {code}=await admin('/api/pairings',{});assert.ok((await h.command({type:'PAIR',appUrl:ORIGIN,code,name:'Worker simulation'})).ok);assert.ok(h.memory.settings.token);});
test('worker restricts control messages to its own extension UI',async()=>{await assert.rejects(()=>h.ctx.message({type:'SYNC'},{id:EXT,url:'https://www.audible.com/library/titles'}));});
test('worker saves checkpoint and keeps the live library unchanged mid-scan',async()=>{await h.command({type:'SYNC'});await h.ctx.tick();assert.equal(h.memory.job.pages,1);assert.equal((await admin('/api/library')).books.length,0);});
test('worker state can be reconstructed after suspension and finish the same run',async()=>{const id=h.memory.job.id;h=harness(h);await h.drive();assert.equal(h.memory.job,null);assert.equal(h.memory.lastSuccess.runId,id);assert.equal(h.memory.lastSuccess.libraryCount,23);});
test('worker does not make write requests to Audible or transmit cookies',()=>{assert.ok(h.apiCalls.every(u=>u.startsWith(ORIGIN+'/api/')));assert.ok(h.loads.every(u=>u.startsWith('https://www.audible.com/')));assert.ok(!JSON.stringify(h.memory).includes('Amazon password'));});
test('worker merges catalog, purchases, returns, and recent listening history',async()=>{const {books}=await admin('/api/library'),map=new Map(books.map(b=>[b.id,b]));assert.equal(books.length,24);assert.equal(map.get('B0TEST0003').ownership,'returned');assert.equal(map.get('B0TEST0024').ownership,'catalog_only');assert.equal(map.get('B0TEST0001').finished,true);assert.equal(map.get('B0TEST0001').progressConflict,true);});
test('successful run updates its future weekly schedule and backfill flag',()=>{assert.ok(h.memory.settings.nextDue>Date.now());assert.equal(h.memory.settings.fullHistoryCompleted,true);});
test('repeat sync does not duplicate books or repeat historical backfill',async()=>{await h.command({type:'SYNC'});assert.equal(h.memory.job.fullHistory,false);await h.drive();assert.equal(h.memory.job,null);assert.equal((await admin('/api/library')).books.length,24);});
test('sign-in/verification stops the run and preserves existing library',async()=>{await h.command({type:'SYNC'});h.setFault('verify');await h.ctx.tick();assert.equal(h.memory.job.status,'paused');assert.ok(h.memory.status.includes('verification'));assert.equal((await admin('/api/library')).books.length,24);});
test('resume uses the saved checkpoint after a pause',async()=>{h.setFault(null);await h.command({type:'RESUME'});await h.drive();assert.equal(h.memory.job,null);});
test('network failure during run creation can retry initialization safely',async()=>{h.setFault('network');await h.command({type:'SYNC'});assert.equal(h.memory.job.status,'retry');assert.equal(h.memory.job.serverStarted,false);h.setFault(null);await h.command({type:'RESUME'});await h.drive();assert.equal(h.memory.job,null);});
test('a disappeared dedicated tab is recreated from its saved URL',async()=>{await h.command({type:'SYNC'});h.tabs.clear();await h.ctx.tick();assert.equal(h.tabs.size,1);await h.drive();assert.equal(h.memory.job,null);});
test('stop aborts staged run and preserves successful inventory',async()=>{await h.command({type:'SYNC'});await h.ctx.tick();await h.command({type:'STOP'});assert.equal(h.memory.job,null);assert.equal((await admin('/api/library')).books.length,24);});
test('closed-browser catch-up is scheduled independently of ChatGPT',async()=>{h.memory.settings.nextDue=Date.now()-1000;await h.ctx.check();assert.ok(h.memory.job);await h.drive();assert.equal(h.memory.job,null);});
test('startup recreates missing alarms without clearing tokens or dates',async()=>{h.alarms.clear();const token=h.memory.settings.token;h=harness(h);await h.ctx.alarms();assert.ok(h.alarms.has('next-chapter-check'));assert.equal(h.memory.settings.token,token);});
test('unpair clears browser credentials but does not delete library',async()=>{await h.command({type:'RESET'});assert.equal(h.memory.settings,undefined);assert.equal((await admin('/api/library')).books.length,24);});
