/* Read-only DOM adapter. No fetch, cookies, form submission, media playback or mutations. */
(() => {
  const trim=s=>String(s||'').replace(/\s+/g,' ').trim();
  const visible=el=>!!el && !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && !!el.getClientRects().length;
  const txt=el=>el ? (el.innerText||'').trim() : '';
  const label=el=>trim((el.getAttribute('aria-label')||txt(el)).replace(/[\uE000-\uF8FF]/g,''));
  const idFrom=href=>{try {const u=new URL(href,location.href); const part=u.pathname.split('/').filter(Boolean).at(-1);return u.origin==='https://www.audible.com'&&u.pathname.startsWith('/pd/')&&/^[A-Z0-9]{10}$/i.test(part)?part.toUpperCase():null;}catch{return null;}};
  const productLinks=root=>[...root.querySelectorAll('a[href*="/pd/"]')].filter(a=>idFrom(a.href));
  const canonical=href=>{const u=new URL(href,location.href);const keep=new URLSearchParams();for(const k of ['page','pn','pageSize','ps','tf','df','pageSizeOptions'])if(u.searchParams.has(k))keep.set(k,u.searchParams.get(k));return u.origin+u.pathname+(keep.size?'?'+keep.toString():'');};
  const minutes=value=>{const s=trim(value);const h=s.match(/(\d+)\s*(?:h\b|hr\b|hrs\b|hour)/i),m=s.match(/(\d+)\s*(?:m\b|min\b|mins\b|minute)/i);return h||m?(h?+h[1]*60:0)+(m?+m[1]:0):null;};
  const parsedDate=value=>{const m=String(value).match(/\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/);if(!m)return null;const year=m[3].length===2?(+m[3]>=70?'19':'20')+m[3]:m[3];const iso=`${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;const d=new Date(iso+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===iso?iso:null;};
  function rowFor(link) {
    let row=link.parentElement;
    for(let p=row?.parentElement;p&&p!==document.body;p=p.parentElement){
      if(p.matches('main,[role="main"],#adbl-main'))break;
      const ids=new Set(productLinks(p).map(a=>idFrom(a.href)));
      if(ids.size!==1)break;
      row=p;
    }
    return row;
  }
  function seriesInfo(row) {
    return [...row.querySelectorAll('a[href*="/series/"]')].filter(a=>visible(a)&&trim(a.textContent)).map(a=>{
      const u=new URL(a.href,location.href);let after='';
      for(let n=a.nextSibling;n&&after.length<100;n=n.nextSibling){if(n.nodeType===1&&n.matches?.('a'))break;after+=n.textContent||'';}
      const parent=trim(a.parentElement.textContent);
      const position=(after.match(/\bBook(?:s)?\s*([\d.,\s-]+)/i)||parent.match(/\bBook(?:s)?\s*([\d.,\s-]+)/i))?.[1]?.trim().replace(/[\s,]+$/,'')||null;
      const id=u.pathname.split('/').filter(Boolean).at(-1);
      return {name:trim(a.textContent),id:/^[A-Z0-9]{10}$/i.test(id)?id.toUpperCase():null,position,url:u.origin+u.pathname};
    });
  }
  function metadata(link,source) {
    const row=rowFor(link),t=txt(row),lines=t.split('\n').map(trim).filter(Boolean);
    const controls=[...row.querySelectorAll('button,a,[role="button"]')].filter(visible).map(label);
    const finished=controls.some(x=>/^Mark as Unfinished$/i.test(x))?true:controls.some(x=>/^Mark as finished$/i.test(x))?false:lines.includes('Finished')?true:null;
    const progress=[...row.querySelectorAll('[role="progressbar"]')].find(visible);
    const progressPercent=progress&&progress.hasAttribute('aria-valuenow')?Number(progress.getAttribute('aria-valuenow')):null;
    const remaining=lines.find(l=>/^(\d+h\s*)?(\d+m\s*)?left$/i.test(l))||lines.find(l=>/^\d+\s*(?:hrs?|hours?).*left$/i.test(l));
    const duration=lines.find(l=>/^\d+h(?:\s*\d+m)?$|^\d+m$|^\d+\s*hrs?\s+and\s+\d+\s*mins?$/i.test(l));
    const authors=[...row.querySelectorAll('a[href*="/author/"],a[href*="searchAuthor="]')].filter(visible).map(a=>trim(a.textContent)).filter(Boolean);
    const narrators=[...row.querySelectorAll('a[href*="searchNarrator="]')].filter(visible).map(a=>trim(a.textContent)).filter(Boolean);
    const checked=[...row.querySelectorAll('[role="radio"][aria-checked="true"],input[type="radio"]:checked')].find(visible);
    const ratings=['Not for me',"It's okay",'Pretty good',"It's great",'I love it'];
    const rating=checked?ratings.indexOf(label(checked))+1:null;
    const img=row.querySelector('img[src]');
    return {id:idFrom(link.href),title:trim(link.textContent),authors:[...new Set(authors)],narrators:[...new Set(narrators)],series:seriesInfo(row),
      finished:source==='library'?finished:null,progressPercent:Number.isFinite(progressPercent)?progressPercent:null,
      remainingMinutes:remaining?minutes(remaining):null,durationMinutes:duration?minutes(duration):null,
      personalRating:rating>0?rating:null,coverUrl:img?.src||null,sourceUrl:'https://www.audible.com/pd/'+idFrom(link.href),
      inLibrary:source==='library'?true:/\bIn your Library\b/i.test(t)?true:null};
  }
  function pagination(root,source,count) {
    const u=new URL(location.href),key=(source==='purchases'||source==='refunds')?'pn':'page',page=Number(u.searchParams.get(key)||1);
    const links=[...root.querySelectorAll('a[href]')].filter(visible).map(a=>({a,u:new URL(a.href,location.href)})).filter(x=>x.u.origin===u.origin&&x.u.pathname===u.pathname&&/^\d+$/.test(trim(x.a.textContent))&&x.u.searchParams.has(key));
    const nums=links.map(x=>Number(x.u.searchParams.get(key))).filter(n=>Number.isInteger(n)&&n>0);
    const controls=[...root.querySelectorAll('button,a,[role="button"]')].filter(visible);
    const next=controls.find(e=>/^(Go forward a page|Next(?: page)?)$/i.test(label(e)));
    const disabled=next&&(next.disabled||next.getAttribute('aria-disabled')==='true'||next.closest('.bc-pagination-next')?.classList.contains('bc-button-disabled'));
    let nextUrl=null;
    if(!disabled){
      const candidate=links.find(x=>+x.u.searchParams.get(key)===page+1);
      const a=next?.closest('a[href]')||next?.querySelector('a[href]');
      if(candidate)nextUrl=canonical(candidate.u.href);
      else if(a){const nu=new URL(a.href,location.href);if(nu.origin===u.origin&&nu.pathname===u.pathname&&+nu.searchParams.get(key)===page+1)nextUrl=canonical(nu.href);}
      if(next&&!nextUrl)throw Object.assign(Error('Next-page control has no verified next-page URL'),{code:'SELECTOR_CHANGED'});
    }
    if(!Number.isInteger(page)||page<1)throw Error('Invalid page index');
    // Purchase/catalog pagination can show a sliding window rather than the last page.
    // Do not call its current largest link a verified total while another page exists.
    const expectedPages=source==='library'
      ? (nums.length?Math.max(page,...nums):next?(disabled?page:null):page)
      : nextUrl?null:page;
    if(!next&&!links.length&&source==='library'&&count>=20)throw Object.assign(Error('Pagination missing on a full library page'),{code:'SELECTOR_CHANGED'});
    return {page,expectedPages,nextUrl,hasNext:!!nextUrl};
  }
  function library(source) {
    const root=document.querySelector('main[aria-label="Main Page"]')||document.querySelector('#adbl-main')||document.querySelector('main');
    if(!root)throw Object.assign(Error('Library has not rendered'),{code:'LOADING'});
    // The libItem tracking marker identifies owned/access library rows, excluding recommendations.
    const links=productLinks(root).filter(a=>visible(a)&&trim(a.textContent)&&a.getAttribute('href').includes('libItem_'));
    const unique=new Map();for(const a of links) {const item=metadata(a,'library');if(!unique.has(item.id)||item.title.length>unique.get(item.id).title.length)unique.set(item.id,item);}
    if(!unique.size)throw Object.assign(Error('No verified library rows found. Existing data is unchanged.'),{code:'SELECTOR_CHANGED'});
    const items=[...unique.values()];return {items,...pagination(root,source,items.length)};
  }
  function history(source) {
    const root=document.querySelector('main[aria-label="accountDetails"]')||document.querySelector('main');
    if(!root)throw Object.assign(Error('History has not rendered'),{code:'LOADING'});
    const table=[...root.querySelectorAll('table')].find(t=>/\bTitle\b/.test(txt(t))&&new RegExp(source==='listens'?'\\bListened\\b':'\\bPurchased\\b').test(txt(t)));
    if(!table&&!/no (?:orders|purchases|refunds|listening history)|0 orders|haven.t (?:purchased|listened)/i.test(txt(root)))throw Object.assign(Error('Expected history table not found'),{code:'SELECTOR_CHANGED'});
    const selects=[...root.querySelectorAll('select')];
    const view=selects.find(s=>[...s.options].some(o=>/^Your orders$/i.test(trim(o.textContent))));
    const yearSelect=selects.find(s=>[...s.options].some(o=>/^20\d\d$/.test(trim(o.textContent))));
    const orders=view?[...view.options].find(o=>/^Your orders$/i.test(trim(o.textContent))):null;
    const refunds=view?[...view.options].find(o=>/^Refund history$/i.test(trim(o.textContent))):null;
    const recent=yearSelect?[...yearSelect.options].find(o=>/^Last 365 days$/i.test(trim(o.textContent))):null;
    const historyUrl=(option,period)=> {const u=new URL('https://www.audible.com/account/purchase-history');u.searchParams.set('tf',option.value);if(period)u.searchParams.set('df',period);return u.href;};
    const requested=new URL(location.href),targetView=source==='refunds'?refunds:orders;
    if(source!=='listens'&&(!targetView||!recent))throw Object.assign(Error('History filters were not recognized'),{code:'SELECTOR_CHANGED'});
    if(source!=='listens'&&(view.value!==targetView.value||(!requested.searchParams.has('df')&&yearSelect.value!==recent.value))) {
      return {redirectUrl:historyUrl(targetView,requested.searchParams.get('df')||recent.value)};
    }
    const items=[];
    for(const tr of table?.querySelectorAll('tr')||[]){
      const cells=[...tr.querySelectorAll('td')];if(cells.length<3)continue;
      const a=productLinks(tr)[0];if(!a)continue; // Credit bundles and membership charges are not books.
      const item={id:idFrom(a.href),title:trim((cells[1].innerText||'').split('\n')[0])};
      if(source==='purchases'){item.purchaseDate=parsedDate(txt(cells[2]));if(!item.purchaseDate)continue;}
      if(source==='refunds'){item.returnDate=parsedDate(txt(tr).match(/Returned on[^\n]+/i)?.[0]);if(!item.returnDate)continue;}
      if(source==='listens'){
        item.lastListenedDate=parsedDate(txt(cells[2]));if(!item.lastListenedDate)continue;
        const p=tr.querySelector('[role="progressbar"]');item.progressPercent=p&&p.hasAttribute('aria-valuenow')?+p.getAttribute('aria-valuenow'):null;
        item.remainingMinutes=minutes(txt(cells[1]).split('\n').find(l=>/left/.test(l)));
      }
      items.push(item);
    }
    const historyYears=yearSelect?[...yearSelect.options].filter(o=>/^(19|20)\d\d$/.test(trim(o.textContent))).map(o=>({label:trim(o.textContent),value:o.value})):[];
    const p=source==='listens'?{page:1,expectedPages:1,nextUrl:null,hasNext:false}:pagination(root,source,items.length);
    return {items,historyYears,historyTemplates:orders&&refunds&&recent?{orders:historyUrl(orders,recent.value),refunds:historyUrl(refunds,recent.value)}:null,...p};
  }
  function catalog(context){
    const rows=[...document.querySelectorAll('.productListItem,[data-asin]')].filter(visible);
    const unique=new Map();
    for(const row of rows){const a=productLinks(row).find(a=>visible(a)&&trim(a.textContent)&&!a.querySelector('img'));if(!a)continue;const item=metadata(a,'catalog');if(!item.series.length&&context?.series){const position=txt(row).match(/\bBooks?\s+([0-9]+(?:[-.,][0-9]+)*)/i)?.[1]||null;item.series=[{...context.series,position}];}if(item.series.length)unique.set(item.id,item);}
    if(!unique.size)throw Object.assign(Error('Series catalog layout not recognized; skipped without changing ownership'),{code:'SELECTOR_CHANGED'});
    return {items:[...unique.values()],...pagination(document.querySelector('main')||document.body,'catalog',unique.size)};
  }
  globalThis.NextChapterExtract = (source,context={}) => {
    try{
      if(location.origin!=='https://www.audible.com')return {ok:false,code:'AUTH_REQUIRED',error:'Audible sign-in required'};
      const top=txt(document.body).slice(0,6000);
      if(document.querySelector('input[type="password"],form[name="signIn"]')||/Amazon Sign-In|Sign in to Audible/i.test(document.title))return {ok:false,code:'AUTH_REQUIRED',error:'Sign in to Audible manually, then Resume'};
      if(/verify (?:that )?you are human|robot check|automated (?:access|traffic)|checking your browser/i.test(top))return {ok:false,code:'VERIFY_REQUIRED',error:'Audible is requesting verification; collection stopped'};
      const path=location.pathname;
      if(source==='library'&&!/^\/library\/(titles|audiobooks)\/?$/.test(path))throw Error('Unexpected library page');
      if((source==='purchases'||source==='refunds')&&path!=='/account/purchase-history')throw Error('Unexpected purchase-history page');
      if(source==='listens'&&path!=='/account/listen-history')throw Error('Unexpected listening-history page');
      if(source==='catalog'&&!path.startsWith('/series/'))throw Error('Unexpected series page');
      const data=source==='library'?library(source):source==='catalog'?catalog(context):history(source);
      return {ok:true,source,url:canonical(location.href),...data};
    }catch(e){return {ok:false,code:e.code||'SELECTOR_CHANGED',error:e.message};}
  };
})();
