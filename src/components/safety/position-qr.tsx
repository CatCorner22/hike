"use client";

import { useMemo } from "react";
import { encodeQr, qrToSvgPath } from "@/lib/qr/encode";

/**
 * Hands a position or SAR dossier to ANY nearby phone with zero connectivity: the
 * other phone needs no app, no signal, and no pairing — a stock camera reads it.
 *
 * The symbol is always dark-on-white regardless of theme: scanners binarize on
 * luminance, and a dark-mode "white on black" QR scans worse through screen glare.
 * The quiet zone (4 modules) is part of the spec, not styling — do not shrink it.
 */
export function PositionQr({ payload, label }: { payload: string; label: string }) {
  const qr = useMemo(() => encodeQr(payload), [payload]);

  if (!qr) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This report is too long to fit in a QR code. Shorten the note fields, or share the
        text directly instead.
      </p>
    );
  }

  const quiet = 4;
  const viewBox = `${-quiet} ${-quiet} ${qr.size + quiet * 2} ${qr.size + quiet * 2}`;
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`${label} as a QR code`}
        className="h-64 w-64 rounded-md border bg-white p-0"
        shapeRendering="crispEdges"
      >
        <rect
          x={-quiet}
          y={-quiet}
          width={qr.size + quiet * 2}
          height={qr.size + quiet * 2}
          fill="#ffffff"
        />
        <path d={qrToSvgPath(qr)} fill="#000000" />
      </svg>
      <figcaption className="max-w-64 text-center text-xs text-muted-foreground">
        {label} — another phone can scan this with its camera. No signal, app, or pairing
        needed on either phone.
      </figcaption>
    </figure>
  );
}
