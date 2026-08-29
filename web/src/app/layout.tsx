import { BRAND } from "@twin/brand";
import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Fira Sans for prose, Fira Code for every number on screen: an operator scans
// columns of figures, and a monospaced, tabular face keeps them aligned as they
// change each tick.
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  // `icon.png` and `apple-icon.png` next to this file are picked up by the App
  // Router automatically; no <link> tags and no manual sizes.
  title: `${BRAND.full} — LINE-01`,
  description:
    `${BRAND.NAME} akıllı fabrika dijital ikizinin canlı operasyon ekranı: OEE, istasyon durumu, kalite, iç lojistik ve sevkiyat.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `lang="tr"` is not decoration: CSS text-transform is locale-aware, and
  // without it a Turkish heading uppercases to EKIPMAN instead of EKİPMAN.
  // Every uppercase label on this screen depends on it.
  return (
    <html lang="tr" className={`dark ${firaSans.variable} ${firaCode.variable} h-full antialiased`}>
      <body className="bg-background text-foreground min-h-full">
        <TooltipProvider delay={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
