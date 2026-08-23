/*
 * A database that accepts the connection and then says nothing.
 *
 * This is what a hung primary, a failed-over cluster, or a black-holing network
 * looks like from the pool's side, and it is the case that ordinary "is the
 * database up?" testing never produces: the socket connects, so nothing errors,
 * and every request waits forever behind it.
 *
 * How the connection bounds in `src/lib/db/index.ts` were verified, and how to
 * verify them again:
 *
 *   node adversarial/blackhole-listener.mjs &
 *   DATABASE_URL=postgres://x:y@127.0.0.1:5544/z npm start
 *   curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' localhost:3000/api/health
 *
 * The health check must answer 503 in about three seconds (its own ping ceiling)
 * and a data route must answer 500 in about eight (the pool's connect timeout).
 * A response that never arrives means a bound was removed.
 */
import { createServer } from "node:net";

const port = Number(process.argv[2] ?? 5544);
createServer((socket) => {
  // Hold the socket open and answer nothing. Swallow the reset the client sends
  // when it finally gives up, or this process dies on an unhandled error event.
  socket.on("error", () => {});
}).listen(port, "127.0.0.1", () => {
  console.log(`blackhole listening on 127.0.0.1:${port} — accepts, never speaks`);
});
