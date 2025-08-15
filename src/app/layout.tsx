import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import ClientProviders from "./ClientProviders";
import Navbar from "@/components/Navbar"; // ⬅️ přidej

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
        <ClientProviders>
          <Navbar /> {/* ⬅️ sem */}
          <div className="pt-4">{children}</div> {/* malý offset pod sticky header */}
        </ClientProviders>
      </body>
    </html>
  );
}
