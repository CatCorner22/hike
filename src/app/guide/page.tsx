import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertTriangle,
  BatteryCharging,
  ClipboardList,
  Compass,
  Download,
  Footprints,
  Map,
  Phone,
  Siren,
} from "lucide-react";

export const metadata: Metadata = {
  title: `How to use ${APP_NAME}`,
  description: "Plan a hike, save it for offline, navigate on the trail, and get help if something goes wrong.",
};

/**
 * Hiker-facing instructions, organised by moment of use. Deep-linkable: /guide#offline
 * is linked from the navigate screen's "cannot navigate offline" error, which is where a
 * confused first-time user actually lands.
 */
export default function GuidePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-green-600 to-emerald-800 p-6 text-white">
        <h1 className="text-2xl font-bold tracking-tight">How to use {APP_NAME}</h1>
        <p className="mt-2 text-sm text-green-50">
          Five minutes now saves a bad hour on the trail. The one rule that matters:{" "}
          <strong>save your route while you still have signal.</strong> Everything else is
          detail.
        </p>
      </section>

      <Card id="start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ClipboardList className="h-5 w-5 text-green-700 dark:text-green-400" />
            1 · At home — plan the hike
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <Link href="/explore" className="font-medium text-primary hover:underline">
              Explore
            </Link>{" "}
            finds real trails by name or by map area. Open one to see its length, climb,
            and elevation profile. Research loads on its own; use <strong>Refresh</strong>{" "}
            to update the AI summary of seasons, hazards, parking, and permits — double-check
            anything important against the park&apos;s own site.
          </p>
          <p>
            Press <strong>Add to plan</strong> on a trail (or{" "}
            <Link href="/plan" className="font-medium text-primary hover:underline">
              Plans → New plan
            </Link>{" "}
            with your own GPX file) to save it with a date and notes. The{" "}
            <Link href="/camping" className="font-medium text-primary hover:underline">
              Camping
            </Link>{" "}
            tab finds tent, backcountry, and walk-in sites near your route.
          </p>
          <p>
            In the plan&apos;s <strong>Safety</strong> panel, fill in your{" "}
            <strong>ICE contact</strong> (name and phone) and party size once — every
            emergency message the app writes for you includes them.
          </p>
        </CardContent>
      </Card>

      <Card id="offline">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-green-700 dark:text-green-400" />
            2 · Before you lose signal — the step that matters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Open your trail or plan and press{" "}
            <strong className="text-foreground">Prepare offline</strong> while you still
            have signal — at home on Wi-Fi, or at the trailhead. That saves the route, the
            elevation profile, and the navigation screen itself onto your phone. The
            readiness checklist under the button turns green when it worked.
          </p>
          <p>
            Do this <em>before</em> you drive out of coverage. Navigation cannot download a
            route it has never seen.
          </p>
          <p className="rounded-md border border-amber-700/40 bg-amber-700/5 p-3 text-foreground">
            <strong>What the offline map is, and is not.</strong> Klandagi draws your route,
            your track, nearby trails, roads, water and landmarks, and shades the relief from
            elevation samples taken when you prepared the route — usually a hundred to a few
            hundred metres apart. That is enough to see where the ridges and the drainages
            are. It is not a topo map: there are no contour lines, no imagery, and a cliff
            narrower than the sample spacing does not exist as far as the shading is
            concerned. Carry a paper topo. This app is not one.
          </p>
          <p className="rounded-md border border-amber-700/40 bg-amber-700/5 p-3 text-foreground">
            <strong>Klandagi follows one phone, not a party.</strong> The party size you
            enter is printed on the leave-behind card and the SOS text so a searcher knows
            how many people to look for. Nothing tracks the others: if the group splits up,
            this app cannot tell anyone, and the return-time alarm belongs to this phone
            alone.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Install the app</strong> when the browser offers &quot;Add to Home
              Screen&quot; — installation can make the app easier to retain and reopen, but
              it does not guarantee that saved data will remain on the device.
            </li>
            <li>
              Don&apos;t clear the browser&apos;s site data before a trip: that deletes
              saved routes, and your plans are tied to this browser.
            </li>
            <li>
              Start with a full battery. The navigation screen requests a wake lock, but
              the browser or battery policy can still let the display sleep.
            </li>
            <li>
              Already-saved routes live on{" "}
              <Link href="/saved" className="font-medium text-primary hover:underline">
                the Saved page
              </Link>
              . That list is stored on this device and offers file backup/export; it is not
              cloud sync and is separate from these preparation steps.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card id="navigate">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Compass className="h-5 w-5 text-green-700 dark:text-green-400" />
            3 · On the trail — navigate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Press <strong className="text-foreground">Navigate</strong> on your trail or
            plan. The screen works entirely from what you saved — no signal, no map tiles
            needed. Your position is the blue dot; the route is the green line.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Remaining / Climb left / Est. time</strong> update as you walk. Walk
              about 50 m first so the app learns which way along the route you&apos;re
              going.
            </li>
            <li>
              Drift more than ~35 m off the route and the screen warns you; at ~80 m it
              turns red, vibrates, and shows the compass bearing back to the trail.
            </li>
            <li>
              <strong>Backtrack</strong> draws the breadcrumbs this phone successfully
              recorded. Confirm the line is continuous and that retracing it is still
              safe; GPS, battery, browser limits, weather, fire, water, or terrain can
              make a saved track incomplete or unsafe to follow.
            </li>
            <li>
              GPS drops in canyons and heavy trees. The app holds your last known position
              and marks it stale rather than guessing.
            </li>
            <li>
              The <strong>Safety</strong> panel on that screen has the deeper tools when
              you want them: check-in timer, waypoints, first-aid references, and the SAR
              land-navigation kit (grid coordinates, resection, search patterns).
            </li>
          </ul>
          <p>
            Afterwards,{" "}
            <Link href="/activities" className="font-medium text-primary hover:underline">
              Activities
            </Link>{" "}
            records your tracks — distance, climb, pace — and syncs them when signal
            returns.
          </p>
        </CardContent>
      </Card>

      <Card id="emergency" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Siren className="h-5 w-5 text-destructive" />
            4 · If something goes wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Lost?</strong> Stop walking. Open the
              Safety panel — it shows the phone&apos;s current or last-known position in
              several common coordinate formats, together with fix age and accuracy.
              Backtrack draws the breadcrumbs this phone successfully recorded; gaps can
              occur when GPS, battery, or browser recording fails.
            </li>
            <li>
              <strong className="text-foreground">Need help?</strong> The{" "}
              <strong>Share location</strong> button writes a complete message — position,
              route, and your ICE details — ready for you to send when service is
              available. SMS may sometimes work when a voice call does not, but delivery
              is never guaranteed; look for an acknowledgement.
            </li>
            <li>
              <strong className="text-foreground">Need to be found?</strong>{" "}
              <strong>Sound &amp; flash locator</strong> strobes the screen and loops a
              distress tone. It does not contact 911, SAR, or transmit your location.
              Volume up. Three repeated whistle blasts or light flashes are a widely
              recognized distress convention, but responders may use different local
              procedures.
            </li>
            <li>
              <strong className="text-foreground">Hurt, cold, or at altitude?</strong> The
              Safety panel&apos;s first-aid tools walk you through bleeding control,
              hypothermia, heat illness, and altitude sickness step by step, offline.
            </li>
          </ul>
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              A phone is not a rescue device. It runs out of battery, breaks, and loses
              GPS. Carry a paper map and compass, tell someone your plan and return time,
              and take a satellite messenger or PLB beyond cell coverage. This app is a
              backup for your judgement, not a replacement.
            </span>
          </p>
        </CardContent>
      </Card>

      <Card id="faq">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5 text-green-700 dark:text-green-400" />
            Quick answers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">What works without signal?</p>
            <p>
              Navigation, your saved routes, the Navigate screen&apos;s breadcrumb trail,
              the Safety panel, and SOS. Searching new trails, camping lookups, and trail
              research need a connection.
            </p>
            <p className="mt-1">
              <strong>Activity recording can start offline.</strong> Press{" "}
              <strong>Start recording</strong> even without signal — points queue on this
              phone and upload when you are back in range. If the server rejects the start
              while you still have signal, the app says so instead of pretending you are
              offline.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">
              Navigate says &quot;prepare offline first&quot;?
            </p>
            <p>
              The route was never saved on this phone. Get signal once, open the trail or
              plan, press <strong>Prepare offline</strong>, and it will work offline from
              then on.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Where are my plans stored?</p>
            <p>
              On {APP_NAME}&apos;s own server, under an anonymous device identity — there is
              no account to sign into and no email address involved, but the plans
              themselves are not only on this phone. Finished tracks upload the same way
              once you are back in range, so losing the phone does not lose the hike.
              Clearing cookies or switching browsers starts you fresh (already-saved
              offline routes keep working either way). The{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                privacy page
              </Link>{" "}
              lists exactly what leaves the phone.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
            <p>
              <span className="font-medium text-foreground">Battery discipline:</span>{" "}
              airplane mode with GPS on, screen dim, and the app warns you at 20% with what
              to do next.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 pb-8">
        <Link href="/explore" className={buttonVariants({})}>
          <Map className="mr-2 h-4 w-4" />
          Find a trail
        </Link>
        <Link href="/plan" className={buttonVariants({ variant: "outline" })}>
          <Footprints className="mr-2 h-4 w-4" />
          My plans
        </Link>
      </div>
    </div>
  );
}
