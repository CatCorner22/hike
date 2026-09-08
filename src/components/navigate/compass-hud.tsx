"use client";

import { compassReadout } from "@/lib/safety/compass-display";

export interface CompassHudProps {
  headingTrue: number | null | undefined;
  lat?: number | null;
  lng?: number | null;
  headingUp?: boolean;
  nightMode?: "off" | "red" | "nvg";
  sourceLabel?: string;
  /** Shown when compass and GPS course diverge — metal interference, slow travel, etc. */
  headingWarning?: string | null;
  compassPrompt?: string | null;
  onEnableCompass?: () => void;
  className?: string;
}

const SIZE = 88;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = SIZE / 2 - 6;

export function CompassHud({
  headingTrue,
  lat,
  lng,
  headingUp = false,
  nightMode = "off",
  sourceLabel,
  headingWarning,
  compassPrompt,
  onEnableCompass,
  className = "",
}: CompassHudProps) {
  const readout = compassReadout(headingTrue, lat, lng);
  const rotation = headingUp && readout ? -readout.trueDeg : 0;
  const stroke =
    nightMode === "red" ? "#ffaaaa" : nightMode === "nvg" ? "#8ee6a6" : "currentColor";
  const fill =
    nightMode === "red" ? "#4a0b0b" : nightMode === "nvg" ? "#063516" : "var(--background)";
  const needle = nightMode === "red" ? "#ff6b6b" : nightMode === "nvg" ? "#5ee88a" : "#2563eb";

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      aria-label={readout ? `Compass ${readout.label}` : "Compass heading unavailable"}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
        role="img"
        aria-hidden
      >
        <circle cx={CX} cy={CY} r={R} fill={fill} stroke={stroke} strokeWidth={1.5} opacity={0.95} />
        <g transform={`rotate(${rotation} ${CX} ${CY})`}>
          {["N", "E", "S", "W"].map((label, i) => {
            const deg = i * 90;
            const rad = ((deg - 90) * Math.PI) / 180;
            const tx = CX + Math.cos(rad) * (R - 12);
            const ty = CY + Math.sin(rad) * (R - 12);
            return (
              <text
                key={label}
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={label === "N" ? needle : stroke}
                fontSize={label === "N" ? 11 : 9}
                fontWeight={label === "N" ? 700 : 500}
              >
                {label}
              </text>
            );
          })}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const inner = R - (deg % 90 === 0 ? 14 : 10);
            const x1 = CX + Math.cos(rad) * inner;
            const y1 = CY + Math.sin(rad) * inner;
            const x2 = CX + Math.cos(rad) * (R - 4);
            const y2 = CY + Math.sin(rad) * (R - 4);
            return (
              <line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={deg % 90 === 0 ? 1.5 : 0.75}
                opacity={0.7}
              />
            );
          })}
        </g>
        {readout && (
          /**
           * The needle's angle is measured against the CARD, not the screen, so
           * it has to carry the card's own rotation. Without `+ rotation` the
           * card turned by -heading while the needle turned by +heading, and the
           * needle read twice the heading against the dial beneath it: at
           * heading 180 it pointed 000, at 090 it pointed 180. Heading-up is the
           * shipped default (navigate/page.tsx `useState(true)`), so this was
           * live the moment any heading arrived.
           */
          <g transform={`rotate(${readout.trueDeg + rotation} ${CX} ${CY})`}>
            <polygon
              points={`${CX},${CY - R + 10} ${CX - 5},${CY + 4} ${CX + 5},${CY + 4}`}
              fill={needle}
            />
            <polygon
              points={`${CX},${CY + R - 10} ${CX - 4},${CY - 2} ${CX + 4},${CY - 2}`}
              fill={stroke}
              opacity={0.35}
            />
          </g>
        )}
      </svg>
      <div className="min-w-0 text-left text-[10px] leading-tight text-muted-foreground">
        {readout ? (
          <>
            <p className="font-semibold text-foreground tabular-nums">{Math.round(readout.trueDeg)}°T</p>
            {readout.magneticDeg != null && (
              <p className="tabular-nums">{Math.round(readout.magneticDeg)}° mag</p>
            )}
            <p>{readout.cardinal}</p>
            {sourceLabel && <p className="text-[9px] opacity-80">{sourceLabel}</p>}
            {headingWarning && (
              <p className="mt-0.5 font-medium text-amber-700 dark:text-amber-400">{headingWarning}</p>
            )}
          </>
        ) : (
          <p>No heading</p>
        )}
        {compassPrompt && onEnableCompass && (
          <button
            type="button"
            className="mt-1 text-[9px] font-medium text-primary underline"
            onClick={onEnableCompass}
          >
            Enable compass
          </button>
        )}
      </div>
    </div>
  );
}
