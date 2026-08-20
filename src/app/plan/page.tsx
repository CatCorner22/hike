"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  plannedDate: string | null;
  notes: string | null;
  updatedAt: string;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .finally(() => setLoading(false));
  }, []);

  async function createPlan() {
    const name = prompt("Plan name:");
    if (!name) return;

    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (response.ok) {
      const plan = await response.json();
      router.push(`/plan/${plan.id}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hike plans</h1>
          <p className="text-muted-foreground">
            Organize upcoming hikes with dates, notes, and camping stops.
          </p>
        </div>
        <Button onClick={createPlan}>
          <Plus className="mr-2 h-4 w-4" />
          New plan
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No plans yet.{" "}
            <Link href="/explore" className="text-primary hover:underline">
              Explore trails
            </Link>{" "}
            to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <Link key={plan.id} href={`/plan/${plan.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {plan.plannedDate && (
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(plan.plannedDate), "EEEE, MMM d, yyyy")}
                    </p>
                  )}
                  {plan.notes && (
                    <p className="mt-1 line-clamp-2 text-sm">{plan.notes}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
