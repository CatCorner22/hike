const SOS = [120, 80, 120, 80, 120, 200, 320, 80, 320, 80, 320, 200, 120, 80, 120, 80, 120];

export function vibrateSos() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(SOS);
}

export async function playSosTone(repeat = 2): Promise<void> {
  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const units = [0.12, 0.12, 0.12, 0.32, 0.32, 0.32, 0.12, 0.12, 0.12];

  for (let r = 0; r < repeat; r++) {
    for (const dur of units) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      await wait(dur * 1000);
      osc.stop();
      await wait(80);
    }
    await wait(400);
  }

  await ctx.close();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function smsHref(phone: string | undefined, body: string): string {
  const dest = (phone ?? "").replace(/[^\d+]/g, "");
  const ios =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const sep = ios ? "&" : "?";
  return `sms:${dest}${sep}body=${encodeURIComponent(body)}`;
}
