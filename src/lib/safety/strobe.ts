const SOS = [120, 80, 120, 80, 120, 200, 320, 80, 320, 80, 320, 200, 120, 80, 120, 80, 120];

export function vibrateSos() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(SOS);
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
 * Morse SOS tone. Pass `repeat: "loop"` for a locator beacon that runs until aborted.
 */
export async function playSosTone(
  repeat: number | "loop" = 2,
  signal?: AbortSignal,
): Promise<void> {
  const AudioCtx = audioContextCtor();
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const units = [120, 120, 120, 320, 320, 320, 120, 120, 120];
  const times = repeat === "loop" ? Number.POSITIVE_INFINITY : Math.max(1, repeat);

  try {
    for (let r = 0; r < times; r++) {
      if (signal?.aborted) break;
      for (const dur of units) {
        if (signal?.aborted) break;
        await beep(ctx, { freq: 880, durationMs: dur, signal, gain: 0.14 });
        await wait(80, signal);
      }
      await wait(400, signal);
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
