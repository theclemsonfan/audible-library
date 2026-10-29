import {filtered,seriesGroups,ownershipLabels,duration,progressLabel,sampleBooks} from './model.js';
const $=id=>document.getElementById(id),E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let books=[],lastSync=null,demo=false,filter='all',view='library',shown=60,toastTimer,activeBook=null;
const state=()=>({query:$('search').value,filter,ownership:$('ownership').value,sort:$('sort').value});
async function request(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...options,body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
async function busy(button,fn){button.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{button.disabled=false;}}
function dateOnly(d){return d?new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Not available';}
function when(d){return d?new Date(d).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'No completed sync';}
function cover(b,i=0){return b.coverUrl?`<img class="cover" src="${E(b.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<div class="cover cover-${i%5}" aria-hidden="true">${E(b.title.split(' ').filter(x=>x.length>2).slice(0,2).map(x=>x[0]).join(''))}</div>`;}
function openView(name){view=name;for(const key of ['library','series','sync'])$('view-'+key).hidden=key!==name;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===name?'page':'false'));if(name==='sync')loadSettings();if(name==='series')renderSeries();window.scrollTo({top:0});}
function render(){
  const shelf=books.filter(b=>b.inLibrary&&!b.notSeenInLatest&&b.ownership!=='returned');
  const finished=shelf.filter(b=>b.finished===true),ready=shelf.filter(b=>b.finished!==true),groups=seriesGroups(shelf);
  $('stats').innerHTML=[[shelf.length,'Library titles'],[ready.length,'Unfinished / status unknown'],[finished.length,'Marked finished'],[groups.length,'Series on your shelf']].map(([n,l])=>`<div class="stat"><span class="number">${n}</span><span class="label">${l}</span></div>`).join('');
  const next=filtered(ready,{filter:'progress',sort:'lastListened'})[0]||filtered(ready.filter(b=>b.ownership==='purchased'),{sort:'purchased'})[0];
  $('continue').hidden=!next;
  if(next)$('continue').innerHTML=`${cover(next,2)}<div><p class="eyebrow">${next.progressPercent>0?'PICK UP WHERE YOU LEFT OFF':'ALREADY WAITING ON YOUR SHELF'}</p><h2>${E(next.title)}</h2><p>${E(next.authors?.join(', ')||'Author not available')} · ${E(progressLabel(next))}${next.remainingMinutes!=null?' · '+duration(next.remainingMinutes)+' left':''}</p></div><button class="secondary" data-book="${next.id}">See this book →</button>`;
  const list=filtered(books,state());$('result-count').textContent=`${list.length} ${list.length===1?'title':'titles'}`;
  if(!books.length)$('books').innerHTML=`<section class="empty"><h2>A shelf worth coming back to.</h2><p>Your real library will appear after the desktop companion completes its first sync. Nothing is imported yet, and we will not fill your shelf with invented books.</p><button class="primary" data-connect>Connect the companion</button> <button class="text-button" data-demo>Explore a fictional sample</button></section>`;
  else if(!list.length)$('books').innerHTML='<section class="empty"><h2>No matches on this shelf.</h2><p>Try another filter or search term.</p></section>';
  else $('books').innerHTML=list.slice(0,shown).map((b,i)=>`<article class="book-card"><div class="card-top">${cover(b,i)}<div><button class="book-title" data-book="${b.id}">${E(b.title)}</button><p class="author">${E(b.authors?.join(', ')||'Author not available')}</p><p class="series-tag">${E((b.series||[]).map(s=>s.name+(s.position?' · Book '+s.position:'')).join(' / ')||'Standalone / series unverified')}</p></div></div><div class="card-bottom"><div class="book-status"><span class="chip ${b.finished===true?'':b.ownership==='purchased'?'neutral':'warn'}">${E(progressLabel(b))}</span><span>${b.remainingMinutes!=null&&b.finished!==true?E(duration(b.remainingMinutes))+' left':''}</span></div>${b.progressPercent!=null?`<progress max="100" value="${b.progressPercent}" aria-label="Listening progress for ${E(b.title)}"></progress>`:''}<p class="fine">${E(ownershipLabels[b.ownership]||'Ownership unknown')}${b.notSeenInLatest?' · Not seen in latest scan':''}</p></div></article>`).join('');
  $('more').hidden=list.length<=shown;
  $('sync-label').textContent=demo?'Sample only':lastSync?'Synced '+when(lastSync.completedAt):'Not synced yet';
  $('demo-banner').hidden=!demo;
  if(view==='series')renderSeries();
}
function renderSeries(){
  const groups=seriesGroups(books);
  $('series-list').innerHTML=groups.length?groups.map(g=>{
    const own=g.books.filter(b=>b.inLibrary),done=own.filter(b=>b.finished).length;
    return `<section class="series-card"><p class="eyebrow">${done} FINISHED / ${own.length} LIBRARY TITLES</p><h2>${E(g.name)}</h2><progress max="${Math.max(own.length,1)}" value="${done}" aria-label="${E(g.name)} completion"></progress>${g.books.map(b=>`<div class="series-row"><div><button class="book-title" data-book="${b.id}">${b.seriesPosition?'Book '+E(b.seriesPosition)+' · ':''}${E(b.title)}</button><small>${E(ownershipLabels[b.ownership]||'Ownership unknown')}</small></div><small>${E(progressLabel(b))}</small></div>`).join('')}</section>`;
  }).join(''):'<section class="empty"><h2>Your series will live here.</h2><p>Import your library with the companion to group titles into series.</p></section>';
}
function showBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;activeBook=b;
  $('book-detail').innerHTML=`<p class="eyebrow">BOOK DETAILS</p><h2>${E(b.title)}</h2><p class="muted">${E(b.authors?.join(', ')||'Author not available')}</p><span class="chip">${E(ownershipLabels[b.ownership]||'Ownership unknown')}</span>${b.progressConflict?'<p class="notice">Audible marks this finished, but its listening-history progress differs. Both observations are preserved.</p>':''}<dl><dt>Series</dt><dd>${E((b.series||[]).map(s=>s.name+(s.position?' · '+s.position:'')).join(' / ')||'Not verified')}</dd><dt>Narrated by</dt><dd>${E(b.narrators?.join(', ')||'Not available')}</dd><dt>Purchased</dt><dd>${dateOnly(b.purchaseDate)}</dd><dt>Last date shown in listening history</dt><dd>${dateOnly(b.lastListenedDate)}</dd><dt>Audible status / progress</dt><dd>${b.audibleFinished===true?'Finished':b.audibleFinished===false?'Unfinished':'Unknown'} / ${b.progressPercent!=null?b.progressPercent+'%':'Not available'}</dd><dt>Total length / remaining</dt><dd>${duration(b.durationMinutes)} / ${duration(b.remainingMinutes)}</dd>${b.returnDate?`<dt>Latest recorded return</dt><dd>${dateOnly(b.returnDate)}</dd>`:''}</dl><label>My reading status in Next Chapter<select id="local-finished"><option value="null">Use Audible status</option><option value="true">Finished</option><option value="false">Unfinished</option></select></label><label>Personal note<textarea id="book-note" maxlength="5000" placeholder="A reminder for your next listen…"></textarea></label><label><input type="checkbox" id="book-favorite"> Keep in favorites</label><p class="fine">Changes here affect this app only. The extension never changes your Audible account.</p><button class="primary" id="save-book" ${demo?'disabled':''}>Save my preferences</button>${!demo&&b.sourceUrl?` <a class="text-button" href="${E(b.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open title in Audible ↗</a>`:''}<details><summary>Coverage notes</summary><p>Archived status is unverified. Listening-history dates are not proven completion dates. Absence from the latest scan is not proof that ownership ended. Purchase records and refunds are reconciled by date, with same-day conflicts left uncertain.</p></details>`;
  $('local-finished').value=b.localFinished==null?'null':String(b.localFinished);$('book-note').value=b.notes||'';$('book-favorite').checked=!!b.favorite;
  $('save-book').onclick=()=>busy($('save-book'),async()=>{await request('/api/books/'+id,{method:'PATCH',body:{finished:JSON.parse($('local-finished').value),notes:$('book-note').value,favorite:$('book-favorite').checked}});$('book-dialog').close();await load();toast('Saved in Next Chapter. Audible was not changed.');});
  $('book-dialog').showModal();
}
async function load(){if(demo)return render();const result=await request('/api/library');books=result.books;lastSync=result.lastSync;render();}
async function loadSettings(){
  if(demo){$('health').innerHTML='<p>Sample mode. Connect your real library after signing in.</p>';$('devices').textContent='No sample browser connections.';$('runs').textContent='No real sync attempts in sample mode.';return;}
  try{
    const [{devices},{runs}]=await Promise.all([request('/api/devices'),request('/api/runs')]);
    $('health').innerHTML=[['Last successful sync',when(lastSync?.completedAt)],['Library titles',lastSync?.libraryCount??'Not imported'],['Pages collected',lastSync?.pages??'—'],['Archive coverage','Unverified'],['Listening history','Recent web entries; earlier dates retained'],['Supplemental warnings',lastSync?.warnings?.length??'—']].map(([a,b])=>`<div class="health-row"><strong>${E(a)}</strong><span>${E(b)}</span></div>`).join('')+(lastSync?.warnings?.length?'<details><summary>View coverage warnings</summary>'+lastSync.warnings.map(w=>'<p>'+E(w)+'</p>').join('')+'</details>':'');
    $('devices').innerHTML=devices.length?devices.map(d=>`<div class="health-row"><div><strong>${E(d.name)}</strong><p class="fine">Last connection ${when(d.last_seen)}</p></div>${d.revoked?'<span>Revoked</span>':`<button class="secondary" data-revoke="${d.id}">Disconnect</button>`}</div>`).join(''):'<p class="muted">No browser is paired yet.</p>';
    $('runs').innerHTML=runs.length?runs.map(r=>`<div class="health-row"><div><strong>${E(r.status)}</strong><p class="fine">${when(r.started)}${r.report?.error?' · '+E(r.report.error):''}</p></div>${r.status==='running'?`<button data-abort="${r.id}" class="secondary">Stop abandoned run</button>`:`<span>${r.report?.libraryCount??'—'} titles</span>`}</div>`).join(''):'<p class="muted">No sync attempts yet. The app will report real attempts here.</p>';
  }catch(e){toast(e.message);}
}
async function init(){
  try{const status=await request('/api/status');$('version').textContent=status.version;
    if(status.signedIn){$('auth').hidden=true;$('shell').hidden=false;await load();}
    else{$('shell').hidden=true;$('auth').hidden=false;$('setup-label').hidden=!status.setupRequired;$('auth-title').textContent=status.setupRequired?'Make this library yours.':'Welcome back.';$('auth-copy').textContent=status.setupRequired?'Create a private Next Chapter password. Your Amazon credentials are not needed.':'Sign in to your private audiobook library.';$('auth-submit').textContent=status.setupRequired?'Create my library':'Sign in';$('password').autocomplete=status.setupRequired?'new-password':'current-password';
      const fragment=new URLSearchParams(location.hash.slice(1));if(status.setupRequired&&fragment.has('setup'))$('setup-key').value=fragment.get('setup');history.replaceState(null,'',location.pathname);
      $('auth-form').onsubmit=async event=>{event.preventDefault();$('auth-error').textContent='';$('auth-submit').disabled=true;try{await request(status.setupRequired?'/api/setup':'/api/login',{method:'POST',body:{password:$('password').value,token:$('setup-key').value}});$('password').value='';$('setup-key').value='';await init();}catch(e){$('auth-error').textContent=e.message;}finally{$('auth-submit').disabled=false;}};
    }
  }catch(e){$('auth').hidden=false;$('auth-error').textContent='The Next Chapter server is not reachable. '+e.message;}
}
function enterDemo(){demo=true;books=sampleBooks();lastSync=null;$('auth').hidden=true;$('shell').hidden=false;openView('library');render();}
$('demo-auth').onclick=enterDemo;$('exit-demo').onclick=()=>{demo=false;books=[];init();};
$('auth-form').addEventListener('submit',e=>e.preventDefault());
$('logout').onclick=async()=>{if(!demo)await request('/api/logout',{method:'POST',body:{}});demo=false;books=[];lastSync=null;await init();};
$('refresh').onclick=()=>busy($('refresh'),async()=>{await load();if(view==='sync')await loadSettings();toast(demo?'Showing fictional samples':'Library refreshed from the server');});
$('manage-sync').onclick=()=>openView('sync');
$('search').oninput=()=>{shown=60;render();};$('ownership').onchange=()=>{shown=60;render();};$('sort').onchange=()=>{shown=60;render();};$('more').onclick=()=>{shown+=60;render();};
$('close-dialog').onclick=()=>$('book-dialog').close();
$('pair').onclick=()=>busy($('pair'),async()=>{if(demo)throw Error('Sign in before connecting a browser');const data=await request('/api/pairings',{method:'POST',body:{}});$('pair-url').value=data.appUrl;$('pair-code').value=data.code;$('pair-result').hidden=false;});
for(const field of ['url','code'])$('copy-'+field).onclick=()=>busy($('copy-'+field),async()=>{await navigator.clipboard.writeText($('pair-'+field).value);toast(field==='url'?'App address copied':'Pairing code copied');});
$('export').onclick=()=>{if(demo)return toast('Sample mode does not export a real library');location.href='/api/export';};
$('backup').onclick=()=>busy($('backup'),async()=>{if(demo)throw Error('No real database in sample mode');const result=await request('/api/backup',{method:'POST',body:{}});toast(result.file?'Private server backup created':'No books to back up yet');});
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.view)openView(b.dataset.view);
  if(b.dataset.filter){filter=b.dataset.filter;shown=60;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();}
  if(b.dataset.book)showBook(b.dataset.book);
  if(b.hasAttribute('data-connect'))openView('sync');
  if(b.hasAttribute('data-demo'))enterDemo();
  if(b.dataset.revoke)busy(b,async()=>{if(!confirm('Disconnect this extension? It will need a new pairing code.'))return;await request('/api/devices/'+b.dataset.revoke+'/revoke',{method:'POST',body:{}});await loadSettings();});
  if(b.dataset.abort)busy(b,async()=>{if(!confirm('Stop this unfinished scan? Your saved library will remain unchanged.'))return;await request('/api/runs/'+b.dataset.abort+'/abort',{method:'POST',body:{}});await loadSettings();});
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
init();
