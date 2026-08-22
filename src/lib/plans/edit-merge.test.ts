import { describe, expect, it } from "vitest";
import { mergeConfirmedEdit } from "./edit-merge";

describe("mergeConfirmedEdit", () => {
  const base = {
    name: "Old name",
    notes: "Old notes",
    plannedDate: null as string | null,
    updatedAt: "2026-08-22T12:00:00.000Z",
  };
  const keys = ["name", "notes", "plannedDate"] as const;

  it("accepts the acknowledged field and revision while preserving an unsent draft", () => {
    const latestDraft = { ...base, name: "New name", notes: "Still typing" };
    const confirmed = {
      ...base,
      name: "New name",
      updatedAt: "2026-08-22T12:00:01.000Z",
    };

    expect(mergeConfirmedEdit({
      confirmed,
      requestBase: { ...base, name: "New name" },
      latestDraft,
      submitted: { name: "New name" },
      editableKeys: keys,
    })).toEqual({
      ...confirmed,
      notes: "Still typing",
    });
  });

  it("preserves a newer edit to the same field made while saving", () => {
    const requestBase = { ...base, name: "First edit" };
    const latestDraft = { ...requestBase, name: "Second edit" };
    const confirmed = {
      ...base,
      name: "First edit",
      updatedAt: "2026-08-22T12:00:01.000Z",
    };

    expect(mergeConfirmedEdit({
      confirmed,
      requestBase,
      latestDraft,
      submitted: { name: "First edit" },
      editableKeys: keys,
    }).name).toBe("Second edit");
  });
});
