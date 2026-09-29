import type { Metadata } from "next";
import type { ReactNode } from "react";
import { directionFor, getInternalLocale } from "../lib/i18n";
import { AppProviders } from "./providers";
import "./globals.css";

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
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
