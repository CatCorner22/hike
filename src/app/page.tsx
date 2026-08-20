import Link from "next/link";
import { format } from "date-fns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listRecentTrails } from "@/lib/trails/service";
import { getDb, hasDatabase } from "@/lib/db";
import { hikePlans, activities } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { resolveOwnerIdFromCookies } from "@/lib/auth/owner-server";
import { formatDistance, formatDuration } from "@/lib/geo";
import { Compass, Map, Tent } from "lucide-react";

export default async function HomePage() {
  let plans: Array<typeof hikePlans.$inferSelect> = [];
  let recentActivities: Array<typeof activities.$inferSelect> = [];
  let recentTrails: Awaited<ReturnType<typeof listRecentTrails>> = [];

  // This page reads the database directly instead of going through /api, so it has to
  // apply the same owner scoping the routes do — otherwise the landing page lists every
  // plan and GPS track on the deployment no matter what the API enforces.
  const ownerId = await resolveOwnerIdFromCookies();

  if (hasDatabase()) {
    const db = getDb();
    [plans, recentActivities, recentTrails] = await Promise.all([
      ownerId
        ? db.query.hikePlans.findMany({
            where: eq(hikePlans.ownerId, ownerId),
            orderBy: [desc(hikePlans.plannedDate)],
            limit: 5,
          })
        : Promise.resolve([]),
      ownerId
        ? db.query.activities.findMany({
            where: eq(activities.ownerId, ownerId),
            orderBy: [desc(activities.startedAt)],
            limit: 5,
          })
        : Promise.resolve([]),
      listRecentTrails(5),
    ]);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-green-600 to-emerald-800 p-8 text-white">
        <div className="flex items-start gap-4">
          <Compass className="mt-1 h-10 w-10 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Hike</h1>
            <p className="mt-2 max-w-xl text-green-50">
              Plan hikes, track your adventures, navigate in real time, research
              trail conditions, and find tent and backcountry camping.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/explore"
                className={buttonVariants({ variant: "secondary" })}
              >
                <Map className="mr-2 h-4 w-4" />
                Explore trails
              </Link>
              <Link
                href="/camping"
                className={buttonVariants({
                  variant: "outline",
                  className: "border-white/30 bg-white/10 text-white hover:bg-white/20",
                })}
              >
                <Tent className="mr-2 h-4 w-4" />
                Find camping
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Upcoming plans</CardTitle>
            <Link href="/plan" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plans yet.{" "}
                <Link href="/explore" className="text-primary hover:underline">
                  Find a trail
                </Link>{" "}
                to get started.
              </p>
            ) : (
              <ul className="space-y-3">
                {plans.map((plan) => (
                  <li key={plan.id}>
                    <Link
                      href={`/plan/${plan.id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <p className="font-medium">{plan.name}</p>
                      {plan.plannedDate && (
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(plan.plannedDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent activities</CardTitle>
            <Link href="/activities" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recorded hikes yet. Start tracking from a trail page.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentActivities.map((activity) => {
                  const stats = activity.stats as {
                    distanceMeters?: number;
                    durationSeconds?: number;
                  } | null;
                  return (
                    <li key={activity.id}>
                      <Link
                        href={`/activities/${activity.id}`}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <p className="font-medium">
                          {activity.name || "Hike activity"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(activity.startedAt), "MMM d, yyyy")}
                          {stats?.distanceMeters
                            ? ` · ${formatDistance(stats.distanceMeters)}`
                            : ""}
                          {stats?.durationSeconds
                            ? ` · ${formatDuration(stats.durationSeconds)}`
                            : ""}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {recentTrails.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently viewed trails</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recentTrails.map((trail) => (
                <li key={trail.id}>
                  <Link
                    href={`/trails/${trail.id}`}
                    className="block rounded-lg border p-3 text-sm hover:bg-muted/50"
                  >
                    {trail.name}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
