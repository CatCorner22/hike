"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api/client";
import { formatDistance, formatDuration } from "@/lib/geo";
import { APP_NAME, APP_SHORT_DESCRIPTION, APP_TAGLINE } from "@/lib/brand";
import { trailPageHref } from "@/lib/ids";
import { activityDetailHref, planDetailHref } from "@/lib/routes";
import { KlandagiMascot } from "@/components/brand/klandagi-mascot";
import { formatPlannedDate } from "@/lib/plans/date-only";
import { HelpCircle, Map, ShieldCheck, Tent } from "lucide-react";

type HomePlan = { id: string; name: string; plannedDate: string | null };
type HomeActivity = { id: string; name: string | null; startedAt: string; stats: unknown };
type HomeTrail = { id: string; name: string; osmType?: string | null; osmId?: string | null };

/**
 * Client component on apiFetch, not a server component on direct DB reads: the
 * static (Capacitor) build has no server to render per-owner rows into HTML,
 * and on the web the same client fetch carries the owner cookie. Failing any
 * fetch renders the empty state — the home screen is a lobby, never a gate.
 */
export default function HomePage() {
  const [plans, setPlans] = useState<HomePlan[]>([]);
  const [recentActivities, setRecentActivities] = useState<HomeActivity[]>([]);
  const [recentTrails, setRecentTrails] = useState<HomeTrail[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [plansResult, activitiesResult, trailsResult] = await Promise.allSettled([
        apiFetch("/api/plans").then((response) => (response.ok ? response.json() : null)),
        apiFetch("/api/activities").then((response) => (response.ok ? response.json() : null)),
        apiFetch("/api/trails/recent").then((response) => (response.ok ? response.json() : null)),
      ]);
      if (cancelled) return;
      if (plansResult.status === "fulfilled" && Array.isArray(plansResult.value?.plans)) {
        // The API orders by updatedAt; the home card promises "Upcoming plans",
        // so order by the planned date with undated plans last.
        const sorted = [...(plansResult.value.plans as HomePlan[])].sort((a, b) => {
          const aTime = a.plannedDate ? Date.parse(a.plannedDate) : Number.NEGATIVE_INFINITY;
          const bTime = b.plannedDate ? Date.parse(b.plannedDate) : Number.NEGATIVE_INFINITY;
          return bTime - aTime;
        });
        setPlans(sorted.slice(0, 5));
      }
      if (activitiesResult.status === "fulfilled" && Array.isArray(activitiesResult.value?.activities)) {
        setRecentActivities((activitiesResult.value.activities as HomeActivity[]).slice(0, 5));
      }
      if (trailsResult.status === "fulfilled" && Array.isArray(trailsResult.value?.trails)) {
        setRecentTrails((trailsResult.value.trails as HomeTrail[]).slice(0, 5));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Upcoming plans</CardTitle><Link href="/plan" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link></CardHeader><CardContent>{plans.length === 0 ? <div className="space-y-2 text-sm text-muted-foreground"><p className="font-medium text-foreground">Three steps to your first prepared hike:</p><ol className="list-decimal space-y-1 pl-5"><li><Link href="/explore" className="text-primary hover:underline">Find a trail</Link> and create a plan.</li><li>Press <strong>Prepare offline</strong> while you have signal.</li><li>At the trailhead, verify readiness and open <strong>Go</strong>.</li></ol><Link href="/guide" className="text-primary hover:underline">Read the two-minute safety guide →</Link></div> : <ul className="space-y-3">{plans.map((plan) => <li key={plan.id}><Link href={planDetailHref(plan.id)} className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"><p className="font-medium">{plan.name}</p>{plan.plannedDate && <p className="text-sm text-muted-foreground">{formatPlannedDate(plan.plannedDate)}</p>}</Link></li>)}</ul>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Recent activities</CardTitle><Link href="/activities" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link></CardHeader><CardContent>{recentActivities.length === 0 ? <p className="text-sm text-muted-foreground">No recorded hikes yet. Start tracking from a trail page.</p> : <ul className="space-y-3">{recentActivities.map((activity) => { const stats = (activity.stats ?? null) as { distanceMeters?: number; durationSeconds?: number } | null; return <li key={activity.id}><Link href={activityDetailHref(activity.id)} className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"><p className="font-medium">{activity.name || "Trail activity"}</p><p className="text-sm text-muted-foreground">{format(new Date(activity.startedAt), "MMM d, yyyy")}{stats?.distanceMeters ? ` · ${formatDistance(stats.distanceMeters)}` : ""}{stats?.durationSeconds ? ` · ${formatDuration(stats.durationSeconds)}` : ""}</p></Link></li>; })}</ul>}</CardContent></Card>
    </div>

    {recentTrails.length > 0 && <Card><CardHeader><CardTitle>Recently viewed trails</CardTitle></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{recentTrails.map((trail) => <li key={trail.id}><Link href={trailPageHref(trail.id, trail.osmType, trail.osmId)} className="block rounded-lg border p-3 text-sm hover:bg-muted/50">{trail.name}</Link></li>)}</ul></CardContent></Card>}
  </div>;
}
