import Link from "next/link";
import { format } from "date-fns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listRecentTrails } from "@/lib/trails/service";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans, activities } from "@/lib/db/schema";
import { listActivities, listPlans } from "@/lib/store/local";
import { desc, eq } from "drizzle-orm";
import { resolveOwnerIdFromCookies } from "@/lib/auth/owner-server";
import { formatDistance, formatDuration } from "@/lib/geo";
import { APP_NAME, APP_SHORT_DESCRIPTION, APP_TAGLINE } from "@/lib/brand";
import { trailPageHref } from "@/lib/ids";
import { KlandagiMascot } from "@/components/brand/klandagi-mascot";
import { HelpCircle, Map, ShieldCheck, Tent } from "lucide-react";

type HomePlan = { id: string; name: string; plannedDate: Date | string | null };
type HomeActivity = { id: string; name: string | null; startedAt: Date | string; stats: unknown };

export default async function HomePage() {
  let plans: HomePlan[] = [];
  let recentActivities: HomeActivity[] = [];
  let recentTrails: Awaited<ReturnType<typeof listRecentTrails>> = [];
  const ownerId = await resolveOwnerIdFromCookies();

  if (hasDatabase()) {
    const db = getDb();
    [plans, recentActivities, recentTrails] = await Promise.all([
      ownerId ? db.query.hikePlans.findMany({ where: eq(hikePlans.ownerId, ownerId), orderBy: [desc(hikePlans.plannedDate)], limit: 5 }) : Promise.resolve([]),
      ownerId ? db.query.activities.findMany({ where: eq(activities.ownerId, ownerId), orderBy: [desc(activities.startedAt)], limit: 5 }) : Promise.resolve([]),
      listRecentTrails(5),
    ]);
  } else if (ownerId) {
    const [localPlans, localActs] = await Promise.all([listPlans(ownerId), listActivities(ownerId)]);
    plans = localPlans.slice(0, 5);
    recentActivities = localActs.slice(0, 5);
    recentTrails = await listRecentTrails(5);
  } else {
    recentTrails = await listRecentTrails(5);
  }

  return <div className="space-y-8">
    <section className="rounded-2xl bg-gradient-to-br from-green-600 to-emerald-800 p-8 text-white">
      <div className="flex items-start gap-4">
        <KlandagiMascot className="mt-1 h-14 w-14 shrink-0 drop-shadow-md" decorative />
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-green-100/90">{APP_NAME}</p>
          <h1 className="text-3xl font-bold tracking-tight">{APP_TAGLINE}</h1>
          <p className="mt-2 max-w-2xl text-green-50">{APP_NAME} is {APP_SHORT_DESCRIPTION.toLowerCase()}: plan intelligently, prepare offline, navigate confidently, and keep a backup plan when conditions change.</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-green-50"><ShieldCheck className="h-4 w-4" /> Offline-first · uncertainty stated plainly · safety math stays deterministic</div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/explore" className={buttonVariants({ variant: "secondary" })}><Map className="mr-2 h-4 w-4" />Explore trails</Link>
            <Link href="/camping" className={buttonVariants({ variant: "outline", className: "border-white/30 bg-white/10 text-white hover:bg-white/20" })}><Tent className="mr-2 h-4 w-4" />Find camping</Link>
            <Link href="/guide" className={buttonVariants({ variant: "ghost", className: "text-white hover:bg-white/10 hover:text-white" })}><HelpCircle className="mr-2 h-4 w-4" />Safety guide</Link>
          </div>
        </div>
      </div>
    </section>

    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardHeader><CardTitle className="text-base">Prepare before signal disappears</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Save the route, navigation shell, weather snapshot, and safety context before leaving coverage.</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Make decisions, not guesses</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Daylight margin, off-route recovery, decision points, and bailout planning are designed to remain inspectable offline.</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Communicate uncertainty honestly</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">A stale fix is labeled stale. Cached weather is labeled cached. A missed check-in never pretends to prove distress.</CardContent></Card>
    </div>

    <div className="grid gap-6 md:grid-cols-2">
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Upcoming plans</CardTitle><Link href="/plan" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link></CardHeader><CardContent>{plans.length === 0 ? <div className="space-y-2 text-sm text-muted-foreground"><p className="font-medium text-foreground">Three steps to your first prepared hike:</p><ol className="list-decimal space-y-1 pl-5"><li><Link href="/explore" className="text-primary hover:underline">Find a trail</Link> and create a plan.</li><li>Press <strong>Prepare offline</strong> while you have signal.</li><li>At the trailhead, verify readiness and press <strong>Navigate</strong>.</li></ol><Link href="/guide" className="text-primary hover:underline">Read the two-minute safety guide →</Link></div> : <ul className="space-y-3">{plans.map((plan) => <li key={plan.id}><Link href={`/plan/${plan.id}`} className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"><p className="font-medium">{plan.name}</p>{plan.plannedDate && <p className="text-sm text-muted-foreground">{format(new Date(plan.plannedDate), "MMM d, yyyy")}</p>}</Link></li>)}</ul>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Recent activities</CardTitle><Link href="/activities" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link></CardHeader><CardContent>{recentActivities.length === 0 ? <p className="text-sm text-muted-foreground">No recorded hikes yet. Start tracking from a trail page.</p> : <ul className="space-y-3">{recentActivities.map((activity) => { const stats = (activity.stats ?? null) as { distanceMeters?: number; durationSeconds?: number } | null; return <li key={activity.id}><Link href={`/activities/${activity.id}`} className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"><p className="font-medium">{activity.name || "Trail activity"}</p><p className="text-sm text-muted-foreground">{format(new Date(activity.startedAt), "MMM d, yyyy")}{stats?.distanceMeters ? ` · ${formatDistance(stats.distanceMeters)}` : ""}{stats?.durationSeconds ? ` · ${formatDuration(stats.durationSeconds)}` : ""}</p></Link></li>; })}</ul>}</CardContent></Card>
    </div>

    {recentTrails.length > 0 && <Card><CardHeader><CardTitle>Recently viewed trails</CardTitle></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{recentTrails.map((trail) => <li key={trail.id}><Link href={trailPageHref(trail.id, trail.osmType, trail.osmId)} className="block rounded-lg border p-3 text-sm hover:bg-muted/50">{trail.name}</Link></li>)}</ul></CardContent></Card>}
  </div>;
}
