export const VERSION='0.2.0';
export function appOrigin(input) {
  const u=new URL(String(input).trim());
  if(u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('Enter only your app origin, without a path or sign-in information');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('HTTPS is required, except on this computer’s localhost');
  return u.origin;
}
export function safeAudibleUrl(input) {
  const u=new URL(input);
  if(u.origin!=='https://www.audible.com'||u.username||u.password||!(/^\/library\/(titles|audiobooks)\/?$/.test(u.pathname)||/^\/account\/(purchase-history|listen-history)$/.test(u.pathname)||/^\/series\/[A-Za-z0-9-]+(?:\/[A-Z0-9]{10})?\/?$/i.test(u.pathname)))throw Error('Unexpected Audible destination; stopped');
  const params=new URLSearchParams();for(const k of ['page','pn','pageSize','ps','tf','df'])if(u.searchParams.has(k))params.set(k,u.searchParams.get(k));
  return u.origin+u.pathname+(params.size?'?'+params.toString():'');
}
export function weeklyDue(now=Date.now()) { const d=new Date(now);d.setHours(8,0,0,0);d.setDate(d.getDate()+((7-d.getDay())%7));if(d.getTime()<=now)d.setDate(d.getDate()+7);return d.getTime(); }
export function initialTasks(){return [
  {key:'library',source:'library',scope:'all titles',url:'https://www.audible.com/library/titles'},
  {key:'purchases-recent',source:'purchases',scope:'last 365 days',url:'https://www.audible.com/account/purchase-history'},
  {key:'listens',source:'listens',scope:'recent web history; not a full listening log',url:'https://www.audible.com/account/listen-history'}
];}
export function validatePage(data,task,expectedPage){
  if(!data?.ok)throw Object.assign(Error(data?.error||'Collector returned no result'),{code:data?.code||'SELECTOR_CHANGED'});
  if(data.source!==task.source||data.page!==expectedPage)throw Object.assign(Error('Audible returned a different page than requested'),{code:'SELECTOR_CHANGED'});
  safeAudibleUrl(data.url);
  if(!Array.isArray(data.items)||data.items.length>200)throw Error('Invalid page records');
  if(task.source==='library'&&data.items.length===0)throw Error('Empty library scan is not accepted');
  if(data.hasNext!==!!data.nextUrl)throw Error('Pagination signals disagree');
  if(data.nextUrl){const u=new URL(safeAudibleUrl(data.nextUrl)),old=new URL(task.url),k=['purchases','refunds'].includes(task.source)?'pn':'page';if(u.pathname!==old.pathname||+u.searchParams.get(k)!==expectedPage+1)throw Error('Pagination loop or destination change detected');}
  return data;
}
