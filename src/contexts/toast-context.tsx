/**
 * ToastContext - Global toast notification system.
 *
 * Responsibilities:
 * - Provides addToast(message, variant) to show notifications
 * - Auto-dismisses toasts after 5 seconds
 * - Renders toast stack at the top of the screen
 */

"use client";

import { createContext, useCallback, useContext, useState } from "react";

// ============================================================================
// CONSTANTS
// ============================================================================

const TOAST_DURATION = 5000;

// ============================================================================
// TYPES
// ============================================================================

export type ToastVariant = "error" | "warning" | "success";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  addToast: (message: string, variant: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ============================================================================
// CONSTANTS (STYLES)
// ============================================================================

const VARIANT_STYLES: Record<ToastVariant, string> = {
  error: "bg-danger/20 text-danger border-danger/30",
  warning: "bg-warning/20 text-warning border-warning/30",
  success: "bg-success/20 text-success border-success/30",
};

// ============================================================================
// PROVIDER
// ============================================================================

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  /**
   * Shows a toast notification.
   * @param message - Text to display
   * @param variant - Color variant (error/warning/success)
   */
  const addToast = useCallback((message: string, variant: ToastVariant) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, variant }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  /** Dismisses a specific toast */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-[100] flex flex-col items-center gap-2 p-4 pointer-events-none">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`pointer-events-auto px-4 py-2 rounded-lg border text-sm font-medium shadow-lg ${VARIANT_STYLES[toast.variant]}`}
            >
              {toast.message}
            </button>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
