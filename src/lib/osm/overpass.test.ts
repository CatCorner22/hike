import { afterEach, describe, expect, it, vi } from "vitest";
import { searchTrails } from "./overpass";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Overpass trail search query safety", () => {
  it("escapes regex metacharacters and emits bbox in Overpass order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchTrails("Trail.*(all)", [-105, 39, -104, 40]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const encoded = String(init.body).replace(/^data=/, "");
    const query = decodeURIComponent(encoded);
    expect(query).toContain('(39,-105,40,-104)');
    expect(query).toContain('Trail\\.\\*\\(all\\)');
    expect(query).not.toContain('Trail.*(all)');
  });
});
