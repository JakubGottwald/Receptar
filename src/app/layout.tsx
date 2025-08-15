import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";

import { Suspense } from "react";
import Navbar from "@/components/Navbar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Receptář",
  description: "Osobní recepty a makra",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Navbar používá useSearchParams → musí být v Suspense */}
        <Suspense fallback={<div className="h-16" />}>
          <Navbar />
        </Suspense>

        {/* Doporučené: i obsah stránky, pokud někde používá useSearchParams */}
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
