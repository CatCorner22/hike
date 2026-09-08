import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityRecorder } from "./activity-recorder";

describe("ActivityRecorder recovery gate", () => {
  it("does not offer Start before unfinished recordings have been checked", () => {
    const html = renderToStaticMarkup(createElement(ActivityRecorder, { trailId: "trail-1" }));

    expect(html).toContain("Checking this device for an unfinished recording");
    expect(html).toContain("Checking unfinished recordings");
    expect(html).not.toContain("Start recording");
    expect(html).not.toContain("Resume");
  });
});
