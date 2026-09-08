/**
 * How the party size should read on a card handed to somebody else.
 *
 * A number nobody stated is not a fact about the party — it is the app's own
 * default. Printing "Party size: 1" for a group of nine sends one searcher to
 * find one person; printing that it was never stated sends them to ask.
 */
export function partySizeLine(profile: { partySize?: number | null; partySizeConfirmed?: boolean }): string {
  if (!profile.partySizeConfirmed) return "not stated — ask the contact how many went out";
  const size = profile.partySize;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 1) {
    return "not stated — ask the contact how many went out";
  }
  return String(Math.floor(size));
}
