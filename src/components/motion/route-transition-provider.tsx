"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./route-transition-provider.module.css";

type NavigateOptions = {
  href: string;
  label?: string;
};

type RouteTransitionContextValue = {
  navigate: (options: NavigateOptions) => void;
};

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(null);

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
  const pendingHrefRef = useRef<string | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const enterTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

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

    setSettling(true);
    settleTimerRef.current = window.setTimeout(() => {
      setActive(false);
      setSettling(false);
      pendingHrefRef.current = null;
    }, 620);
  }, [pathname]);

  const navigate = useCallback(
    ({ href, label: nextLabel }: NavigateOptions) => {
      const current = normalizePath(window.location.pathname);
      const target = normalizePath(href);

      if (current === target) {
        clearTimers();
        window.scrollTo({ top: 0, behavior: "smooth" });
        setLabel(nextLabel ?? "At overview");
        setActive(true);
        setSettling(false);
        enterTimerRef.current = window.setTimeout(() => {
          setSettling(true);
          settleTimerRef.current = window.setTimeout(() => {
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
        className={[styles.root, active ? styles.active : "", settling ? styles.settling : ""].join(" ")}
        aria-hidden="true"
      >
        <div className={styles.veil} />
        <div className={styles.panelTop} />
        <div className={styles.panelBottom} />
        <div className={styles.centerMark}>
          <span className={styles.dot} />
          <span>{label}</span>
        </div>
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
