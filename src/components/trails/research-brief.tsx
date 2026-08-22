"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Calendar, Car, Clock3, Dog, Tent, Users } from "lucide-react";
import {
  researchBriefFieldTrust,
  researchFreshness,
  safeSourceUrl,
  type TrailResearchBrief,
} from "@/lib/research/schema";
import { httpsUrl } from "@/lib/urls";

interface ResearchBriefProps {
  brief: TrailResearchBrief;
}

export function ResearchBrief({ brief }: ResearchBriefProps) {
  const freshness = researchFreshness(brief.lastResearchedAt);
  const trust = researchBriefFieldTrust(brief);
  const seasons = trust.bestSeasons ? brief.bestSeasons : [];
  const crowdLevel = trust.crowdLevel ? brief.crowdLevel : "unknown";
  const conditions = trust.conditions ? brief.conditions : null;
  const summary = trust.summary
    ? brief.summary
    : "This cached brief predates source verification. Refresh it before relying on any research claim.";
  const difficulty = trust.difficultyReality
    ? brief.difficultyReality
    : "Unknown — verified difficulty evidence is unavailable.";
  const hazards = trust.hazards ? brief.hazards : [];
  const parking = trust.parking
    ? brief.parking
    : "Unknown — verified parking evidence is unavailable.";
  const permits = trust.permits ? brief.permits : null;
  const dogPolicy = trust.dogPolicy ? brief.dogPolicy : null;
  const campingNearby = trust.campingNearby ? brief.campingNearby : [];
  const trustedSourceUrls = new Set(trust.sourceUrls);
  const sources = brief.sources.filter((source) => {
    const url = safeSourceUrl(source.url);
    return Boolean(url && trustedSourceUrls.has(url));
  });
  const provenance = trust.cacheReusable && brief.provenance?.mode === "source_synthesis"
    ? "Source-backed synthesis"
    : trust.cacheReusable && brief.provenance?.mode === "mapped_metadata_only"
      ? "Mapped metadata only"
      : "Unverified brief — refresh";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Trail Research</CardTitle>
        <p className="text-sm text-muted-foreground">{summary}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">{provenance}</Badge>
          <Badge variant={freshness.stale ? "destructive" : "outline"}>
            <Clock3 className="h-3 w-3" />
            {freshness.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Check time is not a live-condition timestamp; source pages and rules may be older or have changed.
        </p>
        {trust.cacheReusable && brief.provenance?.parkCode && brief.provenance.parkName && (
          <p className="text-xs text-muted-foreground">
            NPS unit verified: {brief.provenance.parkName} ({brief.provenance.parkCode}).
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <Users className="mr-1 h-3 w-3" />
            Crowds: {crowdLevel}
          </Badge>
          {seasons.length > 0 ? (
            seasons.map((season) => (
              <Badge key={season} variant="outline">
                <Calendar className="mr-1 h-3 w-3" />
                {season}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">
              <Calendar className="mr-1 h-3 w-3" />
              Season evidence unavailable
            </Badge>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-sm font-medium">Difficulty reality</h4>
          <p className="text-sm text-muted-foreground">{difficulty}</p>
        </div>

        <div>
          <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Hazards
          </h4>
          {hazards.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {hazards.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hazard evidence was returned. This is not evidence that the route is hazard-free.
            </p>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-sm font-medium">Source-reported conditions</h4>
          <p className="text-sm text-muted-foreground">
            {conditions
              ? `${conditions} Verify current conditions with the land manager before departure.`
              : "Unknown — no source-backed condition report was available."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <Car className="h-4 w-4" />
              Parking
            </h4>
            <p className="text-sm text-muted-foreground">{parking}</p>
          </div>
          <div>
            <h4 className="mb-1 text-sm font-medium">Permits</h4>
            <p className="text-sm text-muted-foreground">
              {permits ?? "Unknown — verify current permit rules with the land manager."}
            </p>
          </div>
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <Dog className="h-4 w-4" />
              Dogs
            </h4>
            <p className="text-sm text-muted-foreground">
              {dogPolicy ?? "Unknown — verify current pet rules with the land manager."}
            </p>
          </div>
        </div>

        {campingNearby.length > 0 && (
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <Tent className="h-4 w-4" />
              Camping nearby
            </h4>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {campingNearby.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h4 className="mb-1 text-sm font-medium">Sources and provenance</h4>
          {sources.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {sources.map((source) => {
                const href = httpsUrl(source.url);
                if (!href) return <li key={source.url}>{source.title}</li>;
                const provider = source.provider === "nps"
                  ? "NPS"
                  : source.provider === "openstreetmap"
                    ? "OpenStreetMap"
                    : source.provider === "web"
                      ? "Web"
                      : "Legacy";
                return (
                  <li key={href}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {source.title}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">{provider}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No web or land-manager source was available for this brief.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
