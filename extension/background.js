import {appOrigin,safeAudibleUrl,weeklyDue,initialTasks,validatePage} from './core.js';
const CHECK='next-chapter-check',PULSE='next-chapter-progress';
const get=keys=>chrome.storage.local.get(keys);
const save=object=>chrome.storage.local.set(object);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let chain=Promise.resolve();
function enqueue(fn){const result=chain.then(fn);chain=result.catch(()=>{});return result;}
async function alarms(){
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  if(!await chrome.alarms.get(CHECK))await chrome.alarms.create(CHECK,{periodInMinutes:60});
}
async function badge(value){await chrome.action.setBadgeText({text:value});await chrome.action.setBadgeBackgroundColor({color:'#245B52'});}
async function api(path,body){
  const {settings}=await get('settings');if(!settings?.token)throw Object.assign(Error('Pair this browser with your Next Chapter app'),{code:'PAIR_REQUIRED'});
  let response;try{response=await fetch(appOrigin(settings.appUrl)+path,{method:body===undefined?'GET':'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','X-Next-Chapter-Extension':chrome.runtime.id,'Authorization':'Bearer '+settings.token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw Object.assign(Error('The Next Chapter server is unreachable. Your checkpoint is saved.'),{code:'NETWORK'});}
  const data=await response.json().catch(()=>({error:'Unexpected server response'}));
  if(!response.ok)throw Object.assign(Error(data.error||'Server HTTP '+response.status),{code:response.status>=500?'NETWORK':response.status===401?'PAIR_REQUIRED':'SERVER_REJECTED'});
  return data;
}
async function createJob(){
  const {settings,job}=await get(['settings','job']);if(job)throw Error('A sync already exists. Resume or stop it first.');
  if(!settings?.token)throw Error('Pair this browser first');
  const tasks=initialTasks().map(t=>({...t,page:1,done:false}));
  const run={id:crypto.randomUUID(),status:'starting',serverStarted:false,startedAt:Date.now(),tasks,index:0,pages:0,count:0,attempts:0,catalog:{},scannedFingerprints:{},fullHistory:!settings.fullHistoryCompleted,includeCatalog:!!settings.includeCatalog};
  await save({job:run,status:'Starting sync…'});await chrome.alarms.create(PULSE,{periodInMinutes:1});
  await tick();
}
async function plan(job,data,task){
  let more=[];
  if(task.source==='library')for(const b of data.items)for(const s of b.series||[])if(s.id&&s.url)job.catalog[s.id]={...s,url:safeAudibleUrl(s.url)};
  if(task.key==='library'&&!data.hasNext&&job.includeCatalog&&!job.catalogAdded){
    more.push(...Object.entries(job.catalog).map(([id,series])=>({key:'catalog-'+id,source:'catalog',scope:'series catalog; ownership unverified',url:series.url,series,page:1,done:false})));job.catalogAdded=true;
  }
  if(task.key==='purchases-recent'&&data.historyTemplates&&!job.historiesAdded){
    more.push({key:'refunds-recent',source:'refunds',scope:'last 365 days',url:safeAudibleUrl(data.historyTemplates.refunds),page:1,done:false});
    if(job.fullHistory)for(const year of data.historyYears||[])for(const source of ['purchases','refunds']){
      const u=new URL(source==='purchases'?data.historyTemplates.orders:data.historyTemplates.refunds);u.searchParams.set('df',year.value);
      more.push({key:source+'-'+year.label,source,scope:'year '+year.label,url:safeAudibleUrl(u.href),page:1,done:false});
    }
    job.historiesAdded=true;
  }
  if(more.length){
    if(job.tasks.length+more.length>600)throw Error('More than 600 scan tasks; stop and review the scope');
    await api(`/api/sync/runs/${job.id}/tasks`,{tasks:more});
    for(const t of more)if(!job.tasks.some(x=>x.key===t.key))job.tasks.push(t);
  }
}
async function ensureTab(job,url){
  let tab;if(job.tabId)try{tab=await chrome.tabs.get(job.tabId);}catch{}
  if(!tab){tab=await chrome.tabs.create({url:safeAudibleUrl(url),active:false});job.tabId=tab.id;await save({job});return false;}
  if(tab.status==='loading')return false;
  if(!tab.url||!tab.url.startsWith('https://www.audible.com/'))throw Object.assign(Error('Audible sign-in or site verification is required. Use the dedicated tab, then Resume.'),{code:'AUTH_REQUIRED'});
  if(safeAudibleUrl(tab.url)!==safeAudibleUrl(url)){
    // Only navigate on a recorded transition, never conceal an unexpected redirect.
    if(!job.needNavigation)throw Object.assign(Error('The sync tab moved to a different page. Resume to reopen the saved page.'),{code:'PAGE_MOVED'});
    await chrome.tabs.update(job.tabId,{url:safeAudibleUrl(url)});job.needNavigation=false;await save({job});return false;
  }
  job.needNavigation=false;return true;
}
async function read(job,task){
  await chrome.scripting.executeScript({target:{tabId:job.tabId},files:['extractor.js']});
  return (await chrome.scripting.executeScript({target:{tabId:job.tabId},func:async(source,context)=>{
    let result;
    for(let i=0;i<16;i++){
      result=globalThis.NextChapterExtract(source,context);
      if(result.ok||['AUTH_REQUIRED','VERIFY_REQUIRED'].includes(result.code))return result;
      await new Promise(r=>setTimeout(r,350));
    }
    return result;
  },args:[task.source,task]}))[0]?.result;
}
async function closeOwned(job){if(job.tabId)try{await chrome.tabs.remove(job.tabId);}catch{}}
async function tick(){
  let {job,settings}=await get(['job','settings']);if(!job||!['starting','running','retry'].includes(job.status))return;
  if(job.nextAttemptAt&&job.nextAttemptAt>Date.now())return;
  try{
    if(!job.serverStarted){await api('/api/sync/runs',{id:job.id,tasks:job.tasks});job.serverStarted=true;job.status='running';job.needNavigation=true;await save({job});}
    job.status='running';
    if(job.index>=job.tasks.length){
      const report=await api(`/api/sync/runs/${job.id}/finish`,{});
      settings.nextDue=weeklyDue();settings.fullHistoryCompleted=!!(settings.fullHistoryCompleted||(job.fullHistory&&job.historiesAdded&&job.tasks.filter(t=>['purchases','refunds'].includes(t.source)).every(t=>!t.skipped)));
      await save({settings,lastSuccess:report,job:null,status:`Synced ${report.libraryCount} library titles. ${report.warnings.length} coverage warnings.`});
      await closeOwned(job);await chrome.alarms.clear(PULSE);await badge('');return;
    }
    const task=job.tasks[job.index];
    if(!await ensureTab(job,task.url))return;
    const raw=await read(job,task);
    if(raw?.redirectUrl){task.url=safeAudibleUrl(raw.redirectUrl);job.needNavigation=true;await save({job});await ensureTab(job,task.url);return;}
    const data=validatePage(raw,task,task.page);
    const fingerprint=data.items.map(b=>b.id).sort().join(',');
    if(task.source==='library'&&Object.entries(job.scannedFingerprints).some(([key,val])=>key!==task.key+':'+task.page&&val===fingerprint))throw Object.assign(Error('Repeated library page detected; prior library retained'),{code:'SELECTOR_CHANGED'});
    await plan(job,data,task);
    // The server validates and stages each page. Nothing changes in the visible library until finish.
    await api(`/api/sync/runs/${job.id}/pages`,{task:task.key,page:task.page,items:data.items,hasNext:data.hasNext,expectedPages:data.expectedPages});
    if(task.source==='library'){job.count+=data.items.length;job.scannedFingerprints[task.key+':'+task.page]=fingerprint;}
    job.pages++;job.attempts=0;job.nextAttemptAt=null;
    if(job.pages>1500)throw Error('Page safety limit reached');
    if(data.hasNext){task.page++;task.url=safeAudibleUrl(data.nextUrl);}else{task.done=true;job.index++;}
    job.needNavigation=true;
    await save({job,status:`${job.count} library titles • ${job.pages} pages • ${task.source}`});await badge(String(job.count||'…'));
    // Brief pacing only; the durable alarm recovers if the worker is suspended here.
    await delay(1600);
    if(job.index<job.tasks.length)await ensureTab(job,job.tasks[job.index].url);
    else await tick();
  }catch(e){
    // No returned DOM, cookies, order IDs, credentials or URLs are logged.
    const task=job.tasks[job.index];
    if(e.code==='NETWORK'){
      job.attempts=(job.attempts||0)+1;
      job.status=job.attempts<=3?'retry':'paused';job.nextAttemptAt=Date.now()+[1,5,15,60][Math.min(job.attempts-1,3)]*60000;
    }else if(e.code==='SELECTOR_CHANGED'&&task?.source!=='library'){
      try{await api(`/api/sync/runs/${job.id}/skip`,{task:task.key,error:e.message});task.done=true;task.skipped=true;job.index++;job.needNavigation=true;job.status='running';await save({job,status:'A supplemental page was skipped; coverage will be shown in the app.'});if(job.index<job.tasks.length)await ensureTab(job,job.tasks[job.index].url);else await tick();return;}catch{job.status='paused';}
    }else{job.status='paused';}
    job.error=String(e.message||e).slice(0,300);await save({job,status:job.error});await badge('!');
  }
}
async function check(){
  await alarms();const {job,settings}=await get(['job','settings']);
  if(job){if(['running','starting','retry'].includes(job.status)){if(!await chrome.alarms.get(PULSE))await chrome.alarms.create(PULSE,{periodInMinutes:1});await tick();}return;}
  if(settings?.auto&&settings.token&&(!settings.nextDue||settings.nextDue<=Date.now()))await createJob();
}
async function message(m,sender){
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('popup.html')))throw Error('Only the extension control panel may send commands');
  if(m.type==='PAIR'){
    const appUrl=appOrigin(m.appUrl);
    if(!await chrome.permissions.contains({origins:[appUrl+'/*']}))throw Error('Grant permission for this app origin first');
    const response=await fetch(appUrl+'/api/pairings/claim',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json','X-Next-Chapter-Extension':chrome.runtime.id},body:JSON.stringify({code:m.code,name:m.name}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Pairing failed');
    await save({settings:{appUrl,token:data.token,deviceId:data.deviceId,auto:true,includeCatalog:true,nextDue:Date.now()},status:'Paired. Ready for the first sync.'});await alarms();return {ok:true};
  }
  if(m.type==='SYNC'){await createJob();return {ok:true};}
  if(m.type==='RESUME'){const {job}=await get('job');if(!job)throw Error('No saved sync');job.status=job.status==='starting'?'starting':'running';job.attempts=0;job.nextAttemptAt=null;job.needNavigation=true;await save({job});await tick();return {ok:true};}
  if(m.type==='STOP'){const {job}=await get('job');if(job){await api(`/api/sync/runs/${job.id}/abort`,{error:'Stopped in extension'});await closeOwned(job);}await save({job:null,status:'Stopped; previously imported library preserved.'});await chrome.alarms.clear(PULSE);await badge('');return {ok:true};}
  if(m.type==='OPTIONS'){const {settings,job}=await get(['settings','job']);if(!settings)throw Error('Pair first');if(job)throw Error('Finish or stop the active sync before changing options');settings.auto=!!m.auto;settings.includeCatalog=!!m.includeCatalog;await save({settings});return {ok:true};}
  if(m.type==='RESET'){const {job}=await get('job');if(job){try{await api(`/api/sync/runs/${job.id}/abort`,{error:'Browser unpaired'});}catch{}await closeOwned(job);}await chrome.storage.local.remove(['settings','job']);await save({status:'Unpaired. Generate a new code in the app.'});await chrome.alarms.clear(PULSE);await badge('');return {ok:true};}
  if(m.type==='CHECK'){await api('/api/extension/status');return {ok:true};}
  if(m.type==='OPEN_TAB'){const {job}=await get('job');if(job?.tabId){try{await chrome.tabs.update(job.tabId,{active:true});return {ok:true};}catch{}}await chrome.tabs.create({url:'https://www.audible.com/library/titles'});return {ok:true};}
  throw Error('Unknown command');
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{enqueue(()=>message(m,sender)).then(respond,e=>respond({ok:false,error:e.message}));return true;});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')enqueue(async()=>{const {job}=await get('job');if(job?.tabId===id)await tick();});});
chrome.alarms.onAlarm.addListener(alarm=>{if([CHECK,PULSE].includes(alarm.name))enqueue(check);});
chrome.runtime.onInstalled.addListener(()=>enqueue(check));
chrome.runtime.onStartup.addListener(()=>enqueue(check));
// Recreate alarms when this worker is started after a browser update or suspension.
enqueue(alarms);
