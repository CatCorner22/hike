import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/layout/app-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hike — Plan, Track & Navigate",
  description:
    "Plan hikes, track activities, navigate trails in real time, research trail conditions, and find camping at state and national parks.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hike",
  },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background pb-16 md:pb-0">
        <AppNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
