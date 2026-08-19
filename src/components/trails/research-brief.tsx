"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Calendar, Car, Dog, Tent, Users } from "lucide-react";
import type { TrailResearchBrief } from "@/lib/research/schema";

interface ResearchBriefProps {
  brief: TrailResearchBrief;
}

export function ResearchBrief({ brief }: ResearchBriefProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Trail Research</CardTitle>
        <p className="text-sm text-muted-foreground">{brief.summary}</p>
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
        </div>

        <div>
          <h4 className="mb-1 text-sm font-medium">Difficulty reality</h4>
          <p className="text-sm text-muted-foreground">{brief.difficultyReality}</p>
        </div>

        {brief.hazards.length > 0 && (
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Hazards
            </h4>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {brief.hazards.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <Car className="h-4 w-4" />
              Parking
            </h4>
            <p className="text-sm text-muted-foreground">{brief.parking}</p>
          </div>
          {brief.permits && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Permits</h4>
              <p className="text-sm text-muted-foreground">{brief.permits}</p>
            </div>
          )}
          {brief.dogPolicy && (
            <div>
              <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
                <Dog className="h-4 w-4" />
                Dogs
              </h4>
              <p className="text-sm text-muted-foreground">{brief.dogPolicy}</p>
            </div>
          )}
        </div>

        {brief.campingNearby.length > 0 && (
          <div>
            <h4 className="mb-1 flex items-center gap-1 text-sm font-medium">
              <Tent className="h-4 w-4" />
              Camping nearby
            </h4>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {brief.campingNearby.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {brief.sources.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Sources</h4>
            <ul className="space-y-1 text-sm">
              {brief.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
