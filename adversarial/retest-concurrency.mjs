const b = process.env.BASE ?? 'http://127.0.0.1:3111';
let cookie = "";
async function call(path, method='GET', data) {
  const headers = data ? {'content-type':'application/json'} : {};
  if (cookie) headers.cookie = cookie;
  const r = await fetch(b + path, {method, headers, body: data ? JSON.stringify(data) : undefined});
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = {}; }
  return {status:r.status, body};
}
// Sessions are minted only on document navigations; a cookie-less API call is
// refused with 401 by design. Load a page first, exactly like a browser.
{
  const doc = await fetch(b + '/plan', { headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } });
  const setCookie = doc.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  if (!cookie) { console.error('no owner cookie issued; cannot run concurrency probe'); process.exit(2); }
}
const activityRes = await call('/api/activities','POST',{name:'retest',startedAt:'2026-08-20T10:00:00Z'});
if (activityRes.status !== 200 || !activityRes.body?.id) {
  console.error('activity create failed', activityRes.status, JSON.stringify(activityRes.body));
  process.exit(2);
}
const activity = activityRes.body;
const pointResponses = await Promise.all([...Array(50)].map((_,i)=>call('/api/activities/'+activity.id+'/points','POST',{lat:10+i/1000,lng:20,elevation:1,recordedAt:'2026-08-20T10:00:00Z'})));
const pointFinal = await call('/api/activities/'+activity.id+'/points');
const plans=[]; for(let i=0;i<50;i++) plans.push((await call('/api/plans','POST',{name:'p'+i})).body);
// Plan PATCH now requires the caller's `updatedAt` revision so two stale
// full-snapshot writes cannot silently overwrite each other. Send it, as the
// real UI does (it PATCHes the whole loaded plan object).
const patchResponses = await Promise.all(plans.map((p,i)=>call('/api/plans/'+p.id,'PATCH',{...p,notes:'n'+i})));
const all = await call('/api/plans'); const notes = new Map(all.body.plans.map(p=>[p.id,p.notes]));
console.log(JSON.stringify({pointHttp200:pointResponses.filter(r=>r.status===200).length,pointPersisted:pointFinal.body.points?.length,patchHttp200:patchResponses.filter(r=>r.status===200).length,patchRetained:plans.filter((p,i)=>notes.get(p.id)==='n'+i).length,plansVisible:all.body.plans.length},null,2));
