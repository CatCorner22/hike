"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Footprints,
  HelpCircle,
  Map,
  Mountain,
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
  // Desktop-only: the mobile bottom bar stays at five core destinations; on a phone the
  // guide is reached from the home screen and from the navigate error state.
  { href: "/guide", label: "Guide", icon: HelpCircle, desktopOnly: true },
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

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background md:hidden">
        <div className="flex justify-around py-2">
          {navItems.filter((item) => !item.desktopOnly).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[10px]",
                pathname === href || pathname.startsWith(`${href}/`)
                  ? "text-green-600"
                  : "text-muted-foreground",
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
