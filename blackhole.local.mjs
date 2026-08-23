/* Accepts TCP connections and never speaks. This is what a hung database,
   a failed-over primary, or a black-holing network looks like to a pool. */
import { createServer } from "node:net";
createServer((socket) => { socket.on("error", () => {}); }).listen(5544, "127.0.0.1", () =>
  console.log("blackhole on 5544"));
