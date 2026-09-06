"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Calendar, Car, Dog, Tent, Users } from "lucide-react";
import type { TrailResearchBrief } from "@/lib/research/schema";
import {
  classifyResearchClaim,
  classifyResearchSourceUrl,
  researchSourceFreshness,
  type ResearchEvidenceClass,
  type ResearchFreshness,
} from "@/lib/research/provenance";
import { safeSourceUrl } from "@/lib/research/schema";

interface ResearchBriefProps {
  brief: TrailResearchBrief;
}

const evidenceClassStyle: Record<ResearchEvidenceClass, string> = {
  official: "border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300",
  community: "border-sky-700/30 bg-sky-700/10 text-sky-800 dark:text-sky-300",
  "ai-inferred": "border-amber-700/30 bg-amber-700/10 text-amber-900 dark:text-amber-200",
  unverified: "border-destructive/40 bg-destructive/10 text-destructive",
};

const freshnessStyle: Record<ResearchFreshness, string> = {
  fresh: "border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300",
  aging: "border-amber-700/30 bg-amber-700/10 text-amber-900 dark:text-amber-200",
  stale: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-destructive/40 bg-destructive/10 text-destructive",
};

function visibleSourceLabel(source: TrailResearchBrief["sources"][number]): string {
  return typeof source.label === "string" && source.label.trim().length > 0
    ? source.label
    : "Unlabeled source";
}

function ClaimEvidence({
  sourceUrls,
  sources,
}: {
  sourceUrls: unknown;
  sources: TrailResearchBrief["sources"];
}) {
  if (!Array.isArray(sourceUrls)) {
    return <Badge variant="destructive">Not verified</Badge>;
  }

  const citedUrls = new Set(
    sourceUrls
      .map((url) => safeSourceUrl(url))
      .filter((url): url is string => url !== null),
  );
  const citedSources = sources.filter((source) => citedUrls.has(source.url));
  if (citedSources.length === 0) {
    return <Badge variant="destructive">Not verified</Badge>;
  }

  return (
    <Badge variant="outline" className="max-w-full whitespace-normal">
      AI cites: {citedSources.map(visibleSourceLabel).join(", ")}
    </Badge>
  );
}

function SectionTitle({
  children,
  sourceUrls,
  sources,
}: {
  children: React.ReactNode;
  sourceUrls: unknown;
  sources: TrailResearchBrief["sources"];
}) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <h4 className="text-sm font-medium">{children}</h4>
      <ClaimEvidence sourceUrls={sourceUrls} sources={sources} />
    </div>
  );
}

export function ResearchBrief({ brief }: ResearchBriefProps) {
  const claimSources = brief.claimSources;
  const claimEvidenceClass = classifyResearchClaim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Trail Research</CardTitle>
        <Alert className="border-amber-700/30 bg-amber-700/10">
          <AlertTriangle className="h-4 w-4 text-amber-800 dark:text-amber-200" />
          <div className="flex flex-wrap items-center gap-2">
            <AlertTitle>AI-inferred research — not verified fact</AlertTitle>
            <Badge variant="outline" className={evidenceClassStyle[claimEvidenceClass]}>
              {claimEvidenceClass}
            </Badge>
          </div>
          <AlertDescription>
            Verify route conditions, closures, permits, and hazards directly with the land manager before departure.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">{brief.summary}</p>
        <ClaimEvidence sourceUrls={claimSources?.summary} sources={brief.sources} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <Users className="mr-1 h-3 w-3" />
            Crowds: {brief.crowdLevel}
          </Badge>
          {brief.bestSeasons.map((season) => (
            <Badge key={season} variant="outline">
              <Calendar className="mr-1 h-3 w-3" />
              {season}
            </Badge>
          ))}
          <ClaimEvidence sourceUrls={claimSources?.bestSeasons} sources={brief.sources} />
          <ClaimEvidence sourceUrls={claimSources?.crowdLevel} sources={brief.sources} />
        </div>

        <div>
          <SectionTitle sourceUrls={claimSources?.difficultyReality} sources={brief.sources}>
            Difficulty reality
          </SectionTitle>
          <p className="text-sm text-muted-foreground">{brief.difficultyReality}</p>
        </div>

        {brief.hazards.length > 0 && (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="flex items-center gap-1 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Hazards
              </h4>
              <ClaimEvidence sourceUrls={claimSources?.hazards} sources={brief.sources} />
            </div>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {brief.hazards.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="flex items-center gap-1 text-sm font-medium">
                <Car className="h-4 w-4" />
                Parking
              </h4>
              <ClaimEvidence sourceUrls={claimSources?.parking} sources={brief.sources} />
            </div>
            <p className="text-sm text-muted-foreground">{brief.parking}</p>
          </div>
          {brief.permits && (
            <div>
              <SectionTitle sourceUrls={claimSources?.permits} sources={brief.sources}>
                Permits
              </SectionTitle>
              <p className="text-sm text-muted-foreground">{brief.permits}</p>
            </div>
          )}
          {brief.dogPolicy && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="flex items-center gap-1 text-sm font-medium">
                  <Dog className="h-4 w-4" />
                  Dogs
                </h4>
                <ClaimEvidence sourceUrls={claimSources?.dogPolicy} sources={brief.sources} />
              </div>
              <p className="text-sm text-muted-foreground">{brief.dogPolicy}</p>
            </div>
          )}
        </div>

        {brief.campingNearby.length > 0 && (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="flex items-center gap-1 text-sm font-medium">
                <Tent className="h-4 w-4" />
                Camping nearby
              </h4>
              <ClaimEvidence sourceUrls={claimSources?.campingNearby} sources={brief.sources} />
            </div>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {brief.campingNearby.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {brief.sources.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Source provenance</h4>
            <ul className="space-y-2">
              {brief.sources.map((source) => {
                const href = safeSourceUrl(source.url);
                const freshness = researchSourceFreshness(source.retrievedAt);
                const sourceLabel = visibleSourceLabel(source);
                const evidenceClass = classifyResearchSourceUrl(source.url);
                return (
                  <li key={`${source.url}-${sourceLabel}`} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {sourceLabel}
                        </a>
                      ) : (
                        <span className="font-medium">{sourceLabel}</span>
                      )}
                      <Badge variant="outline" className={evidenceClassStyle[evidenceClass]}>
                        {evidenceClass}
                      </Badge>
                      <Badge variant="outline" className={freshnessStyle[freshness]}>
                        {freshness}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {href ?? "URL could not be verified for safe linking."}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {freshness === "unknown"
                        ? "Retrieved: unknown or invalid time"
                        : `Retrieved: ${source.retrievedAt}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
