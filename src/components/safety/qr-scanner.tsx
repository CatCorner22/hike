"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { parseScannedPosition, type ScannedPosition } from "@/lib/qr/decode-handoff";

/**
 * Reads a position off another phone's screen with the camera.
 *
 * The other half of the SAR handoff: one phone shows a QR, this one reads it.
 * Neither needs signal, an account, or pairing — which is the only kind of
 * position sharing that works where this app is used.
 *
 * Two hard rules, both battery-driven (a dead phone is the actual emergency):
 *  - the camera stream is stopped on unmount, on error, and the moment a code
 *    is accepted;
 *  - decoding runs on a throttled interval against a downscaled frame rather
 *    than every animation frame.
 *
 * Everything here is browser-standard getUserMedia, so it works identically in
 * the web app and inside the iOS shell (which supplies the native camera
 * permission prompt via NSCameraUsageDescription).
 */

const DECODE_INTERVAL_MS = 250;
/** Downscale the analysed frame: QR finder patterns survive it, CPU does not suffer. */
const MAX_ANALYSIS_EDGE = 640;

type ScannerState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "scanning" }
  | { status: "error"; message: string };

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission denied. Enable camera access for this app in Settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera on this device.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and try again.";
  }
  return "The camera could not be started. You can type the position instead.";
}

export function QrScanner({
  onResult,
  onClose,
}: {
  /** Called with the parsed position AND the raw text, once, on a good read. */
  onResult: (result: { position: ScannedPosition | null; raw: string }) => void;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);
  const [state, setState] = useState<ScannerState>({ status: "idle" });
  const [unreadable, setUnreadable] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    // Every track, explicitly: a live camera track is a continuous battery draw
    // and the indicator stays lit, which reads as the app spying.
    if (stream) for (const track of stream.getTracks()) track.stop();
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  const tick = useCallback(() => {
    if (doneRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, w, h);

    let image: ImageData;
    try {
      image = context.getImageData(0, 0, w, h);
    } catch {
      // A tainted canvas cannot be read; nothing to do but keep the preview up.
      return;
    }

    const code = jsQR(image.data, w, h, { inversionAttempts: "attemptBoth" });
    if (!code?.data) return;

    const position = parseScannedPosition(code.data);
    if (!position) {
      // A real QR that is not a position — a trailhead sign, a product label.
      // Say so and keep scanning rather than silently ignoring a good read.
      setUnreadable("That code scanned, but it does not contain a position.");
      return;
    }
    doneRef.current = true;
    stop();
    setState({ status: "idle" });
    onResult({ position, raw: code.data });
  }, [onResult, stop]);

  const start = useCallback(async () => {
    doneRef.current = false;
    setUnreadable(null);
    setState({ status: "starting" });
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState({
        status: "error",
        message: "This device has no camera access in the browser. You can type the position instead.",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      // iOS refuses to play an inline video without these attributes set on the
      // element itself; without playsInline it goes fullscreen and the scan UI
      // disappears behind the system player.
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play().catch(() => undefined);
      setState({ status: "scanning" });
      timerRef.current = setInterval(tick, DECODE_INTERVAL_MS);
    } catch (error) {
      stop();
      setState({ status: "error", message: cameraErrorMessage(error) });
    }
  }, [stop, tick]);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "scanning" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              stop();
              setState({ status: "idle" });
            }}
          >
            Stop camera
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={state.status === "starting"}
            onClick={() => void start()}
          >
            {state.status === "starting" ? "Starting camera…" : "Scan a position QR"}
          </Button>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Done
          </Button>
        )}
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        className={`w-full rounded-md bg-black ${state.status === "scanning" ? "block" : "hidden"}`}
        aria-label="Camera preview for scanning a position QR code"
      />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {state.status === "scanning" && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Hold the other phone&apos;s QR steady in frame. The camera stops as soon as a
          position is read.
        </p>
      )}
      {unreadable && (
        <p className="text-xs text-amber-700 dark:text-amber-400" aria-live="polite">
          {unreadable}
        </p>
      )}
      {state.status === "error" && (
        <p className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
