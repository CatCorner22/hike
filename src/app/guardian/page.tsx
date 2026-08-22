import type { Metadata } from "next";
import { GuardianStatusView } from "@/components/safety/guardian-status-view";

export const metadata: Metadata = {
  title: "Trip Guardian status",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function GuardianPage() {
  return (
    <section className="py-4 sm:py-10">
      <GuardianStatusView />
    </section>
  );
}
