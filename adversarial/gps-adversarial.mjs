import { chromium } from 'playwright';
import { OPEN_ENSURING_STORES, NAV_PACK_STORES, packFixture, clearReadinessGate } from './idb-open.mjs';
const BASE=process.env.BASE||'http://127.0.0.1:3111'; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const OUT=[];function log(name,pass,detail,severity='INFO'){OUT.push({name,pass,detail,severity});console.log(`${pass?'PASS':'FAIL'} ${name}: ${detail}`)}
const geom={type:'LineString',coordinates:Array.from({length:40},(_,i)=>[-119.5383+i*.0003,37.7749+i*.00015])};
async function putPack(page, id, geometry = geom) {
  // Build the fixture in Node against the real validation rules, so the probe
  // exercises the app rather than tripping its integrity check.
  const pack = packFixture(id, geometry.coordinates);
  return await page.evaluate(
    async ({ pack, stores, helperSrc }) => {
      const openEnsuringStores = new Function(`${helperSrc}; return openEnsuringStores;`)();
      const db = await openEnsuringStores("hike-nav-packs", stores);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(["routePacks", "aliases"], "readwrite");
        tx.objectStore("routePacks").put(pack);
        tx.objectStore("aliases").put({ alias: pack.id, canonicalId: pack.id });
        tx.oncomplete = () => resolve(`v${db.version}`);
        tx.onerror = () => reject(tx.error);
      });
    },
    { pack, stores: NAV_PACK_STORES, helperSrc: OPEN_ENSURING_STORES },
  );
}
async function trackCount(page){return await page.evaluate(async()=>new Promise(resolve=>{const r=indexedDB.open('hike-nav-tracks');r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains('sessions'))return resolve(0);const q=d.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>resolve(q.result.reduce((s,x)=>s+(x.points?.length||0),0));q.onerror=()=>resolve(-1)};r.onerror=()=>resolve(-2)}))}
const browser=await chromium.launch();
try{const context=await browser.newContext({serviceWorkers:'allow',permissions:['geolocation'],geolocation:{latitude:37.7749,longitude:-119.5383,accuracy:5}});const page=await context.newPage();page.on('pageerror',e=>log('pageerror',false,e.message,'HIGH'));await page.goto(BASE,{waitUntil:'domcontentloaded'});const id='plan-gps-adversarial';await putPack(page,id);await page.goto(`${BASE}/navigate/${id}`,{waitUntil:'domcontentloaded',timeout:60000});await clearReadinessGate(page);await page.waitForSelector('canvas',{timeout:30000});await sleep(1500);let body=await page.locator('body').innerText();log('gps/live-initial-load',/Offline pack|Saved to device/.test(body)&&!body.includes('This page couldn'),body.slice(0,120).replace(/\s+/g,' '));
// 500km teleport and 5km accuracy.
await context.setGeolocation({latitude:42.2,longitude:-114.2,accuracy:5});await sleep(1200);await context.setGeolocation({latitude:42.25,longitude:-114.25,accuracy:5});await sleep(10000);body=await page.locator('body').innerText();const countAfterTeleport=await trackCount(page);log('gps/teleport-anomaly-warning',/GPS jumped hundreds of metres|OFF TRAIL —/.test(body),`trackPoints=${countAfterTeleport}; banner=${body.match(/(GPS jumped hundreds[^\n]+|OFF TRAIL —[^\n]+)/)?.[0]||'none'}`,'HIGH');
await context.setGeolocation({latitude:37.7749,longitude:-119.5383,accuracy:5000});await sleep(1500);body=await page.locator('body').innerText();log('gps/accuracy-5000-poor-warning',/GPS accuracy is poor|GPS ±5000 m/.test(body),body.match(/GPS[^\n]{0,80}/)?.[0]||'no gps text','MEDIUM');
const beforeFrozen=await trackCount(page);for(let i=0;i<4;i++){await context.setGeolocation({latitude:37.7749,longitude:-119.5383,accuracy:5});await sleep(500)}await sleep(8500);const afterFrozen=await trackCount(page);log('gps/frozen-repeated-fix',afterFrozen-beforeFrozen<=4,`points before=${beforeFrozen} after=${afterFrozen}`,'INFO');
await context.setGeolocation({latitude:0,longitude:0,accuracy:5});await sleep(1500);body=await page.locator('body').innerText();log('gps/null-island-off-route',/OFF TRAIL —|Drifting off trail/.test(body),body.match(/(OFF TRAIL —[^\n]+|Drifting off trail[^\n]+)/)?.[0]||'none','MEDIUM');
const antiId='plan-gps-antimeridian';await putPack(page,antiId,{type:'LineString',coordinates:[[179.9,0],[-179.9,0]]});await context.setGeolocation({latitude:0,longitude:179.95,accuracy:5});await page.goto(`${BASE}/navigate/${antiId}`,{waitUntil:'domcontentloaded',timeout:60000});await clearReadinessGate(page);await page.waitForSelector('canvas',{timeout:30000});await sleep(1500);body=await page.locator('body').innerText();const antiOffset=body.match(/OFF TRAIL\s*\n\s*([\d.]+)\s*m/)?.[1];log('gps/antimeridian-on-route-not-offtrail',!/OFF TRAIL —|Drifting off trail/.test(body)&&antiOffset!=null&&Number(antiOffset)<100,`offset=${antiOffset??'unreadable'} m; banner=${body.match(/(OFF TRAIL —[^\n]+|Drifting off trail[^\n]+)/)?.[0]||'none'}`,'MEDIUM');
}finally{await browser.close()}
console.log('\nGPS_JSON='+JSON.stringify(OUT,null,2));
