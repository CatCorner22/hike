"use client";
import { apiFetch } from "@/lib/api/client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPlannedDate } from "@/lib/plans/date-only";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, FileUp, Loader2, Map, Plus } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  plannedDate: string | null;
  notes: string | null;
  updatedAt: string;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const loadPlans = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await apiFetch("/api/plans", { signal });
      const data = await response.json() as { plans?: Plan[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Trips could not be loaded.");
      if (!Array.isArray(data.plans)) throw new Error("Trips could not be read from the server response.");
      setPlans(data.plans);
      setLoadState("ready");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "Trips could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadTimer = window.setTimeout(() => void loadPlans(controller.signal), 0);
    return () => {
      window.clearTimeout(loadTimer);
      controller.abort();
    };
  }, [loadPlans]);

  async function importGpx(file: File) {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const routeName = file.name.replace(/\.gpx$/i, "").trim() || "Imported route";
      const parseResponse = await apiFetch("/api/sync/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpx: await file.text(), name: routeName }),
      });
      const parsed = await parseResponse.json() as {
        name?: string;
        geometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
        error?: string;
      };
      if (!parseResponse.ok || !parsed.geometry) {
        throw new Error(parsed.error || "That file does not contain a usable GPX route.");
      }

      const createResponse = await apiFetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: parsed.name?.trim() || routeName,
          customGeometry: parsed.geometry,
        }),
      });
      const created = await createResponse.json() as { id?: string; error?: string };
      if (!createResponse.ok || !created.id) {
        throw new Error(created.error || "A trip could not be created from that GPX file.");
      }

      setChooserOpen(false);
      router.push(`/plan/${created.id}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "That GPX file could not be imported.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trips</h1>
          <p className="text-muted-foreground">
            Organize upcoming hikes with dates, notes, and camping stops.
          </p>
        </div>
        <Dialog
          open={chooserOpen}
          onOpenChange={(open) => {
            if (importing && !open) return;
            setChooserOpen(open);
            if (open) setImportError(null);
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" />
            New trip
          </DialogTrigger>
          <DialogContent showCloseButton={!importing}>
            <DialogHeader>
              <DialogTitle>How do you want to start?</DialogTitle>
              <DialogDescription>
                Begin with a trail from Klandagi or import a GPX route. A trip is created only after a route is selected.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <Link href="/explore" className={buttonVariants({ className: "min-h-12 justify-start" })}>
                <Map className="mr-2 h-5 w-5" />
                Find a trail
              </Link>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml"
                aria-label="Choose GPX file to import"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importGpx(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-12 justify-start"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <FileUp className="mr-2 h-5 w-5" />}
                {importing ? "Importing GPX…" : "Import a GPX file"}
              </Button>
            </div>

            {importError && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>GPX import failed</AlertTitle>
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="ghost" disabled={importing} />}>
                Cancel
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadState === "loading" ? (
        <p role="status" className="text-muted-foreground">Loading trips…</p>
      ) : loadState === "error" ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Trips could not be loaded</AlertTitle>
          <AlertDescription>
            <p>{loadError ?? "Check your connection and try again."}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => {
                setLoadState("loading");
                setLoadError(null);
                void loadPlans();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No trips yet. Choose <strong className="text-foreground">New trip</strong> to find a trail or import a GPX route.
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
                      {formatPlannedDate(plan.plannedDate, "full")}
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
