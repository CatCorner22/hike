export const CAMP_ACCESS_STATUSES = ["allowed", "restricted", "private", "unknown"] as const;
export const CAMP_PERMIT_STATUSES = ["required", "not_required", "seasonal", "unknown"] as const;

export type CampAccessStatus = (typeof CAMP_ACCESS_STATUSES)[number];
export type CampPermitStatus = (typeof CAMP_PERMIT_STATUSES)[number];

export interface CampingEvidence {
  status: CampAccessStatus | CampPermitStatus;
  sourceUrl?: string;
  sourceUpdatedAt?: string;
  retrievedAt?: string;
  inferred: boolean;
}

/** OpenStreetMap access tags describe access, never whether a site is backcountry. */
export function accessStatusFromOsmTags(tags: Record<string, string>): CampAccessStatus {
  const access = tags.access?.trim().toLowerCase();
  if (access === "private") return "private";
  if (access === "no" || access === "customers") return "restricted";
  if (["yes", "permissive", "designated", "public"].includes(access)) return "allowed";
  return "unknown";
}

/** Only explicit permit tags support a permit claim. Camping type alone does not. */
export function permitStatusFromOsmTags(tags: Record<string, string>): CampPermitStatus {
  const raw = (tags.permit ?? tags.permit_required ?? "").trim().toLowerCase();
  if (["yes", "required"].includes(raw)) return "required";
  if (["seasonal", "limited", "lottery"].includes(raw)) return "seasonal";
  if (["no", "not_required"].includes(raw)) return "not_required";
  return "unknown";
}

export function campingTypeFromOsmTags(
  tags: Record<string, string>,
  fallback: "walk_in" | "backcountry" = "walk_in",
): "walk_in" | "backcountry" {
  const values = [tags.backcountry, tags.camp_site, tags.site_type]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return values.some((value) => value === "yes" || value.includes("backcountry") || value.includes("wilderness"))
    ? "backcountry"
    : fallback;
}

/** Legacy false booleans are not evidence that no permit is required. */
export function permitStatusFromLegacyBoolean(value: boolean | null | undefined): CampPermitStatus {
  return value === true ? "required" : "unknown";
}

export function permitRequiredCompatibility(status: CampPermitStatus): boolean | null {
  if (status === "required") return true;
  if (status === "not_required") return false;
  return null;
}
