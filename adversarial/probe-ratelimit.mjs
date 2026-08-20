// Rate limiter: enforceable at all, and is its key trustworthy?
const B = process.env.BASE ?? "http://127.0.0.1:3111";
// q shorter than 2 chars returns early WITHOUT touching the blocked upstream,
// so the burst is fast enough to stay inside one 60s window. The limiter runs
// before that early return, so this still exercises it.
const hit = (xff) =>
  fetch(`${B}/api/trails/search?q=a`, { headers: { "x-forwarded-for": xff } }).then((r) => r.status);

const fixed = await Promise.all(Array.from({ length: 40 }, () => hit("203.0.113.50")));
console.log(`fixed XFF:    429s = ${fixed.filter((s) => s === 429).length}/40 (limit 20)`);

const rotated = await Promise.all(
  Array.from({ length: 40 }, (_, i) => hit(`198.51.100.${i}`)),
);
console.log(`rotated XFF:  429s = ${rotated.filter((s) => s === 429).length}/40`);

const absent = await Promise.all(Array.from({ length: 40 }, () => hit("")));
console.log(`absent XFF:   429s = ${absent.filter((s) => s === 429).length}/40`);
