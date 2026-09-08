import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata = {
  title: `Privacy — ${APP_NAME}`,
  description: `What ${APP_NAME} stores, what leaves your phone, and what it never collects.`,
};

/**
 * A Privacy Policy URL is a required App Store Connect submission field, and
 * none existed — so the build could not reach a reviewer at all. It is also the
 * honest counterpart to the location purpose strings in Info.plist: everything
 * here has to match what the code does, not what the marketing copy says.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Plain language, no lawyers required</p>
        <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {APP_NAME} is a personal safety tool. The short version: there is no advertising,
          no analytics, no third-party tracking, and nothing is sold or shared. What follows
          is the long version, and it describes what the software actually does.
        </p>
      </div>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">What stays on your phone</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Downloaded route packs, maps, and the offline reference content.</li>
          <li>Your emergency-contact card, medical notes, and party details.</li>
          <li>Your planned return time, and the alarm set from it.</li>
          <li>Live position while you navigate, and the breadcrumb of a hike in progress.</li>
          <li>Photos and notes you capture in the field.</li>
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">What leaves your phone, and when</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <strong>Finished track points.</strong> When you are back in signal, the track
            you recorded is uploaded to {APP_NAME}&rsquo;s own server so a lost or broken
            phone does not take the hike with it. Each point is a latitude, longitude,
            elevation and timestamp.
          </li>
          <li>
            <strong>Plans, trails and activities you save.</strong> Stored against an
            anonymous device identity so they follow you between sessions.
          </li>
          <li>
            <strong>Trail and campground searches.</strong> Sent to public data services
            (the National Park Service, Recreation.gov, state park data) to answer the
            search.
          </li>
          <li>
            <strong>Anything you choose to send.</strong> An emergency text, a Trip Guardian
            link, a shared GPX file. These go where you send them, when you send them.
          </li>
          <li>
            <strong>Pioneer observations, when a model key is configured.</strong> The
            server sends a de-identified prep snapshot — trail name, allow-listed OSM
            tags, research unknowns, pack/readiness flags — to the model provider. It
            does not send GPS coordinates, ICE names or phone numbers, plan-note text,
            or medical fields. When no key is set, Pioneer stays on-device as local
            gauges.
          </li>
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Who you are, as far as the server is concerned</h2>
        <p className="text-sm text-muted-foreground">
          There is no account, no email address, and no password. Your device holds a
          random identifier that the server uses to keep your own plans separate from
          everyone else&rsquo;s. It is not linked to your name, your phone number, or any
          advertising profile, and it is not shared with anyone.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">What is never collected</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>No advertising identifiers, and no advertising.</li>
          <li>No analytics or crash-reporting SDKs.</li>
          <li>No contacts, no calendar, no microphone, no health data.</li>
          <li>
            The camera is used only to read a position QR code shown on another phone.
            Nothing is recorded, stored, or transmitted.
          </li>
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Deleting your data</h2>
        <p className="text-sm text-muted-foreground">
          Removing a saved route on the{" "}
          <Link href="/saved" className="underline underline-offset-2">
            saved routes
          </Link>{" "}
          screen deletes it from this device. Deleting a plan or an activity deletes it
          from the server too. Deleting the app removes everything held on the phone. To
          have everything associated with your device identity removed from the server,
          use the delete controls on each plan and activity, or ask through the contact
          route in the app listing.
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        If any statement here ever disagrees with what the software does, the software is
        the bug. Please report it.
      </p>
    </div>
  );
}
