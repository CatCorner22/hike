import { describe, expect, it } from "vitest";
import { MAX_OUTBOUND_BYTES, OutboundTooLargeError, readJsonCapped } from "./outbound";

function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json", ...headers } });
}

describe("readJsonCapped", () => {
  it("parses a normal response", async () => {
    const body = await readJsonCapped<{ ok: boolean }>(streamed(['{"ok":', "true}"]));
    expect(body.ok).toBe(true);
  });

  /**
   * These bodies come from third parties, one of which is reachable with a
   * user-influenced bounding box. AbortSignal.timeout bounds the headers, not
   * the body, so without a cap an oversized or endless stream could exhaust
   * server memory -- and the server is what a hiker needs at the trailhead.
   */
  it("refuses a body past the cap instead of buffering it", async () => {
    const chunk = "x".repeat(1024);
    const chunks = Array.from({ length: 40 }, () => chunk);
    await expect(readJsonCapped(streamed(chunks), 8 * 1024)).rejects.toBeInstanceOf(
      OutboundTooLargeError,
    );
  });

  it("refuses early when Content-Length already exceeds the cap", async () => {
    const response = streamed(["{}"], { "content-length": String(MAX_OUTBOUND_BYTES + 1) });
    await expect(readJsonCapped(response)).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it("still rejects invalid JSON rather than returning a partial object", async () => {
    await expect(readJsonCapped(streamed(["{not json"]))).rejects.toBeInstanceOf(Error);
  });
});
