import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { directionFor, getInternalLocale } from "../lib/i18n";
import { AppProviders } from "./providers";
import "./globals.css";

const iranSansX = localFont({
  src: [
    { path: "../../../font/IRANSansXThin.ttf", weight: "100", style: "normal" },
    { path: "../../../font/IRANSansXUltraLight.ttf", weight: "200", style: "normal" },
    { path: "../../../font/IRANSansXLight.ttf", weight: "300", style: "normal" },
    { path: "../../../font/IRANSansXRegular.ttf", weight: "400", style: "normal" },
    { path: "../../../font/IRANSansXMedium.ttf", weight: "500", style: "normal" },
    { path: "../../../font/IRANSansXDemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../../font/IRANSansXBold.ttf", weight: "700", style: "normal" },
    { path: "../../../font/IRANSansXExtraBold.ttf", weight: "800", style: "normal" },
    { path: "../../../font/IRANSansXBlack.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-iran-sans-x",
  display: "swap",
  // Only the weights used by each route should download; preloading nine files is wasteful.
  preload: false,
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
    <html lang={locale} dir={directionFor(locale)} className={iranSansX.variable}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
