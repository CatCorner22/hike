"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Navigation } from "lucide-react";

interface NavigateLinkProps {
  href: string;
  checking: boolean;
  packReady: boolean;
  tripReady: boolean;
  className?: string;
}

export function NavigateLink({ href, checking, packReady, tripReady, className }: NavigateLinkProps) {
  if (!packReady) {
    return (
      <span
        className={cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-none opacity-60",
          className,
        )}
        title={checking ? "Saving route data on this device…" : "Save this route before opening navigation."}
      >
        <Navigation className="mr-2 h-4 w-4 animate-pulse" />
        {checking ? "Preparing route…" : "Route not saved"}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "outline" }), className)}
      title={tripReady
        ? "Offline launch files passed the on-device check."
        : "Basic route data is saved, but a first offline launch is not verified."}
    >
      <Navigation className="mr-2 h-4 w-4" />
      {tripReady ? "Navigate" : "Open basic route"}
    </Link>
  );
}
