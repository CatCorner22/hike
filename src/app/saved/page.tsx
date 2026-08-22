import Link from "next/link";
import { Search } from "lucide-react";
import { OfflineSavedPacks } from "@/components/offline/offline-saved-packs";
import { buttonVariants } from "@/components/ui/button";

export default function SavedPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Stored on this device</p>
        <h1 className="text-3xl font-bold tracking-tight">Saved offline routes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open, back up, import, or remove routes saved in this browser. These files are not synced to the cloud.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Saved offline routes">
        <OfflineSavedPacks />
      </section>

      <Link href="/explore" className={buttonVariants({ variant: "outline" })}>
        <Search className="mr-2 h-4 w-4" />
        Find a route to prepare
      </Link>
    </div>
  );
}
