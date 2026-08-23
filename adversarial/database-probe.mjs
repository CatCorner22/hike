/**
 * The things only a real database can decide.
 *
 * Two of them. The GPS-point write path is the request that carries a finished
 * hike home, and it is the one that shipped answering 500 on every deployment
 * because nothing but production ever ran it: the unit suite checks the
 * statement's shape, but only a database can say that a replayed batch does not
 * duplicate, that duplicates inside one batch collapse, that a finalized track
 * refuses new points while still tolerating a retry, and that another owner sees
 * nothing. Guardian-link retention is the other: expired and revoked rows were
 * hidden from every read and never deleted.
 *
 * Both are arbitrated by unique indexes, INSERT predicates and DELETE
 * statements, so no amount of unit testing reaches them.
 *
 * Usage: BASE=http://127.0.0.1:3111 DATABASE_URL=... node adversarial/database-probe.mjs
 */
const BASE = process.env.BASE ?? process.env.API_BASE ?? "http://127.0.0.1:3111";
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${detail}`); }
}

async function mintOwner() {
  const res = await fetch(`${BASE}/plan`, { headers: { accept: "text/html" } });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const cookie = await mintOwner();
const headers = { "content-type": "application/json", cookie };

async function newActivity(name) {
  const res = await fetch(`${BASE}/api/activities`, {
    method: "POST", headers,
    body: JSON.stringify({ name, startedAt: new Date().toISOString() }),
  });
  return (await res.json())?.id;
}
async function post(id, points) {
  const res = await fetch(`${BASE}/api/activities/${id}/points`, {
    method: "POST", headers, body: JSON.stringify({ points }),
  });
  return { status: res.status, body: await res.json() };
}
async function count(id) {
  const res = await fetch(`${BASE}/api/activities/${id}/points?limit=2000`, { headers });
  const body = await res.json();
  return body?.points?.length ?? -1;
}
const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const pt = (n, extra = {}) => ({ lat: 37.75 + n * 1e-4, lng: -119.6 + n * 1e-4, recordedAt: at(n), ...extra });

// 1. Idempotent replay: the same batch twice must not duplicate.
{
  const id = await newActivity("replay");
  const batch = [pt(1, { clientPointId: "a" }), pt(2, { clientPointId: "b" }), pt(3, { clientPointId: "c" })];
  const first = await post(id, batch);
  const second = await post(id, batch);
  check("replayed batch stores three rows once",
    first.status === 200 && second.status === 200 && (await count(id)) === 3,
    `first=${first.status} second=${second.status} count=${await count(id)}`);
  check("replay returns the same row ids",
    JSON.stringify(first.body.points.map((p) => p.id)) === JSON.stringify(second.body.points.map((p) => p.id)));
}

// 2. Duplicates inside one batch collapse.
{
  const id = await newActivity("intra-batch");
  const dup = pt(9, { clientPointId: "dup" });
  const res = await post(id, [dup, dup, dup, pt(10, { clientPointId: "other" })]);
  check("duplicates within one batch collapse to one row",
    res.status === 200 && (await count(id)) === 2, `status=${res.status} count=${await count(id)}`);
  check("every input point still gets a row back",
    res.body.points.length === 4 && res.body.points.every((p) => p && p.id));
  check("the three duplicates map to one id",
    new Set(res.body.points.slice(0, 3).map((p) => p.id)).size === 1);
}

// 3. Points with no client key dedupe on (time, lat, lng).
{
  const id = await newActivity("no-client-key");
  const bare = [pt(20), pt(21)];
  await post(id, bare);
  const again = await post(id, bare);
  check("keyless points dedupe on the fix tuple",
    again.status === 200 && (await count(id)) === 2, `count=${await count(id)}`);
}

// 4. Mixed: some already stored, some new.
{
  const id = await newActivity("mixed");
  await post(id, [pt(30, { clientPointId: "x" })]);
  const res = await post(id, [pt(30, { clientPointId: "x" }), pt(31, { clientPointId: "y" })]);
  check("a mixed batch stores only the new point",
    res.status === 200 && (await count(id)) === 2 && res.body.points.length === 2,
    `count=${await count(id)}`);
}

// 5. A finalized activity refuses new points but still accepts a replay.
{
  const id = await newActivity("finalized");
  await post(id, [pt(40, { clientPointId: "keep" })]);
  const done = await fetch(`${BASE}/api/activities/${id}`, {
    method: "PATCH", headers, body: JSON.stringify({ endedAt: new Date().toISOString() }),
  });
  const replay = await post(id, [pt(40, { clientPointId: "keep" })]);
  const fresh = await post(id, [pt(41, { clientPointId: "new" })]);
  check("finalizing succeeds", done.status === 200, `status=${done.status}`);
  check("a replay of a stored point after finalize is still 200", replay.status === 200, `status=${replay.status}`);
  check("a new point after finalize is 409", fresh.status === 409, `status=${fresh.status}`);
  check("the finalized track did not grow", (await count(id)) === 1);
}

// 6. Elevation and nulls survive the round trip.
{
  const id = await newActivity("fields");
  await post(id, [{ ...pt(50, { clientPointId: "e" }), elevation: 1234.5 }, pt(51, { clientPointId: "f" })]);
  const res = await fetch(`${BASE}/api/activities/${id}/points`, { headers });
  const points = (await res.json()).points;
  check("elevation round-trips", points.find((p) => p.clientPointId === "e")?.elevation === 1234.5,
    JSON.stringify(points.map((p) => p.elevation)));
  check("a missing elevation stays null", points.find((p) => p.clientPointId === "f")?.elevation === null);
  check("recordedAt round-trips", new Date(points[0].recordedAt).toISOString() === at(50));
}

// 7. Someone else's activity is invisible.
{
  const id = await newActivity("owned");
  const otherCookie = await mintOwner();
  const res = await fetch(`${BASE}/api/activities/${id}/points`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: otherCookie },
    body: JSON.stringify({ points: [pt(60, { clientPointId: "intruder" })] }),
  });
  check("another owner gets 404, not a write", res.status === 404, `status=${res.status}`);
  check("and nothing landed", (await count(id)) === 0);
}

console.log(`\nPOINTS SUMMARY pass=${pass} fail=${fail}`);

/**
 * Guardian links are promised revocable and short-lived. Expired and revoked
 * rows were correctly hidden from every read and never deleted, so the route
 * name and the last published progress, ETA, battery and deviation stayed in the
 * table forever. "Short-lived" has to mean the data, not only the access.
 */
{
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("SKIP guardian retention (no DATABASE_URL in this environment)");
  } else {
    const sql = new Client({ connectionString: url });
    await sql.connect();
    const owner = "retention-probe-owner";
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const soon = new Date(Date.now() + 3600 * 1000).toISOString();
    await sql.query("delete from guardian_shares where owner_id = $1", [owner]);
    await sql.query(
      `insert into guardian_shares (owner_id, token_hash, route_name, expires_at, revoked_at)
       values ($1,'probe-expired','Expired link',$2,null),
              ($1,'probe-revoked','Revoked link',$3,$2),
              ($1,'probe-live','Live link',$3,null)`,
      [owner, old, soon],
    );
    const before = await sql.query("select count(*)::int as n from guardian_shares where owner_id=$1", [owner]);

    // A new link is what triggers the purge, so make one the normal way.
    const created = await fetch(`${BASE}/api/guardian`, {
      method: "POST", headers,
      body: JSON.stringify({ routeName: "Retention trigger", expiresInHours: 24 }),
    });
    // Give the fire-and-forget purge a moment to commit.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = await sql.query(
      "select route_name from guardian_shares where owner_id=$1 order by route_name", [owner],
    );
    const names = after.rows.map((r) => r.route_name);
    check("a new link triggers the purge", created.status === 200 || created.status === 201,
      `status=${created.status}`);
    check("three finished-or-live links existed before", before.rows[0].n === 3);
    check("the expired link is gone", !names.includes("Expired link"), JSON.stringify(names));
    check("the revoked link is gone", !names.includes("Revoked link"), JSON.stringify(names));
    check("the live link survives", names.includes("Live link"), JSON.stringify(names));
    await sql.query("delete from guardian_shares where owner_id = $1", [owner]);
    await sql.end();
  }
}

console.log(`\nRETENTION SUMMARY pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
