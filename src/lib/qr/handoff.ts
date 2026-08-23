import { formatZulu } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";
import type { IceProfile } from "@/lib/safety/profile";
import type { PositionSource } from "@/lib/safety/emergency";
import { reportField } from "@/lib/safety/report-field";

/**
 * The compact SAR handoff a QR code can actually carry.
 *
 * The full safety dossier does not fit in a scannable code, and does not need to: the
 * handoff's job is to move the load-bearing facts — who, where, when, provenance of
 * the fix, return deadline, ICE contact — onto ANY nearby phone with a camera, with no
 * signal, app, or pairing on either side. Every field is optional and degrades to an
 * honest label rather than being silently dropped; position provenance is stated in
 * the payload itself so a relayed fix can never masquerade as live GPS.
 *
 * Deliberately excluded: the duress challenge/password (handing those to a stranger's
 * phone defeats their purpose) and anything else not needed to find or help the hiker.
 */
export function buildSarHandoff(input: {
  trailName?: string | null;
  lat?: number | null;
  lng?: number | null;
  recordedAt?: number | string | null;
  positionSource?: PositionSource | null;
  stale?: boolean;
  returnAtIso?: string | null;
  profile?: IceProfile | null;
}): string {
  const hasFix =
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng) &&
    Math.abs(input.lat) <= 90 &&
    Math.abs(input.lng) <= 180;

  const lines: string[] = ["SAR HANDOFF"];
  if (input.trailName) lines.push(reportField(input.trailName, 60));

  if (hasFix) {
    const grid = formatUsng(input.lat!, input.lng!, 5);
    const decimal = `${input.lat!.toFixed(5)}, ${input.lng!.toFixed(5)}`;
    lines.push(grid ? `${grid} / ${decimal}` : decimal);
    const recordedMs =
      typeof input.recordedAt === "number"
        ? input.recordedAt
        : input.recordedAt
          ? Date.parse(input.recordedAt)
          : Number.NaN;
    const when = Number.isFinite(recordedMs) ? formatZulu(new Date(recordedMs)) : "time UNKNOWN";
    const provenance =
      input.positionSource === "deadReckon"
        ? "DEAD RECKON — not live GPS"
        : input.positionSource === "lastKnown" || input.stale
          ? "LAST KNOWN — GPS not live"
          : "live GPS";
    lines.push(`Fix at ${when} · ${provenance}`);
  } else {
    lines.push("Position UNKNOWN — no usable fix");
  }

  if (input.returnAtIso) {
    const returnMs = Date.parse(input.returnAtIso);
    lines.push(
      Number.isFinite(returnMs)
        ? `Return by ${formatZulu(new Date(returnMs))}`
        : "Return time invalid",
    );
  }

  const profile = input.profile;
  if (profile?.name) {
    const party =
      Number.isFinite(profile.partySize) && profile.partySize >= 1
        ? `, party of ${Math.round(profile.partySize)}`
        : "";
    lines.push(`${reportField(profile.name, 40)}${party}`);
  }
  if (profile?.iceName || profile?.icePhone) {
    lines.push(
      `ICE: ${[reportField(profile.iceName ?? "", 40), reportField(profile.icePhone ?? "", 24)]
        .filter(Boolean)
        .join(" ")}`,
    );
  }
  if (profile?.medical) lines.push(`Medical: ${reportField(profile.medical, 80)}`);
  if (profile?.bloodType) lines.push(`Blood: ${reportField(profile.bloodType, 8)}`);

  return lines.join("\n");
}
