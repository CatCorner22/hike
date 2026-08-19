"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistance, formatElevation } from "@/lib/geo";

interface ElevationChartProps {
  profile: Array<{ distanceMeters: number; elevation: number }>;
  currentDistanceMeters?: number;
  className?: string;
}

export function ElevationChart({
  profile,
  currentDistanceMeters,
  className = "h-48 w-full",
}: ElevationChartProps) {
  const data = useMemo(
    () =>
      profile.map((p) => ({
        distance: p.distanceMeters,
        elevation: p.elevation,
        isCurrent:
          currentDistanceMeters != null &&
          Math.abs(p.distanceMeters - currentDistanceMeters) < 50,
      })),
    [profile, currentDistanceMeters],
  );

  if (!profile.length) {
    return (
      <div className={`flex items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground ${className}`}>
        Elevation data unavailable
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="distance"
            tickFormatter={(v) => formatDistance(v)}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            opacity={0.5}
          />
          <YAxis
            tickFormatter={(v) => `${Math.round(v * 3.28)}ft`}
            tick={{ fontSize: 11 }}
            width={45}
            stroke="currentColor"
            opacity={0.5}
          />
          <Tooltip
            formatter={(value) => [formatElevation(Number(value)), "Elevation"]}
            labelFormatter={(label) => formatDistance(Number(label))}
          />
          <Area
            type="monotone"
            dataKey="elevation"
            stroke="#16a34a"
            fill="url(#elevGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
