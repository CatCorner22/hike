"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Footprints,
  HardDriveDownload,
  HelpCircle,
  Map,
  Navigation,
  Search,
  Tent,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Map;
  primary?: boolean;
}

const navItems: NavItem[] = [
  { href: "/explore", label: "Explore", icon: Map },
  { href: "/plan", label: "Plans", icon: ClipboardList },
  { href: "/go", label: "Go", icon: Navigation, primary: true },
  { href: "/saved", label: "Saved", icon: HardDriveDownload },
  { href: "/activities", label: "Activities", icon: Footprints },
  { href: "/camping", label: "Camping", icon: Tent },
  { href: "/guide", label: "Guide", icon: HelpCircle },
];

const mobileNavItems: NavItem[] = [
  { href: "/explore", label: "Find", icon: Search },
  { href: "/plan", label: "Trips", icon: ClipboardList },
  { href: "/go", label: "Go", icon: Navigation, primary: true },
  { href: "/saved", label: "Saved", icon: HardDriveDownload },
  { href: "/guide", label: "Help", icon: HelpCircle },
];

export function AppNav() {
  const pathname = usePathname();
  const isNavigate = pathname.startsWith("/navigate");

  if (isNavigate) return null;

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <BrandLogo asLink iconClassName="h-7 w-7" />
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ href, label, icon: Icon, primary }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors",
                    primary
                      ? "bg-primary text-primary-foreground hover:bg-primary/80"
                      : "hover:bg-muted",
                    active
                      ? primary
                        ? "ring-2 ring-primary/40 ring-offset-2"
                        : "bg-muted font-medium"
                      : primary
                        ? ""
                        : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex justify-around py-2">
          {mobileNavItems.map(({ href, label, icon: Icon, primary }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-12 flex-col items-center justify-center gap-0.5 px-2 py-1 text-xs",
                  primary && "-mt-4 rounded-full border bg-primary px-4 py-2 text-primary-foreground shadow-lg",
                  active
                    ? primary ? "ring-2 ring-primary/40 ring-offset-2" : "text-green-700 dark:text-green-400"
                    : primary ? "" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
