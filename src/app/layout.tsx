import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { RouteTransitionProvider } from "@/components/motion/route-transition-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Sentinel Risk Operations Console",
  description: "Explainable payment-risk monitoring, simulation, and human-controlled response.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {/* Sentinel is a black-and-gold fraud-ops command center for real-time analyst triage, explainable holds, merchant review, and live policy simulation. */}
        <RouteTransitionProvider>{children}</RouteTransitionProvider>
      </body>
    </html>
  );
}
