"use client";

import { createContext, useCallback, useContext, useState } from "react";

/**
 * Minimal toast. The dashboard had 24 `alert()` calls and a pile of console.error-only
 * failure paths — the first blocks the page and looks like a browser popup in a demo, the
 * second is invisible. This is the shared surface for "something went wrong, here's what".
 *
 * Deliberately dependency-free and small: it renders into the (app) layout and styles from
 * the existing tokens in globals.css.
 */

type Kind = "error" | "success";
interface Toast { id: number; kind: Kind; message: string }

const ToastCtx = createContext<{
  show: (message: string, kind?: Kind) => void;
}>({ show: () => {} });

/** useToast().show("Couldn't save that", "error") */
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: Kind = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    // Errors linger — a user who looks away shouldn't miss why their save failed.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 1000,
          display: "flex", flexDirection: "column", gap: 8, maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
              lineHeight: 1.45,
              cursor: "pointer",
              color: "#fff",
              background: t.kind === "error" ? "#b3261e" : "var(--accent-deep, #3f5f52)",
              boxShadow: "0 6px 20px rgba(0,0,0,.18)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
