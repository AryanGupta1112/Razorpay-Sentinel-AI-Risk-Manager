"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  OPERATIONS_MODE_CHANGE_EVENT,
  OPERATIONS_MODE_COOKIE,
  OPERATIONS_MODE_STORAGE_KEY,
} from "@/lib/operations-control";

export type OperationsMode = "running" | "halted";

export type OperationsControl = {
  mode: OperationsMode;
  isHalted: boolean;
  setMode: (mode: OperationsMode) => void;
};

export const OperationsControlContext = createContext<OperationsControl | null>(null);

function storedMode(fallback: OperationsMode): OperationsMode {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(OPERATIONS_MODE_STORAGE_KEY);
  if (stored === "halted" || stored === "running") return stored;
  return fallback;
}

function persistModeCookie(mode: OperationsMode) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${OPERATIONS_MODE_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function useOperationsControl(initialMode: OperationsMode = "running"): OperationsControl {
  const [mode, setModeState] = useState<OperationsMode>(initialMode);

  useEffect(() => {
    const syncMode = () => {
      const nextMode = storedMode(initialMode);
      window.localStorage.setItem(OPERATIONS_MODE_STORAGE_KEY, nextMode);
      persistModeCookie(nextMode);
      setModeState(nextMode);
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === OPERATIONS_MODE_STORAGE_KEY) syncMode();
    };

    syncMode();
    window.addEventListener(OPERATIONS_MODE_CHANGE_EVENT, syncMode);
    window.addEventListener("storage", syncStorage);

    return () => {
      window.removeEventListener(OPERATIONS_MODE_CHANGE_EVENT, syncMode);
      window.removeEventListener("storage", syncStorage);
    };
  }, [initialMode]);

  const setMode = useCallback((nextMode: OperationsMode) => {
    window.localStorage.setItem(OPERATIONS_MODE_STORAGE_KEY, nextMode);
    persistModeCookie(nextMode);
    setModeState(nextMode);
    window.dispatchEvent(new Event(OPERATIONS_MODE_CHANGE_EVENT));
  }, []);

  return {
    mode,
    isHalted: mode === "halted",
    setMode,
  };
}

export function useOperationsStatus() {
  const control = useContext(OperationsControlContext);
  if (!control) throw new Error("Operations control is unavailable outside the console.");
  return control;
}
