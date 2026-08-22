"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Footprints,
  HardDriveDownload,
  HelpCircle,
  Map,
  Mountain,
  Navigation,
  Search,
  Tent,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Mountain },
  { href: "/explore", label: "Explore", icon: Map },
  { href: "/plan", label: "Plans", icon: ClipboardList },
  { href: "/activities", label: "Activities", icon: Footprints },
  { href: "/camping", label: "Camping", icon: Tent },
  // Desktop-only here; the phone layout defines its own five core destinations below.
  { href: "/guide", label: "Guide", icon: HelpCircle, desktopOnly: true },
];

const mobileNavItems = [
  { href: "/explore", label: "Find", icon: Search },
  { href: "/plan", label: "Trips", icon: ClipboardList },
  { href: "/go", label: "Go", icon: Navigation, primary: true },
  { href: "/offline", label: "Saved", icon: HardDriveDownload },
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
            {navItems.slice(1).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? "bg-muted font-medium"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex justify-around py-2">
          {mobileNavItems.map(({ href, label, icon: Icon, primary }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-w-12 flex-col items-center gap-0.5 px-2 py-1 text-[10px]",
                primary && "-mt-4 rounded-full border bg-primary px-4 py-2 text-primary-foreground shadow-lg",
                pathname === href || pathname.startsWith(`${href}/`)
                  ? primary ? "ring-2 ring-primary/40 ring-offset-2" : "text-green-600"
                  : primary ? "" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
