import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata = {
  title: `Terms and limits — ${APP_NAME}`,
  description: `What ${APP_NAME} can and cannot do for you in the backcountry.`,
};

/**
 * The honest-limits page. The app's own guide has always been careful about
 * this; the App Store listing and a reviewer both need it in one linkable place,
 * and so does anyone deciding whether to rely on this in the field.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Read this before you rely on it</p>
        <h1 className="text-3xl font-bold tracking-tight">Terms and limits</h1>
      </div>

      <section className="space-y-2 rounded-xl border border-destructive/40 bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-destructive">{APP_NAME} cannot call for help</h2>
        <p className="text-sm text-muted-foreground">
          It does not contact 911, search and rescue, or your emergency contact. It cannot
          transmit anything by itself. The return-time alarm rings on your own phone. The
          strobe and tone are for being seen and heard by people who are already nearby.
          Every message goes out only when you send it, and only if you have signal.
        </p>
        <p className="text-sm text-muted-foreground">
          It is <strong>not</strong> a substitute for a personal locator beacon or a
          satellite messenger. If you are going somewhere a missed return time would matter,
          carry one, and tell a person your route and your return time.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">What it is good at, and what it guesses</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Position, grid references and bearings come from your phone&rsquo;s own sensors.
            Their accuracy is your phone&rsquo;s accuracy, and {APP_NAME} tells you when it
            does not trust a fix rather than showing you a confident wrong one.
          </li>
          <li>
            Trail data, elevation and hazards come from public sources that can be out of
            date, incomplete, or wrong. A mapped trail is not a passable trail.
          </li>
          <li>
            Bailout routes are <em>candidates</em> found in map data. None of them is a
            confirmed exit until you have verified it yourself.
          </li>
          <li>
            The medical, avalanche and survival references are training aids. They are not
            medical direction and they do not replace training.
          </li>
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Your judgment is the safety system</h2>
        <p className="text-sm text-muted-foreground">
          Backcountry travel carries real risk of injury and death, and you accept that risk
          when you go. {APP_NAME} is provided as-is, with no warranty of any kind. Use it as
          one input among several — map, compass, weather, experience, and the willingness to
          turn around. Nothing this app shows you overrides what you can see in front of you.
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        See also the{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          privacy page
        </Link>{" "}
        and the in-app{" "}
        <Link href="/guide" className="underline underline-offset-2">
          guide
        </Link>
        , which covers the same limits in more detail.
      </p>
    </div>
  );
}
