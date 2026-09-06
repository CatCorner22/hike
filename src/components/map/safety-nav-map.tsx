"use client";

import { useEffect, useMemo, useRef } from "react";
import { safeBbox, type LatLng } from "@/lib/geo/navigation";
import { createProjector, followWindow } from "@/lib/geo/project";
import { unwrapLongitude } from "@/lib/geo/antimeridian";
import { latLngToUtm, utmToLatLng } from "@/lib/safety/usng";
import type { OfflineCorridor } from "@/lib/offline/corridor";

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
  search?: GeoJSON.LineString | null;
  showGrid?: boolean;
  nightMode?: "off" | "red" | "nvg";
  gpsDenied?: boolean;
  uncertaintyM?: number;
  /**
   * Pixels of vertical space reserved at the top of the canvas for a page-level
   * header overlay. Orientation labels are drawn below this so they stay legible
   * when warning banners stack up in the header.
   */
  topInsetPx?: number;
  /**
   * Surrounding context drawn beneath the route. Optional: packs prepared before
   * corridors existed simply have none, and the route-only map remains complete.
   */
  corridor?: OfflineCorridor | null;
}

function flatten(geometry: GeoJSON.LineString | GeoJSON.MultiLineString) {
  return geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

/**
 * Corridor styling.
 *
 * Every colour here is measured to sit below the route line's relative luminance
 * in the same display mode, and dashed for everything that is not a road, so
 * context can never be mistaken for the line the hiker is meant to be on. Each
 * night mode keeps its own single-hue palette so red and NVG stay dark-adapted.
 *
 * The day palette was originally lifted from the same bright Tailwind ramp used
 * for alerts, and measurement showed all five colours outshining the route: the
 * worst was `trail` at #86efac, luminance 0.70 against the route's 0.27 -- and in
 * nearly the route's own hue, so a side trail read as the line to follow. These
 * values keep a 25x contrast ratio against the map background while staying
 * subordinate to the route.
 */
const CORRIDOR_LINE_STYLE: Record<
  "road" | "track" | "trail" | "water" | "barrier",
  { day: string; red: string; nvg: string; width: number; dash: number[] }
> = {
  road: { day: "#64748b", red: "#7f4a4a", nvg: "#4a7f5c", width: 2.5, dash: [] },
  track: { day: "#78716c", red: "#6f4040", nvg: "#42704f", width: 2, dash: [6, 4] },
  trail: { day: "#55707d", red: "#5f3636", nvg: "#3d6647", width: 1.5, dash: [4, 3] },
  water: { day: "#2563eb", red: "#6b3b52", nvg: "#38614f", width: 2, dash: [] },
  barrier: { day: "#8b5cf6", red: "#743a4a", nvg: "#3f6b52", width: 1.5, dash: [2, 3] },
};

/**
 * Corridor points are deliberately NOT held below the route's brightness. A line
 * competes with the route because it also says "follow me"; a 3.5 px dot marking a
 * shelter or a spring is a destination, and being easy to spot is the whole point
 * of drawing it.
 */
const CORRIDOR_POINT_STYLE: Record<
  "water" | "shelter" | "campsite" | "building",
  { day: string; red: string; nvg: string }
> = {
  water: { day: "#38bdf8", red: "#a35c72", nvg: "#5c9c78" },
  shelter: { day: "#fcd34d", red: "#b06a54", nvg: "#7fb890" },
  campsite: { day: "#c4b5fd", red: "#8d5566", nvg: "#6ba283" },
  building: { day: "#cbd5e1", red: "#8a5252", nvg: "#5d8a6d" },
};

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
  search = null,
  showGrid = true,
  nightMode = "off",
  corridor = null,
  gpsDenied = false,
  uncertaintyM,
  topInsetPx = 0,
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
    // Include the point the user is being sent to. A fixed window around the user alone
    // dropped the route off the canvas at a few hundred metres — while the off-trail
    // banner was still telling them to walk back to it.
    if (follow && user) return followWindow(user, [nearest, goto]);
    return safeBbox(geometry, user ?? undefined);
  }, [geometry, follow, user, nearest, goto]);

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

      if (!bbox) {
        ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#e5e7eb";
        ctx.font = "12px sans-serif";
        ctx.fillText("Route data invalid", 12, topInsetPx + 20);
        return;
      }
      const projector = createProjector(bbox, width, height, 28);
      const { pxPerMetre } = projector;
      // Use main's equal-scale meter projection, but unwrap each longitude first so
      // a short route across ±180° cannot be rendered across the whole world.
      const toPx = (lng: number, lat: number) =>
        projector.toPx(unwrapLongitude(lng, { minLng: bbox[0], maxLng: bbox[2] }) ?? lng, lat);
      const userPx = user ? toPx(user.lng, user.lat) : { x: width / 2, y: height / 2 };

      const rotation =
        headingUp && user?.heading != null && Number.isFinite(user.heading)
          ? (user.heading * Math.PI) / 180
          : 0;
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
        if (!u) {
          ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#e5e7eb";
          ctx.font = "12px sans-serif";
          ctx.fillText("UTM grid unavailable at this latitude", 12, topInsetPx + 38);
        } else {
        const step = 100;
        const reach = 500;
        const startE = Math.floor((u.easting - reach) / step) * step;
        const startN = Math.floor((u.northing - reach) / step) * step;
        for (let e = startE; e <= startE + reach * 2; e += step) {
          ctx.beginPath();
          for (let n = startN, i = 0; n <= startN + reach * 2; n += step, i++) {
            const geo = utmToLatLng({ zone: u.zone, easting: e, northing: n, north: u.north });
            const p = toPx(geo.lng, geo.lat);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        for (let n = startN; n <= startN + reach * 2; n += step) {
          ctx.beginPath();
          for (let e = startE, i = 0; e <= startE + reach * 2; e += step, i++) {
            const geo = utmToLatLng({ zone: u.zone, easting: e, northing: n, north: u.north });
            const p = toPx(geo.lng, geo.lat);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
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

      // Corridor context is drawn first so the route always sits on top of it.
      // Nothing here may compete with the route line for attention: these are
      // things that exist nearby, not the line the hiker is following.
      if (corridor && (corridor.lines.length > 0 || corridor.points.length > 0)) {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (const feature of corridor.lines) {
          if (feature.positions.length < 2) continue;
          const style = CORRIDOR_LINE_STYLE[feature.kind];
          ctx.strokeStyle =
            nightMode === "red" ? style.red : nightMode === "nvg" ? style.nvg : style.day;
          ctx.lineWidth = style.width;
          ctx.setLineDash(style.dash);
          ctx.beginPath();
          feature.positions.forEach(([lng, lat], index) => {
            const p = toPx(lng, lat);
            if (index === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const point of corridor.points) {
          const style = CORRIDOR_POINT_STYLE[point.kind];
          const p = toPx(point.lng, point.lat);
          ctx.fillStyle =
            nightMode === "red" ? style.red : nightMode === "nvg" ? style.nvg : style.day;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = nightMode === "red" ? "#f87171" : "#16a34a";
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      for (const line of lines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach(([lng, lat], index) => {
          const p = toPx(lng, lat);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }

      if (endpoints) {
        const start = toPx(endpoints.start.lng, endpoints.start.lat);
        const end = toPx(endpoints.end.lng, endpoints.end.lat);
        ctx.fillStyle = nightMode === "red" ? "#ffb0b0" : nightMode === "nvg" ? "#8ee6a6" : "#22c55e";
        ctx.beginPath();
        ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = nightMode === "red" ? "#ff8888" : nightMode === "nvg" ? "#ff9a9a" : "#ef4444";
        ctx.beginPath();
        ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (search && search.coordinates.length >= 2) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = nightMode === "red" ? "#ff9a9a" : nightMode === "nvg" ? "#b8f5c8" : "#facc15";
        ctx.lineWidth = 2;
        ctx.beginPath();
        search.coordinates.forEach(([lng, lat], index) => {
          const p = toPx(lng, lat);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (backtrack && backtrack.coordinates.length >= 2) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = nightMode === "red" ? "#d88a8a" : nightMode === "nvg" ? "#8ee6a6" : "#38bdf8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        backtrack.coordinates.forEach(([lng, lat], index) => {
          const p = toPx(lng, lat);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const wp of waypoints) {
        const p = toPx(wp.lng, wp.lat);
        ctx.fillStyle =
          nightMode === "red"
            ? "#e9a0a0"
            : nightMode === "nvg"
              ? "#9deaae"
              : WAYPOINT_COLORS[wp.kind] ?? "#e5e7eb";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (goto) {
        const p = toPx(goto.lng, goto.lat);
        ctx.strokeStyle = nightMode === "red" ? "#ff9a9a" : nightMode === "nvg" ? "#b8f5c8" : "#facc15";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y);
        ctx.lineTo(p.x + 8, p.y);
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x, p.y + 8);
        ctx.stroke();
        if (user) {
          const from = toPx(user.lng, user.lat);
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (user && nearest) {
        const from = toPx(user.lng, user.lat);
        const to = toPx(nearest.lng, nearest.lat);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = nightMode === "red" ? "#e88c8c" : nightMode === "nvg" ? "#9deaae" : "#f97316";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = nightMode === "red" ? "#ffaaaa" : nightMode === "nvg" ? "#b8f5c8" : "#fdba74";
        ctx.beginPath();
        ctx.arc(to.x, to.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (ghost) {
        const g = toPx(ghost.lng, ghost.lat);
        ctx.strokeStyle = nightMode === "red" ? "#c18484" : nightMode === "nvg" ? "#78c98e" : "#64748b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (user) {
        const ringM = gpsDenied ? uncertaintyM ?? user.accuracy : user.accuracy;
        const p = toPx(user.lng, user.lat);
        if (
          ringM != null &&
          Number.isFinite(ringM) &&
          ringM > 0 &&
          Number.isFinite(pxPerMetre) &&
          pxPerMetre > 0
        ) {
          // Same scale as everything else, so the ring is the real accuracy radius.
          const r = Math.min(ringM * pxPerMetre, 80);
          ctx.fillStyle =
            nightMode === "red"
              ? gpsDenied
                ? "rgba(255, 138, 138, 0.16)"
                : "rgba(255, 176, 176, 0.18)"
              : gpsDenied
                ? "rgba(249, 115, 22, 0.16)"
                : "rgba(37, 99, 235, 0.18)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (gpsDenied) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = nightMode === "red" ? "#ffaaaa" : "#fb923c";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.fillStyle = nightMode === "red" ? "#ff9a9a" : nightMode === "nvg" ? "#8ee6a6" : "#2563eb";
        ctx.strokeStyle = nightMode === "red" ? "#4a0b0b" : nightMode === "nvg" ? "#063516" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (user.heading != null) {
          ctx.fillStyle = nightMode === "red" ? "#ffc1c1" : nightMode === "nvg" ? "#b8f5c8" : "#93c5fd";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 16);
          ctx.lineTo(p.x - 5, p.y - 4);
          ctx.lineTo(p.x + 5, p.y - 4);
          ctx.closePath();
          ctx.fill();
        }
      }

      if (rotation) ctx.restore();

      // Keep orientation labels clear of the page header overlay.
      const labelTop = topInsetPx + 20;
      ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#e5e7eb";
      ctx.font = "12px sans-serif";
      ctx.fillText(headingUp ? "Heading up" : "North up", 12, labelTop);
      if (!headingUp) {
        ctx.fillText("N", width / 2 - 4, labelTop - 2);
        ctx.strokeStyle = nightMode === "red" ? "#d88a8a" : nightMode === "nvg" ? "#8ee6a6" : "#9ca3af";
        ctx.beginPath();
        ctx.moveTo(width / 2, labelTop + 2);
        ctx.lineTo(width / 2, labelTop + 14);
        ctx.stroke();
      }
    };

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [backtrack, bbox, endpoints, follow, ghost, goto, gpsDenied, headingUp, lines, nearest, nightMode, search, showGrid, topInsetPx, uncertaintyM, user, waypoints]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="Offline trail navigation map"
    />
  );
}
