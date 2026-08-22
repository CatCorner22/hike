import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/layout/app-nav";
import {
  APP_DESCRIPTION,
  APP_FULL_TITLE,
  APP_NAME,
  APP_THEME_COLOR,
} from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: APP_FULL_TITLE,
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  openGraph: {
    title: APP_FULL_TITLE,
    description: APP_DESCRIPTION,
    type: "website",
    images: [{ url: "/brand/klandagi-mascot.png", alt: "Klandagi mountain lion mascot" }],
  },
};

export const viewport: Viewport = {
  themeColor: APP_THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Without viewport-fit=cover, iOS reports every env(safe-area-inset-*) as 0 —
  // which silently disabled the SOS button's and navigate footer's notch offsets.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
