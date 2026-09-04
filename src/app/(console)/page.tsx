import type { Metadata } from "next";
import { PageTransition } from "@/components/motion/page-transition";
import LandingPage from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Sentinel AI Risk Console",
  description: "Defense-only payment-risk monitoring, simulation, and response workspace.",
};

export default function RootEntryPage() {
  return (
    <PageTransition>
      <LandingPage />
    </PageTransition>
  );
}
