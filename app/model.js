export const ownershipLabels={purchased:'Purchase verified',access_unverified:'Access unverified',uncertain:'Purchase / return conflict',returned:'Returned',catalog_only:'Catalog discovery'};
export function seriesKey(s){return s.id||s.name.toLocaleLowerCase();}
export function seriesGroups(books){
  const map=new Map();
  for(const b of books)for(const s of b.series||[]){const key=seriesKey(s);if(!map.has(key))map.set(key,{...s,books:[]});map.get(key).books.push({...b,seriesPosition:s.position});}
  for(const group of map.values())group.books.sort((a,b)=>(parseFloat(a.seriesPosition)||0)-(parseFloat(b.seriesPosition)||0)||a.title.localeCompare(b.title));
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function filtered(books,{query='',filter='all',ownership='all',sort='lastListened'}={}){
  const q=query.trim().toLowerCase();
  return books.filter(b=>{
    if(q&&!`${b.title} ${(b.authors||[]).join(' ')} ${(b.series||[]).map(s=>s.name).join(' ')}`.toLowerCase().includes(q))return false;
    if(ownership!=='all'&&b.ownership!==ownership)return false;
    if(ownership==='all'&&b.ownership==='catalog_only')return false;
    if(filter==='finished')return b.finished===true;
    if(filter==='ready')return b.finished!==true&&b.inLibrary&&b.ownership!=='returned'&&!b.notSeenInLatest;
    if(filter==='progress')return b.finished!==true&&b.progressPercent>0&&b.progressPercent<100;
    if(filter==='favorite')return !!b.favorite;
    return true;
  }).sort((a,b)=>{
    if(sort==='title')return a.title.localeCompare(b.title);
    if(sort==='series')return (a.series?.[0]?.name||'~').localeCompare(b.series?.[0]?.name||'~')||(parseFloat(a.series?.[0]?.position)||0)-(parseFloat(b.series?.[0]?.position)||0)||a.title.localeCompare(b.title);
    const key=sort==='purchased'?'purchaseDate':'lastListenedDate';return (b[key]||'').localeCompare(a[key]||'')||a.title.localeCompare(b.title);
  });
}
export function duration(minutes){if(minutes==null)return 'Not available';const n=Math.round(minutes);return n>=60?`${Math.floor(n/60)}h ${n%60}m`:`${n}m`;}
export function progressLabel(b){if(b.finished===true)return 'Finished';if(b.progressPercent>0)return `${b.progressPercent}% listened`;if(b.finished===false)return 'Unfinished';return 'Status unknown';}
export function sampleBooks(){
  const rows=[['Clockwork Orchard','The Orchard Chronicles','1','Mara Vale',true,99,'2026-10-12','2026-10-19'],['The Glass Harvest','The Orchard Chronicles','2','Mara Vale',false,43,'2026-10-18','2026-10-27'],['A Map of Quiet Stars','Quiet Stars','1','Jonah Ash',true,100,'2026-08-22','2026-09-01'],['The Lantern Beyond','Quiet Stars','2','Jonah Ash',false,0,'2026-09-02',null],['Tea at the End of Time','The Last Teahouse','1','Elin West',false,12,'2026-10-02','2026-10-23'],['The Copper Garden','The Last Teahouse','2','Elin West',false,null,null,null],['An Ordinary Kind of Magic',null,null,'Rowan Fields',true,99,'2026-06-02','2026-08-29'],['The Gentle Art of Getting Lost',null,null,'August Lane',false,0,'2026-10-21',null]];
  return rows.map((r,i)=>({id:`B0DEMO${String(i+1).padStart(4,'0')}`,title:r[0],series:r[1]?[{id:`B0SERIES0${Math.floor(i/2)+1}`,name:r[1],position:r[2]}]:[],authors:[r[3]],narrators:['Sample Narrator'],finished:r[4],audibleFinished:r[4],progressPercent:r[5],remainingMinutes:r[4]?null:Math.round(720*(1-(r[5]||0)/100)),durationMinutes:720,purchaseDate:r[6],lastListenedDate:r[7],inLibrary:true,ownership:r[6]?'purchased':'access_unverified',favorite:i===1,sourceUrl:null}));
}
