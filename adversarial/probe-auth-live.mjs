import crypto from 'node:crypto';
const B='http://127.0.0.1:3111', tag=`auth-${Date.now()}-${crypto.randomUUID().slice(0,6)}`; const made=[];
async function f(p,o={}){const r=await fetch(B+p,{redirect:'manual',...o});const t=await r.text();let j;try{j=JSON.parse(t)}catch{}return {r,t,j}}
async function mint(){const x=await f('/plan',{headers:{'sec-fetch-dest':'document',accept:'text/html'}});const c=(x.r.headers.get('set-cookie')||'').split(';')[0];if(!c.startsWith('hike_owner='))throw Error('no cookie '+x.r.status);return c}
async function api(p,c,method='GET',body){return f(p,{method,headers:{...(c?{cookie:c}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
function out(n,ok,d){console.log(`${ok?'PASS':'FAIL'} ${n} :: ${d}`)}
const a=await mint(), b=await mint();
const pa=await api('/api/plans',a,'POST',{name:tag+'-a'}); made.push([a,pa.j?.id]);
const pb=await api('/api/plans',b,'POST',{name:tag+'-b'}); made.push([b,pb.j?.id]);
out('mint and create',pa.r.status===200&&pb.r.status===200,`A=${pa.r.status} B=${pb.r.status}`);
const tok=decodeURIComponent(a.slice(11)), [id,sig]=tok.split('.');
for(const [n,c] of [['forged owner',`hike_owner=${id.slice(0,-1)}x.${sig}`],['truncated signature',`hike_owner=${id}.${sig.slice(0,-1)}`],['signature reuse',`hike_owner=${decodeURIComponent(b.slice(11)).split('.')[0]}.${sig}`]]){const x=await api('/api/plans',c);out(n,x.r.status===401,`HTTP ${x.r.status}`)}
const bad=await api('/api/plans','hike_owner=%');out('malformed percent cookie no 5xx',bad.r.status<500,`HTTP ${bad.r.status}`);
const cross=await api(`/api/plans/${pa.j.id}`,b);const crossPatch=await api(`/api/plans/${pa.j.id}`,b,'PATCH',{notes:'cross'});const crossDel=await api(`/api/plans/${pa.j.id}`,b,'DELETE');
out('plan IDOR denied',cross.r.status===404&&crossPatch.r.status===404&&crossDel.r.status===404,`GET=${cross.r.status} PATCH=${crossPatch.r.status} DELETE=${crossDel.r.status}`);
const act=await api('/api/activities',a,'POST',{name:tag+'-act'}); const aid=act.j?.id; const point={lat:40,lng:-105,recordedAt:'2026-08-20T12:00:00Z'}; const ownPoint=await api(`/api/activities/${aid}/points`,a,'POST',point); const otherAct=await api(`/api/activities/${aid}`,b);const otherPts=await api(`/api/activities/${aid}/points`,b);const otherPost=await api(`/api/activities/${aid}/points`,b,'POST',point);
out('activity and point IDOR denied',ownPoint.r.status===200&&otherAct.r.status===404&&otherPts.r.status===404&&otherPost.r.status===404,`own=${ownPoint.r.status} detail=${otherAct.r.status} points=${otherPts.r.status} post=${otherPost.r.status}`);
const cache=await api('/api/plans',a);out('per-owner API cache protection',cache.r.headers.get('cache-control')==='no-store',`Cache-Control=${cache.r.headers.get('cache-control')}`);
const toss=await api('/api/plans',`${a}; ${b}`,'POST',{name:tag+'-toss'});made.push([a,toss.j?.id]);const al=await api('/api/plans',a), bl=await api('/api/plans',b);out('duplicate cookie selects first session',al.j?.plans?.some(x=>x.id===toss.j?.id)&&!bl.j?.plans?.some(x=>x.id===toss.j?.id),`POST=${toss.r.status} attacker=${al.j?.plans?.some(x=>x.id===toss.j?.id)} victim=${bl.j?.plans?.some(x=>x.id===toss.j?.id)}`);
for(const [c,i] of made)if(i)await api(`/api/plans/${i}`,c,'DELETE');
