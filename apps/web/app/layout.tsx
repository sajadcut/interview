import type { Metadata } from "next";
import type { ReactNode } from "react";
import { directionFor, getDefaultLocale } from "../lib/i18n";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Interview Platform",
    template: "%s · Interview Platform",
  },
  description: "AI Recruiter platform",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = getDefaultLocale();
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
