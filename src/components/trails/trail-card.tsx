import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistance } from "@/lib/geo";
import { trailPageHref } from "@/lib/ids";
import type { TrailSearchResult } from "@/lib/osm/overpass";

interface TrailCardProps {
  trail: TrailSearchResult & { id?: string };
  href?: string;
}

export function TrailCard({ trail, href }: TrailCardProps) {
  const link = href || trailPageHref(trail.id ?? "", trail.osmType, trail.osmId);

  return (
    <Link href={link}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{trail.name}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {trail.network && <Badge variant="outline">{trail.network}</Badge>}
            {trail.sacScale && (
              <Badge variant="secondary">SAC {trail.sacScale}</Badge>
            )}
            {trail.difficulty && (
              <Badge variant="secondary">{trail.difficulty}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {trail.lengthMeters
              ? formatDistance(trail.lengthMeters)
              : "Length unknown"}
            {" · "}
            {trail.center.lat.toFixed(2)}°, {trail.center.lng.toFixed(2)}°
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
