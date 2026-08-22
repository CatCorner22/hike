import { describe, expect, it } from "vitest";
import {
  acknowledgePendingEdit,
  accumulatePendingEdit,
  currentPendingEdit,
  mergeConfirmedEdit,
} from "./edit-merge";

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

describe("pending edit recovery", () => {
  type Edits = {
    name: string;
    notes: string | null;
    plannedDate: string | null;
    campgroundIds: string[] | null;
  };

  it("accumulates queued failures and does not let an unrelated success clear them", () => {
    let pending: Partial<Edits> | null = null;

    pending = accumulatePendingEdit(pending, { name: "Long Ridge" });
    pending = accumulatePendingEdit(pending, { notes: "Carry two liters" });
    pending = acknowledgePendingEdit(pending, {
      plannedDate: "2026-09-12T00:00:00.000Z",
    });

    expect(pending).toEqual({
      name: "Long Ridge",
      notes: "Carry two liters",
    });
  });

  it("clears only fields acknowledged by each successful retry", () => {
    const pending = accumulatePendingEdit<Edits>(null, {
      name: "Long Ridge",
      notes: null,
      campgroundIds: ["camp-1"],
    });

    const afterName = acknowledgePendingEdit(pending, { name: "Long Ridge" });
    expect(afterName).toEqual({ notes: null, campgroundIds: ["camp-1"] });

    const afterNotes = acknowledgePendingEdit(afterName, { notes: null });
    expect(afterNotes).toEqual({ campgroundIds: ["camp-1"] });

    expect(acknowledgePendingEdit(afterNotes, { campgroundIds: ["camp-1"] })).toBeNull();
  });

  it("keeps the latest failed value for a field and ignores values omitted by JSON", () => {
    const first = accumulatePendingEdit<Edits>(null, {
      name: "First name",
      notes: null,
    });
    const latest = accumulatePendingEdit(first, {
      name: "Latest name",
      notes: undefined,
    });

    expect(latest).toEqual({ name: "Latest name", notes: null });
    expect(acknowledgePendingEdit(latest, { name: undefined, notes: undefined })).toEqual(latest);
  });

  it("does not mutate the pending retry payload", () => {
    const pending: Partial<Edits> = { name: "Long Ridge", notes: "Bring shell" };

    expect(acknowledgePendingEdit(pending, { name: "Long Ridge" })).toEqual({
      notes: "Bring shell",
    });
    expect(pending).toEqual({ name: "Long Ridge", notes: "Bring shell" });
  });

  it("retries failed fields with the latest draft values", () => {
    const pending: Partial<Edits> = {
      name: "Old failed name",
      notes: "Old failed notes",
    };
    const current: Edits = {
      name: "Latest typed name",
      notes: "Latest typed notes",
      plannedDate: "2026-09-12T00:00:00.000Z",
      campgroundIds: ["camp-2"],
    };

    expect(currentPendingEdit(pending, current)).toEqual({
      name: "Latest typed name",
      notes: "Latest typed notes",
    });
    expect(currentPendingEdit(null, current)).toBeNull();
  });
});
