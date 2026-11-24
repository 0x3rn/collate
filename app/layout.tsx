import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AutoHideScrollbar } from "@/components/layout/auto-hide-scrollbar";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collate — Evidence-backed academic projects and theses",
  description:
    "Check whether real scholarly sources support your topic, then draft projects, theses, and assignments one verified chapter at a time.",
  openGraph: {
    title: "Collate — Evidence-backed academic projects and theses",
    description:
      "Check whether real scholarly sources support your topic, then draft projects, theses, and assignments one verified chapter at a time.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[var(--neutral-50)] text-[var(--neutral-900)]">
        <ToastProvider>
          {children}
          <AutoHideScrollbar />
        </ToastProvider>
      </body>
    </html>
  );
}
