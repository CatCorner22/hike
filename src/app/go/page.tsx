import Link from "next/link";
import { OfflineSavedPacks } from "@/components/offline/offline-saved-packs";
import { buttonVariants } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function GoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Start a prepared route</p>
        <h1 className="text-3xl font-bold tracking-tight">Go hiking</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start a route only after this device confirms both the route and the app are ready offline.
          Test airplane mode before leaving signal.
        </p>
      </div>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <OfflineSavedPacks />
      </section>
      <Link href="/explore" className={buttonVariants({ variant: "outline" })}>
        <Search className="mr-2 h-4 w-4" />
        Find a route to prepare
      </Link>
    </div>
  );
}
