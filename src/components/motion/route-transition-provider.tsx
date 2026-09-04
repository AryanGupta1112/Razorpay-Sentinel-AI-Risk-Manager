"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { PORTRAIT_H, PORTRAIT_W, paintPortrait } from "@/lib/sentinel-pixel-art/agent-art";
import type { AgentCharacter } from "@/lib/sentinel-pixel-art/agent-art";
import styles from "./route-transition-provider.module.css";

type NavigateOptions = {
  href: string;
  label?: string;
  variant?: "default" | "console-entry";
};

type RouteTransitionContextValue = {
  navigate: (options: NavigateOptions) => void;
};

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(null);

const ENTRY_AGENTS: AgentCharacter[] = [
  "signal-scout",
  "merchant-guard",
  "policy-guard",
  "queue-ops",
];
const CONSOLE_ENTRY_MINIMUM_MS = 1_800;
const CONSOLE_ENTRY_EXIT_MS = 760;
const CONSOLE_ENTRY_MAXIMUM_MS = 12_000;

function LoadingPortrait({ character }: { character: AgentCharacter }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context) paintPortrait(context, character, 1);
  }, [character]);

  return <canvas ref={canvasRef} width={PORTRAIT_W} height={PORTRAIT_H} aria-hidden="true" />;
}

function normalizePath(href: string) {
  try {
    return new URL(href, window.location.origin).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return href.replace(/\/+$/, "") || "/";
  }
}

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [settling, setSettling] = useState(false);
  const [label, setLabel] = useState("Opening console");
  const [variant, setVariant] = useState<NavigateOptions["variant"]>("default");
  const pendingHrefRef = useRef<string | null>(null);
  const transitionStartedAtRef = useRef(0);
  const transitionVariantRef = useRef<NavigateOptions["variant"]>("default");
  const exitTimerRef = useRef<number | null>(null);
  const enterTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const transitionSafetyTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (exitTimerRef.current) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (enterTimerRef.current) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (transitionSafetyTimerRef.current) {
      window.clearTimeout(transitionSafetyTimerRef.current);
      transitionSafetyTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    const pendingHref = pendingHrefRef.current;

    if (!pendingHref) {
      return;
    }

    if (normalizePath(pendingHref) !== pathname) {
      return;
    }

    const isConsoleEntry = transitionVariantRef.current === "console-entry";
    const elapsed = performance.now() - transitionStartedAtRef.current;
    const minimumDelay = isConsoleEntry
      ? Math.max(0, CONSOLE_ENTRY_MINIMUM_MS - elapsed)
      : 0;

    enterTimerRef.current = window.setTimeout(() => {
      setSettling(true);
      settleTimerRef.current = window.setTimeout(() => {
        if (transitionSafetyTimerRef.current) {
          window.clearTimeout(transitionSafetyTimerRef.current);
          transitionSafetyTimerRef.current = null;
        }
        setActive(false);
        setSettling(false);
        pendingHrefRef.current = null;
      }, isConsoleEntry ? CONSOLE_ENTRY_EXIT_MS : 620);
    }, minimumDelay);
  }, [pathname]);

  const navigate = useCallback(
    ({ href, label: nextLabel, variant: nextVariant = "default" }: NavigateOptions) => {
      const current = normalizePath(window.location.pathname);
      const target = normalizePath(href);
      transitionStartedAtRef.current = performance.now();
      transitionVariantRef.current = nextVariant;
      setVariant(nextVariant);

      if (current === target) {
        clearTimers();
        window.scrollTo({ top: 0, behavior: "smooth" });
        setLabel(nextLabel ?? "At overview");
        setActive(true);
        setSettling(false);
        transitionSafetyTimerRef.current = window.setTimeout(() => {
          setActive(false);
          setSettling(false);
          pendingHrefRef.current = null;
        }, CONSOLE_ENTRY_MAXIMUM_MS);
        enterTimerRef.current = window.setTimeout(() => {
          setSettling(true);
          settleTimerRef.current = window.setTimeout(() => {
            if (transitionSafetyTimerRef.current) {
              window.clearTimeout(transitionSafetyTimerRef.current);
              transitionSafetyTimerRef.current = null;
            }
            setActive(false);
            setSettling(false);
            enterTimerRef.current = null;
          }, 620);
        }, 620);
        return;
      }

      clearTimers();
      setLabel(nextLabel ?? "Opening screen");
      setSettling(false);
      setActive(true);
      pendingHrefRef.current = href;
      transitionSafetyTimerRef.current = window.setTimeout(() => {
        setActive(false);
        setSettling(false);
        pendingHrefRef.current = null;
      }, CONSOLE_ENTRY_MAXIMUM_MS);

      exitTimerRef.current = window.setTimeout(() => {
        router.push(href);
      }, 360);
    },
    [clearTimers, router],
  );

  const value = useMemo<RouteTransitionContextValue>(() => ({ navigate }), [navigate]);

  return (
    <RouteTransitionContext.Provider value={value}>
      {children}
      <div
        className={[
          styles.root,
          active ? styles.active : "",
          settling ? styles.settling : "",
          variant === "console-entry" ? styles.consoleEntry : "",
        ].join(" ")}
        aria-hidden={!active}
      >
        <div className={styles.veil} />
        <div className={styles.panelTop} />
        <div className={styles.panelBottom} />
        {variant === "console-entry" ? (
          <div className={styles.entryLoader} role="status" aria-live="polite">
            <div className={styles.entryAgents}>
              {ENTRY_AGENTS.map((character, index) => (
                <span key={character} style={{ "--agent-index": index } as CSSProperties}>
                  <LoadingPortrait character={character} />
                </span>
              ))}
            </div>
            <div className={styles.entryTrack} aria-hidden="true">
              <span />
            </div>
            <div className={styles.entryLabel}>{label}</div>
          </div>
        ) : (
          <div className={styles.centerMark}>
            <span className={styles.dot} />
            <span>{label}</span>
          </div>
        )}
      </div>
    </RouteTransitionContext.Provider>
  );
}

export function useRouteTransition() {
  const value = useContext(RouteTransitionContext);

  if (!value) {
    throw new Error("useRouteTransition must be used within RouteTransitionProvider");
  }

  return value;
}
