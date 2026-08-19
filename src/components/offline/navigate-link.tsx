"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Navigation } from "lucide-react";

interface NavigateLinkProps {
  href: string;
  ready: boolean;
  className?: string;
}

export function NavigateLink({ href, ready, className }: NavigateLinkProps) {
  if (!ready) {
    return (
      <span
        className={cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-none opacity-60",
          className,
        )}
        title="Saving route for offline use…"
      >
        <Navigation className="mr-2 h-4 w-4 animate-pulse" />
        Preparing offline…
      </span>
    );
  }

  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline" }), className)}>
      <Navigation className="mr-2 h-4 w-4" />
      Navigate
    </Link>
  );
}
