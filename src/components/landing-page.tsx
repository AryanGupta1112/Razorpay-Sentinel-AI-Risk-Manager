"use client";

import { useEffect, useRef, useState } from "react";
import { Instrument_Serif } from "next/font/google";
import { TransitionLink } from "@/components/motion/transition-link";
import styles from "./landing-page.module.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["400"],
  variable: "--font-instrument-serif",
});

function BadgeSparkle() {
  return (
    <svg className={styles.badgeStar} aria-hidden="true" width="18" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function LandingPage({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shellReady, setShellReady] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const revealReady = shellReady;
  const primaryCtaHref = isAuthenticated ? "/overview" : "/login";
  const primaryCtaLabel = isAuthenticated ? "Open Console" : "Login";
  const simulatorHref = isAuthenticated ? "/simulator" : "/login";

  useEffect(() => {
    const previousBackground = document.body.style.background;
    const previousColor = document.body.style.color;
    document.body.style.background = "#000";
    document.body.style.color = "#fff";

    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setShellReady(true);
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      document.body.style.background = previousBackground;
      document.body.style.color = previousColor;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const appearNodes = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.appear}`));
    const finalize = (node: HTMLElement) => node.classList.add(styles.isIn);

    const listeners = appearNodes.map((node) => {
      const handler = () => finalize(node);
      node.addEventListener("animationend", handler, { once: true });
      return () => node.removeEventListener("animationend", handler);
    });

    const frame1 = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => {
        const hasAnimations = appearNodes.some((node) =>
          node.getAnimations().some((animation) => animation.playState === "running" || animation.playState === "finished"),
        );

        if (!hasAnimations) {
          appearNodes.forEach(finalize);
        }
      });
      return () => cancelAnimationFrame(frame2);
    });

    return () => {
      cancelAnimationFrame(frame1);
      listeners.forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!shellReady) {
      return;
    }

    const idleCallback = "requestIdleCallback" in window
      ? window.requestIdleCallback(() => setShouldLoadVideo(true), { timeout: 900 })
      : null;
    const timeout = idleCallback ? null : window.setTimeout(() => setShouldLoadVideo(true), 180);

    return () => {
      if (idleCallback && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallback);
      }
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [shellReady]);

  return (
    <div
      ref={rootRef}
      className={[
        instrumentSerif.variable,
        styles.shell,
        shellReady ? styles.shellReady : "",
        videoLoaded ? styles.videoLoaded : "",
      ].join(" ")}
      style={{ background: "#000000", color: "#ffffff" }}
    >
      <div className={styles.grain} />
      <div className={styles.ambient} />
      <div
        className={styles.loadingVeil}
        aria-hidden="true"
        style={{
          opacity: shellReady ? (videoLoaded ? 0 : 0.16) : 1,
        }}
      />

      <div className={styles.videoFrame}>
        {shouldLoadVideo && (
          <video
            className={styles.video}
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260818_072341_50851634-bbc3-4c33-9acc-7647d4db44aa.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedData={() => setVideoLoaded(true)}
            style={{
              opacity: videoLoaded ? 1 : 0,
              filter: videoLoaded ? "blur(0px) brightness(1)" : "blur(18px) brightness(0.42)",
              transform: videoLoaded ? "scale(1)" : "scale(1.045)",
            }}
          />
        )}
      </div>

      <div
        className={styles.page}
        style={{
          opacity: revealReady ? 1 : 0,
          transform: revealReady ? "translateY(0px)" : "translateY(12px)",
          filter: revealReady ? "blur(0px)" : "blur(10px)",
        }}
      >
        <div className={styles.anchorTargets} aria-hidden="true">
          <span id="top" />
        </div>

        <header className={styles.header}>
          <TransitionLink
            href="/"
            label="Home"
            aria-label="Sentinel AI Risk Console"
            className={`${styles.logo} ${styles.appear} ${styles.appearScale}`}
            style={{ ["--d" as string]: "0.08s" }}
          >
            <span>Sentinel</span>
          </TransitionLink>

          <TransitionLink
            href={primaryCtaHref}
            label={primaryCtaLabel}
            className={`${styles.btn} ${styles.btnSolid} ${styles.headerCta} ${styles.appear} ${styles.appearScale}`}
            style={{ ["--d" as string]: "0.34s" }}
          >
            {primaryCtaLabel}
          </TransitionLink>
        </header>

        <main className={styles.hero} id="top">
          <div className={styles.heroCopy}>
            <div className={`${styles.badge} ${styles.appear} ${styles.appearPop}`} style={{ ["--d" as string]: "0.22s" }}>
              <BadgeSparkle />
              <span>Defense-Only Payments Risk Operations</span>
            </div>

            <h1 className={styles.heroTitle}>
              <span className={`${styles.headlineLine} ${styles.appear} ${styles.appearMask}`} style={{ ["--d" as string]: "0.42s" }}>
                Run <em>AI defenses</em> across
              </span>
              <span className={`${styles.headlineLine} ${styles.appear} ${styles.appearMask}`} style={{ ["--d" as string]: "0.62s" }}>
                your payments in minutes.
              </span>
            </h1>

            <p className={`${styles.lede} ${styles.appear} ${styles.appearSoft}`} style={{ ["--d" as string]: "0.82s", animationDuration: "1.25s" }}>
              Detect fraud spikes, explain risky transactions, queue manual review, and simulate threshold tradeoffs before rollout for payment-risk teams.
            </p>

            <div className={styles.heroActions}>
              <TransitionLink
                href={simulatorHref}
                label="Simulator"
                className={`${styles.btn} ${styles.btnGhost} ${styles.heroGhost} ${styles.appear} ${styles.appearSide}`}
                style={{ ["--d" as string]: "1.02s" }}
              >
                Launch simulator
              </TransitionLink>
            </div>
          </div>
        </main>

      </div>
    </div>
  );
}
