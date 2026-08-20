import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { packFixture, clearReadinessGate, OPEN_ENSURING_STORES, NAV_PACK_STORES } from './idb-open.mjs';

const BASE = 'http://127.0.0.1:3111';
const OUT = '/home/user/workspace';
const NAV_ID = 'plan-duress-fixture';
const route = [
  [-119.5383, 37.7749], [-119.5363, 37.7755], [-119.5343, 37.7761], [-119.5323, 37.7767],
];
const offTrailGeo = { latitude: 37.7782, longitude: -119.5353, accuracy: 5, altitude: 2100, heading: 48 };
const pack = { ...packFixture(NAV_ID, route), name: 'Duress audit route — West Fork' };

async function installPack(page) {
  await page.evaluate(async ({ source, stores, pack: fixture }) => {
    // eslint-disable-next-line no-eval
    eval(source);
    const db = await openEnsuringStores('hike-nav-packs', stores);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['routePacks', 'aliases'], 'readwrite');
      tx.objectStore('routePacks').put(fixture);
      tx.objectStore('aliases').put({ alias: fixture.id, canonicalId: fixture.id });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { source: OPEN_ENSURING_STORES, stores: NAV_PACK_STORES, pack });
}

async function newNavPage(browser, { width = 414, height = 896, forcedColors = 'none', reducedMotion = 'no-preference', textScale = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
    geolocation: offTrailGeo,
    colorScheme: 'light',
    forcedColors,
    reducedMotion,
  });
  const page = await context.newPage();
  if (textScale !== 1) {
    const cdp = await context.newCDPSession(page);
    try { await cdp.send('Emulation.setEmulatedOSTextScale', { scale: textScale }); } catch (e) { console.log('OSTextScale unsupported:', e.message); }
  }
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await installPack(page);
  await page.goto(`${BASE}/navigate/${NAV_ID}`, { waitUntil: 'domcontentloaded' });
  const gate = await clearReadinessGate(page);
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByText(/OFF TRAIL/i).first().waitFor({ state: 'visible', timeout: 15000 });
  return { context, page, gate };
}

function toJson(val) { return JSON.stringify(val, null, 2); }

async function contrastReport(page) {
 return await page.evaluate(() => {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const parse=(value)=>{try{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;return {r:d[0],g:d[1],b:d[2],a:d[3]/255};}catch{return null;}};
  const blend = (fg, bg) => { const a=fg.a+bg.a*(1-fg.a); return a===0?{r:0,g:0,b:0,a:0}:{r:(fg.r*fg.a+bg.r*bg.a*(1-fg.a))/a,g:(fg.g*fg.a+bg.g*bg.a*(1-fg.a))/a,b:(fg.b*fg.a+bg.b*bg.a*(1-fg.a))/a,a};};
  const lum=(c)=>{const f=x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
  const ratio=(a,b)=>{const A=lum(a),B=lum(b);return (Math.max(A,B)+.05)/(Math.min(A,B)+.05)};
  const effectiveBg=(el)=>{let result={r:255,g:255,b:255,a:1};const chain=[];for(let n=el;n;n=n.parentElement)chain.unshift(n);for(const n of chain){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0)result=blend(c,result)}return result};
  const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0};
  const path=(el)=>{const ps=[];for(let n=el;n&&n!==document.body;n=n.parentElement){let x=n.tagName.toLowerCase();if(n.id)x+='#'+n.id;else if(n.getAttribute('aria-label'))x+='['+n.getAttribute('aria-label')+']';ps.unshift(x)}return ps.join('>')};
  const nodes=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const text=n.textContent.replace(/\s+/g,' ').trim(),el=n.parentElement;if(!text||!el||!visible(el))continue;const s=getComputedStyle(el),fg=parse(s.color),bg=effectiveBg(el);if(!fg)continue;const actual=blend(fg,bg),fs=parseFloat(s.fontSize),weight=Number(s.fontWeight)||400,large=fs>=24||(fs>=18.66&&weight>=700),cr=ratio(actual,bg),min=large?3:4.5;if(cr<min){const r=el.getBoundingClientRect();nodes.push({text:text.slice(0,180),ratio:+cr.toFixed(2),threshold:min,fontPx:+fs.toFixed(2),weight,color:s.color,background:`rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},path:path(el)})}}
  return nodes.sort((a,b)=>a.ratio-b.ratio);
 });
}

async function interactionReport(page) {
 return await page.evaluate(() => {
 const visible = (el) => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0; };
 const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g,' ').trim();
 const lab = (el) => { if(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby'))return true; if(el.id&&document.querySelector(`label[for="${CSS.escape(el.id)}"]`))return true; return Boolean(name(el)); };
 const controls=[...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="checkbox"],[role="switch"]')].filter(visible).map((el,i)=>{const r=el.getBoundingClientRect(); return {i,tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||'',name:name(el).slice(0,120),labelled:lab(el),disabled:el.matches(':disabled'),rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},center:{x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1)},below44:r.width<44||r.height<44};});
 const close=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j],d=Math.hypot(a.center.x-b.center.x,a.center.y-b.center.y);if(d<8)close.push({a:a.name,b:b.name,distance:+d.toFixed(2)});}
 const live=[...document.querySelectorAll('[role="alert"],[role="status"],[role="alertdialog"],[aria-live]')].filter(visible).map(el=>({role:el.getAttribute('role'),live:el.getAttribute('aria-live'),text:el.innerText.slice(0,180)}));
 const critical=[...document.querySelectorAll('*')].filter(visible).filter(el=>/OFF TRAIL|OVERDUE|GPS DENIED|Drifting off trail/i.test(el.childElementCount===0?el.textContent||'':'')).map(el=>({tag:el.tagName.toLowerCase(),text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),role:el.getAttribute('role'),live:el.getAttribute('aria-live'),class:el.className?.toString().slice(0,180)}));
 return {controls, below44:controls.filter(x=>x.below44), centersUnder8:close, live, critical, viewport:{w:innerWidth,h:innerHeight,scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight}};
 });
}

async function visualState(page) {
 return await page.evaluate(() => {
 const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};
 const elements=[...document.querySelectorAll('button,p,div')].filter(visible).filter(e=>/OFF TRAIL|USNG|Safety and SOS|Red|NVG|Day|Beacon/i.test(e.innerText||'')).slice(0,40).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:(e.innerText||'').replace(/\s+/g,' ').slice(0,120),color:s.color,bg:s.backgroundColor,rect:{x:r.x,y:r.y,w:r.width,h:r.height}}});
 return {elements};
 });
}

async function viewportIssues(page) {
 return await page.evaluate(() => {
  const visible=(e)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};
  const items=[...document.querySelectorAll('button,input,canvas,p')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,name:(e.getAttribute('aria-label')||e.innerText||'').replace(/\s+/g,' ').slice(0,90),rect:{x:r.x,y:r.y,w:r.width,h:r.height},clipped:r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight};});
  return {document:{w:innerWidth,h:innerHeight,scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight},clipped:items.filter(x=>x.clipped),required:items.filter(x=>/OFF TRAIL|USNG|Safety and SOS|Beacon|Remaining|Off trail/i.test(x.name))};
 });
}

const browser=await chromium.launch({headless:true});
const results={generatedAt:new Date().toISOString(), base:BASE, scenarios:{}};
try {
  let {context,page,gate}=await newNavPage(browser);
  results.scenarios.day={gate,contrast:await contrastReport(page),interactions:await interactionReport(page),visual:await visualState(page),fit:await viewportIssues(page)};
  await page.screenshot({path:`${OUT}/duress-day-offtrail-414x896.png`});
  await page.getByRole('button',{name:'Safety and SOS'}).click();
  await page.getByRole('heading',{name:'Safety & SOS'}).waitFor({state:'visible'});
  results.scenarios.sheet={interactions:await interactionReport(page),contrast:await contrastReport(page),fit:await viewportIssues(page)};
  await page.screenshot({path:`${OUT}/duress-safety-sheet-414x896.png`});
  await context.close();

  ({context,page,gate}=await newNavPage(browser));
  await page.getByRole('button',{name:'Day'}).click();
  await page.getByRole('button',{name:'Red'}).waitFor({state:'visible'});
  results.scenarios.red={gate,contrast:await contrastReport(page),interactions:await interactionReport(page),visual:await visualState(page),fit:await viewportIssues(page)};
  await page.screenshot({path:`${OUT}/duress-red-offtrail-414x896.png`});
  await page.getByRole('button',{name:'Red'}).click();
  await page.getByRole('button',{name:'NVG'}).waitFor({state:'visible'});
  results.scenarios.nvg={contrast:await contrastReport(page),visual:await visualState(page),fit:await viewportIssues(page)};
  await page.screenshot({path:`${OUT}/duress-nvg-offtrail-414x896.png`});
  await context.close();

  ({context,page,gate}=await newNavPage(browser,{width:320,height:640,textScale:2}));
  results.scenarios.textScale200_320={gate,contrast:await contrastReport(page),interactions:await interactionReport(page),fit:await viewportIssues(page)};
  await page.screenshot({path:`${OUT}/duress-textscale200-320x640.png`});
  await context.close();

  ({context,page,gate}=await newNavPage(browser,{width:414,height:400}));
  results.scenarios.shortLandscape={gate,fit:await viewportIssues(page),interactions:await interactionReport(page)};
  await page.screenshot({path:`${OUT}/duress-short-414x400.png`});
  await context.close();

  ({context,page,gate}=await newNavPage(browser,{width:414,height:896,forcedColors:'active',reducedMotion:'reduce'}));
  results.scenarios.forcedColorsReducedMotion={gate,contrast:await contrastReport(page),fit:await viewportIssues(page),visual:await visualState(page),media:await page.evaluate(()=>({forced:matchMedia('(forced-colors: active)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}))};
  await page.screenshot({path:`${OUT}/duress-forcedcolors-reducedmotion-414x896.png`});
  await context.close();
} finally { await browser.close(); }
await writeFile('/home/user/workspace/hike/adversarial/scratch-duress-results.json', toJson(results));
console.log(toJson({
  screenshots:['duress-day-offtrail-414x896.png','duress-safety-sheet-414x896.png','duress-red-offtrail-414x896.png','duress-nvg-offtrail-414x896.png','duress-textscale200-320x640.png','duress-short-414x400.png','duress-forcedcolors-reducedmotion-414x896.png'],
  day:{contrastFails:results.scenarios.day.contrast.length,targetsBelow44:results.scenarios.day.interactions.below44.length,critical:results.scenarios.day.interactions.critical,live:results.scenarios.day.interactions.live},
  sheet:{targetsBelow44:results.scenarios.sheet.interactions.below44.length},
  red:{contrastFails:results.scenarios.red.contrast.length}, nvg:{contrastFails:results.scenarios.nvg.contrast.length},
  textScale:results.scenarios.textScale200_320.fit,short:results.scenarios.shortLandscape.fit,forced:results.scenarios.forcedColorsReducedMotion.media
}));
