/**
 * Morse timing, in units of one dot: dash = 3, gap between elements = 1, gap between
 * characters = 3, gap between repeats = 7. The tone and the haptic are both built from
 * these so they cannot drift apart.
 */
import { vibratePattern } from "@/lib/platform/haptics";
const UNIT_MS = 120;
const DOT_MS = UNIT_MS;
const DASH_MS = UNIT_MS * 3;
const ELEMENT_GAP_MS = UNIT_MS;
const CHAR_GAP_MS = UNIT_MS * 3;
const REPEAT_GAP_MS = UNIT_MS * 7;

/** S O S — three dots, three dashes, three dots. */
const SOS_CHARACTERS: number[][] = [
  [DOT_MS, DOT_MS, DOT_MS],
  [DASH_MS, DASH_MS, DASH_MS],
  [DOT_MS, DOT_MS, DOT_MS],
];

/** Flatten to the alternating [buzz, pause, buzz, …] shape `navigator.vibrate` expects. */
function sosVibrationPattern(): number[] {
  const pattern: number[] = [];
  SOS_CHARACTERS.forEach((character, charIndex) => {
    character.forEach((element, elementIndex) => {
      pattern.push(element);
      if (elementIndex < character.length - 1) pattern.push(ELEMENT_GAP_MS);
    });
    if (charIndex < SOS_CHARACTERS.length - 1) pattern.push(CHAR_GAP_MS);
  });
  return pattern;
}

/** Exported so the Morse ratios can be asserted without stubbing `navigator`. */
export const SOS_VIBRATION_PATTERN = sosVibrationPattern();

export function vibrateSos() {
  // Through the platform seam: dead on iOS Safari, alive in the shell.
  vibratePattern(SOS_VIBRATION_PATTERN);
}

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * iOS (and Chrome's autoplay policy) start an AudioContext suspended unless it is
 * created inside the gesture handler. This one is created in an effect after the SOS
 * button is pressed, so it must be resumed explicitly or the beacon is silent — the
 * one failure mode a locator tone cannot have.
 */
async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  return (ctx.state as AudioContextState) === "running";
}

async function beep(
  ctx: AudioContext,
  opts: { freq: number; durationMs: number; type?: OscillatorType; gain?: number; signal?: AbortSignal },
) {
  if (opts.signal?.aborted) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.value = opts.freq;
  gain.gain.value = opts.gain ?? 0.14;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  await wait(opts.durationMs, opts.signal);
  try {
    osc.stop();
  } catch {
    /* already stopped */
  }
}

/**
 * Morse SOS tone at standard timing, so it is decodable rather than just rhythmic.
 * Pass `repeat: "loop"` for a locator beacon that runs until aborted.
 */
export async function playSosTone(
  repeat: number | "loop" = 2,
  signal?: AbortSignal,
): Promise<void> {
  const AudioCtx = audioContextCtor();
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const times = repeat === "loop" ? Number.POSITIVE_INFINITY : Math.max(1, repeat);

  try {
    await ensureRunning(ctx);
    for (let r = 0; r < times; r++) {
      if (signal?.aborted) break;
      for (let c = 0; c < SOS_CHARACTERS.length && !signal?.aborted; c++) {
        const character = SOS_CHARACTERS[c];
        for (let i = 0; i < character.length && !signal?.aborted; i++) {
          await beep(ctx, { freq: 880, durationMs: character[i], signal, gain: 0.14 });
          if (i < character.length - 1) await wait(ELEMENT_GAP_MS, signal);
        }
        if (c < SOS_CHARACTERS.length - 1) await wait(CHAR_GAP_MS, signal);
      }
      await wait(REPEAT_GAP_MS, signal);
    }
  } finally {
    try {
      await ctx.close();
    } catch {
      /* already closed */
    }
  }
}

/** Three long blasts — the wilderness distress / “I need help” whistle. */
export async function playWhistleBlasts(count = 3, signal?: AbortSignal): Promise<void> {
  const AudioCtx = audioContextCtor();
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  try {
    await ensureRunning(ctx);
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      await beep(ctx, { freq: 1250, durationMs: 900, type: "sine", gain: 0.2, signal });
      await wait(450, signal);
    }
  } finally {
    try {
      await ctx.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * iOS only accepts `sms:number&body=` when a destination is present.
 * With no number, both platforms need `sms:?body=` — `sms:&body=` is invalid.
 */
export function smsHref(
  phone: string | undefined,
  body: string,
  userAgent?: string,
): string {
  const dest = (phone ?? "").replace(/[^\d+]/g, "");
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const encoded = encodeURIComponent(body);
  if (!dest) return `sms:?body=${encoded}`;
  return `sms:${dest}${ios ? "&" : "?"}body=${encoded}`;
}
