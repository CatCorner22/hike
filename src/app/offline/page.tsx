import { OfflineSavedPacks } from "@/components/offline/offline-saved-packs";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-4 py-10">
      <section className="w-full space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Offline navigation</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          This navigation screen was not saved before service was lost.
        </h1>
        <p className="text-sm text-muted-foreground">
          Reconnect and open the plan or trail page, then choose Prepare offline.
          Saved route packs are listed below and can be opened with Open map.
          Export is a device file only — it is not cloud
          sync.
        </p>
        <OfflineSavedPacks />
      </section>
    </main>
  );
}
