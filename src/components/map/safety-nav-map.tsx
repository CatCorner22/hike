"use client";

import { useEffect, useMemo, useRef } from "react";
import { safeBbox, type LatLng } from "@/lib/geo/navigation";
import { createProjector, followWindow } from "@/lib/geo/project";
import { unwrapLongitude } from "@/lib/geo/antimeridian";
import { formatUsng, latLngToUtm, utmToLatLng } from "@/lib/safety/usng";
import { gridSquareBounds, gridSquareCorners } from "@/lib/safety/mgrs-grid";
import type { CorridorFeatureSet } from "@/lib/offline/corridor-features";
import type { PreparedBailoutRoute } from "@/lib/offline/bailout-routes";
import { hillshade, type TerrainGrid } from "@/lib/offline/terrain-grid";

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
  /**
   * Coarse elevation samples from the route pack. Drawn as relief shading under
   * everything else, or not at all — never as an assumption of flat ground.
   */
  terrain?: TerrainGrid | null;
  nightMode?: "off" | "red" | "nvg";
  gpsDenied?: boolean;
  uncertaintyM?: number;
  /**
   * Pixels of vertical space reserved at the top of the canvas for a page-level
   * header overlay. Orientation labels are drawn below this so they stay legible
   * when warning banners stack up in the header.
   */
  topInsetPx?: number;
  corridorFeatures?: CorridorFeatureSet | null;
  bailoutRoutes?: PreparedBailoutRoute[] | null;
}

function flatten(geometry: GeoJSON.LineString | GeoJSON.MultiLineString) {
  return geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.coordinates;
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
  search = null,
  showGrid = true,
  nightMode = "off",
  gpsDenied = false,
  uncertaintyM,
  topInsetPx = 0,
  corridorFeatures = null,
  bailoutRoutes = null,
  terrain = null,
}: SafetyNavMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lines = useMemo(() => flatten(geometry), [geometry]);
  /**
   * The shading depends only on the grid, and the grid is fixed for a whole
   * hike. Recomputing it inside the draw would repeat about a thousand
   * trigonometric cells on every GPS fix, on the screen a hiker is trying to
   * keep alive.
   */
  const terrainShade = useMemo(() => (terrain ? hillshade(terrain) : null), [terrain]);
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

      /*
        Relief shading, under everything.

        One filled quad per grid cell rather than an image: the cells are
        hundreds of metres across and the canvas may be rotated, so four
        projected corners are both cheaper and more honest than scaling a bitmap
        — the shading lands exactly where the ground it describes is. Cells with
        no elevation are skipped, so missing data stays visibly missing instead
        of reading as flat.
      */
      if (terrain && terrainShade) {
        const shade = terrainShade;
        const [tMinLng, tMinLat, tMaxLng, tMaxLat] = terrain.bbox;
        const lngStep = (tMaxLng - tMinLng) / (terrain.cols - 1);
        const latStep = (tMaxLat - tMinLat) / (terrain.rows - 1);
        // Night modes are red- and green-only by design; shading follows them so
        // it cannot destroy dark adaptation.
        const tint =
          nightMode === "red" ? [120, 20, 20] : nightMode === "nvg" ? [20, 110, 45] : [130, 148, 175];
        ctx.save();
        for (let row = 0; row < terrain.rows - 1; row += 1) {
          for (let col = 0; col < terrain.cols - 1; col += 1) {
            const value = shade[row * terrain.cols + col];
            if (value == null) continue;
            const north = tMaxLat - row * latStep;
            const south = north - latStep;
            const west = tMinLng + col * lngStep;
            const east = west + lngStep;
            const a = toPx(west, north);
            const b = toPx(east, north);
            const c = toPx(east, south);
            const d = toPx(west, south);
            // 0.18..0.62 keeps the route, the track and the waypoints legible on
            // top; relief is context, never the subject.
            const level = 0.18 + value * 0.44;
            ctx.fillStyle = `rgba(${Math.round(tint[0] * level)}, ${Math.round(tint[1] * level)}, ${Math.round(tint[2] * level)}, 0.85)`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.lineTo(d.x, d.y);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.restore();
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
        const drawUtmLines = (step: number, lineWidth: number, alpha: number) => {
          ctx.lineWidth = lineWidth;
          ctx.globalAlpha = alpha;
          const reach = step >= 1000 ? 1500 : 500;
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
          ctx.globalAlpha = 1;
        };
        drawUtmLines(1000, 1.75, 0.55);
        drawUtmLines(100, 1, 0.35);
        const hundredCorners = gridSquareCorners(user.lat, user.lng, 100_000);
        if (hundredCorners) {
          ctx.lineWidth = 2.4;
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle =
            nightMode === "red" ? "#ffaaaa" : nightMode === "nvg" ? "#8ee6a6" : "#94a3b8";
          ctx.beginPath();
          hundredCorners.forEach((c, i) => {
            const p = toPx(c.lng, c.lat);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const hundred = gridSquareBounds(user.lat, user.lng, 100_000);
        const mgrsLabel = formatUsng(user.lat, user.lng, 3);
        if (mgrsLabel || hundred) {
          ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#cbd5e1";
          ctx.font = "10px sans-serif";
          const label = [hundred ? `100 km ${hundred.hundredKmId}` : null, mgrsLabel ? `1 km · ${mgrsLabel}` : null]
            .filter(Boolean)
            .join("  ·  ");
          ctx.fillText(label, 12, topInsetPx + 38);
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

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (corridorFeatures?.features.features.length) {
        const lineColor = (layer: string) => {
          if (nightMode === "red") return "#7f1d1d";
          if (nightMode === "nvg") return "#14532d";
          if (layer === "water") return "#38bdf8";
          if (layer === "trails") return "#86efac";
          return "#64748b";
        };
        const pointColor = (layer: string) => {
          if (nightMode === "red") return "#e9a0a0";
          if (nightMode === "nvg") return "#9deaae";
          if (layer === "water") return "#38bdf8";
          if (layer === "shelters") return "#fbbf24";
          if (layer === "campsites") return "#c084fc";
          return "#e2e8f0";
        };
        for (const feature of corridorFeatures.features.features) {
          const layer = feature.properties?.layer ?? "landmarks";
          if (feature.geometry.type === "LineString") {
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = lineColor(layer);
            ctx.lineWidth = layer === "water" ? 2 : 1.5;
            ctx.beginPath();
            feature.geometry.coordinates.forEach(([lng, lat], index) => {
              const p = toPx(lng, lat);
              if (index === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
          } else if (feature.geometry.type === "Point") {
            const [lng, lat] = feature.geometry.coordinates;
            const p = toPx(lng, lat);
            ctx.fillStyle = pointColor(layer);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (bailoutRoutes?.length) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = nightMode === "red" ? "#fb923c" : nightMode === "nvg" ? "#fde68a" : "#ea580c";
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        for (const route of bailoutRoutes) {
          const tracks = route.geometry.type === "LineString" ? [route.geometry.coordinates] : route.geometry.coordinates;
          for (const line of tracks) {
            if (line.length < 2) continue;
            ctx.beginPath();
            line.forEach(([lng, lat], index) => {
              const p = toPx(lng, lat);
              if (index === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = nightMode === "red" ? "#f87171" : "#16a34a";
      ctx.lineWidth = 5;
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
        if (user.heading != null && Number.isFinite(user.heading)) {
          // The cone is drawn apex-up, and it used to inherit the scene's
          // rotation with none of its own — so on screen it landed exactly where
          // map-north landed, in BOTH modes. It pointed north and called itself
          // a heading, and was only ever right when you happened to be walking
          // due north. Rotating it by the heading in map space puts it along the
          // direction of travel when north is up, and screen-up when the map
          // turns with you.
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((user.heading * Math.PI) / 180);
          ctx.fillStyle = nightMode === "red" ? "#ffc1c1" : nightMode === "nvg" ? "#b8f5c8" : "#93c5fd";
          ctx.beginPath();
          ctx.moveTo(0, -16);
          ctx.lineTo(-5, -4);
          ctx.lineTo(5, -4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      if (rotation) ctx.restore();

      // Keep orientation labels clear of the page header overlay.
      const labelTop = topInsetPx + 20;
      ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#e5e7eb";
      ctx.font = "12px sans-serif";
      ctx.fillText(headingUp ? "Heading up" : "North up", 12, labelTop);
      // The north reference used to be drawn only when north was already up —
      // absent from the one mode where the map turns underneath you and a hiker
      // cannot otherwise tell which way north is. It is drawn in both modes now,
      // pointing wherever north actually ended up on screen.
      {
        const anchorX = width / 2;
        const anchorY = labelTop + 8;
        ctx.save();
        ctx.translate(anchorX, anchorY);
        ctx.rotate(-rotation);
        ctx.strokeStyle = nightMode === "red" ? "#d88a8a" : nightMode === "nvg" ? "#8ee6a6" : "#9ca3af";
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(0, -6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(-3, -5);
        ctx.lineTo(3, -5);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = nightMode === "red" ? "#ffd1d1" : nightMode === "nvg" ? "#d1ffe0" : "#e5e7eb";
        ctx.fillText(
          "N",
          anchorX + Math.sin(-rotation) * 18 - 4,
          anchorY - Math.cos(-rotation) * 18 + 4,
        );
      }
    };

    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [backtrack, bailoutRoutes, bbox, corridorFeatures, endpoints, follow, ghost, goto, gpsDenied, headingUp, lines, nearest, nightMode, search, showGrid, terrain, terrainShade, topInsetPx, uncertaintyM, user, waypoints]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="Offline trail navigation map"
    />
  );
}
