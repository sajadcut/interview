import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { directionFor, getInternalLocale } from "../lib/i18n";
import { AppProviders } from "./providers";
import "./globals.css";

const bTraffic = localFont({
  src: [
    { path: "../../../font/B Traffic_0.ttf", weight: "400", style: "normal" },
    { path: "../../../font/B Traffic Bold_0.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-b-traffic",
  display: "swap",
  preload: true,
  fallback: ["Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "سامانه جذب و استخدام هوشمند",
    template: "%s · سامانه جذب و استخدام هوشمند",
  },
  description: "سامانه هوشمند جذب، ارزیابی و مدیریت فرایند استخدام",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = getInternalLocale();
  return (
    <html lang={locale} dir={directionFor(locale)} className={bTraffic.variable}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
