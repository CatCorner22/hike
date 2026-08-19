"use client";

import { useEffect, useMemo, useRef } from "react";
import { safeBbox, type LatLng } from "@/lib/geo/navigation";
import { latLngToUtm, utmToLatLng } from "@/lib/safety/usng";

interface SafetyNavMapProps {
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  user?: (LatLng & { heading?: number; accuracy?: number }) | null;
  nearest?: LatLng | null;
  headingUp?: boolean;
  follow?: boolean;
  className?: string;
  backtrack?: GeoJSON.LineString | null;
  waypoints?: Array<{ lat: number; lng: number; kind: string }>;
  goto?: LatLng | null;
  ghost?: LatLng | null;
  showGrid?: boolean;
  nightMode?: "off" | "red" | "nvg";
}

function flatten(geometry: GeoJSON.LineString | GeoJSON.MultiLineString) {
  return geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

function followWindow(user: LatLng, radiusDeg = 0.003): [number, number, number, number] {
  return [
    user.lng - radiusDeg,
    user.lat - radiusDeg,
    user.lng + radiusDeg,
    user.lat + radiusDeg,
  ];
}

function project(
  lng: number,
  lat: number,
  bbox: [number, number, number, number],
  width: number,
  height: number,
  padding: number,
) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const xSpan = Math.max(maxLng - minLng, 0.0001);
  const ySpan = Math.max(maxLat - minLat, 0.0001);
  const x = padding + ((lng - minLng) / xSpan) * (width - padding * 2);
  const y = padding + (1 - (lat - minLat) / ySpan) * (height - padding * 2);
  return { x, y };
}

const WAYPOINT_COLORS: Record<string, string> = {
  water: "#38bdf8",
  junction: "#facc15",
  camp: "#c084fc",
  note: "#e5e7eb",
  lkp: "#f43f5e",
  rp: "#a3e635",
  orp: "#fb923c",
  ap: "#e879f9",
  cf: "#2dd4bf",
  hr: "#818cf8",
};

export function SafetyNavMap({
  geometry,
  user,
  nearest,
  headingUp = false,
  follow = true,
  className = "h-full w-full",
  backtrack = null,
  waypoints = [],
  goto = null,
  ghost = null,
  showGrid = true,
  nightMode = "off",
}: SafetyNavMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lines = useMemo(() => flatten(geometry), [geometry]);
  const endpoints = useMemo(() => {
    const first = lines.find((line) => line.length >= 2)?.[0];
    const lastLine = [...lines].reverse().find((line) => line.length >= 2);
    const last = lastLine?.[lastLine.length - 1];
    if (!first || !last) return null;
    return {
      start: { lng: first[0], lat: first[1] },
      end: { lng: last[0], lat: last[1] },
    };
  }, [lines]);

  const bbox = useMemo(() => {
    if (follow && user) return followWindow(user);
    return safeBbox(geometry, user ?? undefined);
  }, [geometry, follow, user]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(width * dpr, 1);
      canvas.height = Math.max(height * dpr, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle =
        nightMode === "red" ? "#140303" : nightMode === "nvg" ? "#03140a" : "#0b1220";
      ctx.fillRect(0, 0, width, height);

      const userPx = user
        ? project(user.lng, user.lat, bbox, width, height, 28)
        : { x: width / 2, y: height / 2 };

      const rotation =
        headingUp && user?.heading != null ? (user.heading * Math.PI) / 180 : 0;
      if (rotation) {
        ctx.save();
        ctx.translate(userPx.x, userPx.y);
        ctx.rotate(-rotation);
        ctx.translate(-userPx.x, -userPx.y);
      }

      ctx.strokeStyle =
        nightMode === "red" ? "#3f1d1d" : nightMode === "nvg" ? "#14532d" : "#1f2937";
      ctx.lineWidth = 1;
      if (showGrid && user) {
        const u = latLngToUtm(user.lat, user.lng);
        const step = 100;
        const reach = 500;
        const startE = Math.floor((u.easting - reach) / step) * step;
        const startN = Math.floor((u.northing - reach) / step) * step;
        for (let e = startE; e <= startE + reach * 2; e += step) {
          ctx.beginPath();
          for (let n = startN, i = 0; n <= startN + reach * 2; n += step, i++) {
            const geo = utmToLatLng({ zone: u.zone, easting: e, northing: n, north: u.north });
            const p = project(geo.lng, geo.lat, bbox, width, height, 28);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        for (let n = startN; n <= startN + reach * 2; n += step) {
          ctx.beginPath();
          for (let e = startE, i = 0; e <= startE + reach * 2; e += step, i++) {
            const geo = utmToLatLng({ zone: u.zone, easting: e, northing: n, north: u.north });
            const p = project(geo.lng, geo.lat, bbox, width, height, 28);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      } else {
        for (let i = 1; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo((width * i) / 8, 0);
          ctx.lineTo((width * i) / 8, height);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, (height * i) / 8);
          ctx.lineTo(width, (height * i) / 8);
          ctx.stroke();
        }
      }

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = nightMode === "red" ? "#f87171" : "#16a34a";
      ctx.lineWidth = 5;
      for (const line of lines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach(([lng, lat], index) => {
          const p = project(lng, lat, bbox, width, height, 28);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }

      if (endpoints) {
        const start = project(endpoints.start.lng, endpoints.start.lat, bbox, width, height, 28);
        const end = project(endpoints.end.lng, endpoints.end.lat, bbox, width, height, 28);
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (backtrack && backtrack.coordinates.length >= 2) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        backtrack.coordinates.forEach(([lng, lat], index) => {
          const p = project(lng, lat, bbox, width, height, 28);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const wp of waypoints) {
        const p = project(wp.lng, wp.lat, bbox, width, height, 28);
        ctx.fillStyle = WAYPOINT_COLORS[wp.kind] ?? "#e5e7eb";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (goto) {
        const p = project(goto.lng, goto.lat, bbox, width, height, 28);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y);
        ctx.lineTo(p.x + 8, p.y);
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x, p.y + 8);
        ctx.stroke();
        if (user) {
          const from = project(user.lng, user.lat, bbox, width, height, 28);
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (user && nearest) {
        const from = project(user.lng, user.lat, bbox, width, height, 28);
        const to = project(nearest.lng, nearest.lat, bbox, width, height, 28);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#fdba74";
        ctx.beginPath();
        ctx.arc(to.x, to.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (ghost) {
        const g = project(ghost.lng, ghost.lat, bbox, width, height, 28);
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (user) {
        const p = project(user.lng, user.lat, bbox, width, height, 28);
        if (user.accuracy && user.accuracy > 0) {
          const [minLng, , maxLng] = bbox;
          const metersPerDeg = 111320 * Math.cos((user.lat * Math.PI) / 180);
          const pxPerMeter = (width - 56) / Math.max((maxLng - minLng) * metersPerDeg, 1);
          ctx.fillStyle = "rgba(37, 99, 235, 0.18)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.min(user.accuracy * pxPerMeter, 80), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#2563eb";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (user.heading != null) {
          ctx.fillStyle = "#93c5fd";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 16);
          ctx.lineTo(p.x - 5, p.y - 4);
          ctx.lineTo(p.x + 5, p.y - 4);
          ctx.closePath();
          ctx.fill();
        }
      }

      if (rotation) ctx.restore();

      ctx.fillStyle = "#e5e7eb";
      ctx.font = "12px sans-serif";
      ctx.fillText(headingUp ? "Heading up" : "North up", 12, 20);
      if (!headingUp) {
        ctx.fillText("N", width / 2 - 4, 18);
        ctx.strokeStyle = "#9ca3af";
        ctx.beginPath();
        ctx.moveTo(width / 2, 22);
        ctx.lineTo(width / 2, 34);
        ctx.stroke();
      }
    };

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [backtrack, bbox, endpoints, follow, ghost, goto, headingUp, lines, nearest, nightMode, showGrid, user, waypoints]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="Offline trail navigation map"
    />
  );
}
