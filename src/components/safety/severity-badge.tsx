"use client";

import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/lib/safety/severity";

export function severityClasses(severity: Severity): string {
  switch (severity) {
    case "critical": return "border-destructive/50 bg-destructive/10 text-destructive";
    case "warning": return "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "caution": return "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300";
    default: return "border-border bg-muted text-muted-foreground";
  }
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge className={`text-[10px] uppercase ${severityClasses(severity)}`}>{severity}</Badge>;
}
