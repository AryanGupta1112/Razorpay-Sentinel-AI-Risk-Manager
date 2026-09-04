"use client";

import { ViewTransition } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{
        "nav-forward": "nav-forward",
        "nav-back": "nav-back",
        "nav-swap": "nav-swap",
        default: "none",
      }}
      exit={{
        "nav-forward": "nav-forward",
        "nav-back": "nav-back",
        "nav-swap": "nav-swap",
        default: "none",
      }}
      default="none"
    >
      <div className="h-dvh overflow-hidden">{children}</div>
    </ViewTransition>
  );
}
