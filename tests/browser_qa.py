"""Local Chromium QA using synthetic Audible pages only. No live-account access.
Requires Python 3.10+, Playwright, and Chromium. Runtime application needs only Node.
"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile, time, urllib.request, http.cookiejar
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('QA_OUTPUT', str(ROOT/'qa-output')))
OUT.mkdir(parents=True,exist_ok=True)
PORT=18788
ORIGIN=f'http://localhost:{PORT}'
passed=[]
def record(name):
    passed.append(name); print('PASS', name, flush=True)
def book_id(i): return f'B0TEST{i:04d}'
def row(i):
    status='<span>Finished</span><button>Mark as Unfinished</button>' if i==1 else '<span hidden>Finished</span><button>Mark as finished</button>'
    progress='<div role="progressbar" aria-valuenow="52" aria-valuemax="100"></div><span>10h 2m left</span>' if i==2 else '<span>12h 30m</span>'
    return f'''<article class="library-row"><a href="/pd/Synthetic-Book-{i}-Audiobook/{book_id(i)}?ref=a_library_t_c5_libItem_{book_id(i)}"><img alt="Synthetic cover" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></a><div><a href="/pd/Synthetic-Book-{i}-Audiobook/{book_id(i)}?ref=a_library_t_c5_libItem_{book_id(i)}_{i}">Synthetic Book {i}: A Test Adventure</a><p>By: <a href="/author/B0AUTHOR01">Sample Author</a></p><p>Narrated by: <a href="/search?searchNarrator=Sample+Narrator">Sample Narrator</a></p><p>Series: <a href="/series/Sample-Series-Audiobook/B0SERIES01">Sample Series</a>, Book {i}</p></div>{status}{progress}<button>Listen now</button><button>Download</button></article>'''
def library(page=1):
    items=range(1,21) if page==1 else range(21,24)
    nav=('<button disabled>Go back a page</button><span>1</span><a href="/library/titles?page=2">2</a><a aria-label="Go forward a page" href="/library/titles?page=2">Next</a>' if page==1 else '<a aria-label="Go back a page" href="/library/titles?page=1">Back</a><a href="/library/titles?page=1">1</a><span>2</span><button disabled>Go forward a page</button>')
    return f'<html><head><title>My Library | Audible</title></head><body><a href="/library">Library</a><main aria-label="Main Page"><h1>Library</h1><button>Finished</button><div class="items">{"".join(row(i) for i in items)}</div><label>Show <select><option>20</option></select></label><nav>{nav}</nav><section><h2>From your wish list</h2><a href="/pd/Not-Owned-Audiobook/B0WISH0001?ref=wishlist">Do not import this recommendation</a></section></main></body></html>'
def history(url):
    from urllib.parse import urlparse,parse_qs
    q=parse_qs(urlparse(url).query);view=q.get('tf',['orders'])[0];year=q.get('df',['last365'])[0];page=int(q.get('pn',[1])[0])
    selects='<select name="tf">'+''.join(f'<option value="{v}" {"selected" if v==view else ""}>{l}</option>' for v,l in [('orders','Your orders'),('refund','Refund history')])+'</select>'
    selects+='<select name="df">'+''.join(f'<option value="{v}" {"selected" if v==year else ""}>{l}</option>' for v,l in [('last365','Last 365 days'),('2026','2026'),('2014','2014')])+'</select>'
    ids=[1,2] if page==1 else [3]
    if year=='2014':ids=[]
    if view=='refund':ids=[3] if year!='2014' else []
    rows=''
    for i in ids:
        options='Returned on 10-21-26' if view=='refund' else 'Return status: Not eligible'
        rows+=f'<tr><td><a href="/pd/Synthetic-Book-Audiobook/{book_id(i)}">cover</a></td><td>Synthetic Book {i}<br>By: Sample Author</td><td>10-01-2026</td><td>1 Credit</td><td>{options}</td></tr>'
    nav=''
    if view=='orders' and year!='2014':
        nav=f'<nav><span>{page}</span>'+ (f'<a href="/account/purchase-history?tf=orders&df={year}&pn=2">2</a>' if page==1 else f'<a href="/account/purchase-history?tf=orders&df={year}&pn=1">1</a>')+'</nav>'
    return f'<html><body><main aria-label="accountDetails"><h2>Purchase history</h2>{selects}<table><thead><tr><th></th><th>Title</th><th>Purchased</th><th>Total</th><th>Options</th></tr></thead><tbody>{rows}</tbody></table>{nav}</main></body></html>'
def listens():
    rows=''.join(f'<tr><td><a href="/pd/Synthetic-Audiobook/{book_id(i)}">cover</a></td><td>Synthetic Book {i}<div role="progressbar" aria-valuenow="{0 if i==1 else 52}" aria-valuemax="100"></div><span>10h 2m left</span></td><td>10-29-26</td><td>Remove</td></tr>' for i in [1,2])
    return f'<html><body><main aria-label="accountDetails"><h2>Listen history</h2><table><thead><tr><th></th><th>Title</th><th>Listened</th><th>Options</th></tr></thead><tbody>{rows}</tbody></table></main></body></html>'
def catalog():
    return '<html><body><main><h1>Sample Series</h1>'+''.join(f'<article class="productListItem" data-asin="{book_id(i)}"><h3><a href="/pd/Synthetic-Book-Audiobook/{book_id(i)}">Synthetic Book {i}</a></h3><p>Book {i}</p><a href="/author/B0AUTHOR01">Sample Author</a></article>' for i in [1,2,24])+'</main></body></html>'
def fixture_for(url):
    from urllib.parse import urlparse,parse_qs
    u=urlparse(url)
    if u.path.startswith('/library/'):return library(int(parse_qs(u.query).get('page',[1])[0]))
    if u.path=='/account/purchase-history':return history(url)
    if u.path=='/account/listen-history':return listens()
    if u.path.startswith('/series/'):return catalog()
    raise AssertionError('Unexpected synthetic Audible URL '+url)

def main():
    # Network navigation is unavailable in this QA environment. Render only owned,
    # synthetic documents with set_content; do not attempt to reach Audible.
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1280,'height':900})
        script=(ROOT/'extension/extractor.js').read_text()
        results={}
        def extract(html,url,source,context=None):
            html=html.replace('<head>', '<head><base href="'+url+'">',1) if '<head>' in html else html.replace('<html>','<html><head><base href="'+url+'"></head>',1)
            page.set_content(html)
            page.add_style_tag(content='[role="progressbar"]{height:4px;width:100px}article{margin-bottom:20px}article>span{display:block}')
            page.add_script_tag(content=script.replace('location.origin',json.dumps('https://www.audible.com')).replace('location.href',json.dumps(url)).replace('location.pathname',json.dumps(__import__('urllib.parse',fromlist=['urlparse']).urlparse(url).path)))
            data=page.evaluate('([source,context]) => NextChapterExtract(source,context)',[source,context or {}])
            results[url]=data
            return data
        result=extract(library(1),'https://www.audible.com/library/titles','library')
        assert result['ok'],result
        assert len(result['items'])==20
        assert result['items'][0]['id']=='B0TEST0001';record('ASIN extraction uses final URL segment, not the title slug')
        assert not any(x['id']=='B0WISH0001' for x in result['items']);record('Recommendations are excluded from library records')
        assert result['items'][0]['finished'] is True and result['items'][1]['finished'] is False;record('Visible status controls override hidden Finished text')
        assert result['items'][1]['progressPercent']==52 and result['items'][1]['remainingMinutes']==602;record('Numeric progress and remaining time are parsed from rendered DOM')
        assert result['items'][0]['authors']==['Sample Author'] and result['items'][0]['narrators']==['Sample Narrator'];record('Authors and narrators are read from the correct row')
        assert result['items'][0]['series'][0]['position']=='1';record('Series identifier, name and installment are extracted')
        assert result['expectedPages']==2 and result['nextUrl'].endswith('page=2');record('Actual Go forward a page control label is handled')
        final=extract(library(2),result['nextUrl'],'library');assert len(final['items'])==3 and not final['hasNext'];record('Final-page and disabled-next detection work')
        for view in ['orders','refund']:
            for year in ['last365','2026','2014']:
                for pn in ([1,2] if view=='orders' and year!='2014' else [1]):
                    url=f'https://www.audible.com/account/purchase-history?tf={view}&df={year}'+(f'&pn={pn}' if pn>1 else '')
                    extract(history(url),url,'purchases' if view=='orders' else 'refunds')
        h=extract(history('https://www.audible.com/account/purchase-history'),'https://www.audible.com/account/purchase-history','purchases')
        assert h['historyTemplates']['refunds'].endswith('tf=refund&df=last365');record('History navigation uses values read from visible filter options')
        assert h['expectedPages'] is None and h['hasNext'];record('Nonterminal history pagination does not mistake its visible link window for a final total')
        refund=results['https://www.audible.com/account/purchase-history?tf=refund&df=last365'];assert refund['items'][0]['returnDate']=='2026-10-21';record('Return dates are distinct from return eligibility')
        l=extract(listens(),'https://www.audible.com/account/listen-history','listens');assert l['items'][0]['lastListenedDate']=='2026-10-29' and l['items'][0]['progressPercent']==0;record('Listening dates and zero-progress evidence are preserved')
        caturl='https://www.audible.com/series/Sample-Series-Audiobook/B0SERIES01'
        c=extract(catalog(),caturl,'catalog',{'series':{'id':'B0SERIES01','name':'Sample Series','url':caturl}});assert len(c['items'])==3;record('Series catalog supports missing per-row series links using verified parent-series context')
        changed=extract('<html><body><main aria-label="Main Page"><h1>New unsupported layout</h1></main></body></html>','https://www.audible.com/library/titles?changed=1','library');assert not changed['ok'];record('Unsupported library layout fails closed instead of exporting an empty library')
        # A synthetic login/verification document is never submitted or clicked.
        verification=extract('<html><body>Verify you are human</body></html>','https://www.audible.com/library/titles?verify=1','library');assert verification['code']=='VERIFY_REQUIRED';record('Verification page stops collection')
        (OUT/'parser-fixtures.json').write_text(json.dumps(results,indent=2))
        # Render the actual app source with deterministic, in-memory API fixtures.
        html=(ROOT/'app/index.html').read_text().replace('<script type="module" src="/app.js"></script>','')
        html=html.replace('<link rel="stylesheet" href="/style.css">','').replace('<link rel="manifest" href="/manifest.webmanifest">','')
        page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html);page.add_style_tag(content=(ROOT/'app/style.css').read_text())
        model=(ROOT/'app/model.js').read_text().replace('export ','')
        app=(ROOT/'app/app.js').read_text();app=app[app.index('\n')+1:] if '\n' in app else app
        app=app.replace("history.replaceState(null,'',location.pathname);",'')
        mock="""globalThis.fetch=async path=>({ok:true,json:async()=>path==='/api/status'?{setupRequired:false,signedIn:true,version:'0.2.0'}:path==='/api/library'?{books:[],lastSync:null}:path==='/api/devices'?{devices:[]}:path==='/api/runs'?{runs:[]}:{ok:true}});"""
        page.add_script_tag(content='(()=>{'+model+'\n'+mock+'\n'+app+'\n})();')
        page.locator('.empty').wait_for();record('Initial UI reports an empty real library without invented imported data')
        page.locator('[data-demo]').click();page.screenshot(path=str(OUT/'desktop-sample.png'),full_page=True)
        assert page.locator('.book-card').count()==8;record('Fictional sample mode is explicit and isolated')
        page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'iphone-sample.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');record('Phone layout at 390 pixels has no horizontal overflow')
        page.locator('#search').fill('Glass Harvest');assert page.locator('.book-card').count()==1;record('Rendered library search finds a matching title')
        page.locator('.book-card .book-title').click();assert page.locator('#book-dialog').is_visible();record('Book detail dialog opens in phone layout')
        page.locator('#close-dialog').click();page.locator('[data-view="series"]').click();assert page.locator('.series-card').count()==3;record('Series view groups the sample installments')
        page.locator('[data-view="sync"]').click();assert page.locator('#health').inner_text();record('Sync screen shows honest sample-mode status')
        assert not errors,errors;record('Rendered app interactions produced no uncaught JavaScript exceptions')
        browser.close()
    (OUT/'browser-results.json').write_text(json.dumps({'passed':passed,'count':len(passed),'scope':'Rendered synthetic DOM and UI documents only; no live Audible, no network browser navigation, and no actual extension permission prompt was tested'},indent=2))
    print('DOM/UI checks passed:',len(passed),flush=True)
if __name__=='__main__':main()
