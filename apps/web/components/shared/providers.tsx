"use client"
import { SessionProvider } from "next-auth/react"
import { useEffect } from "react"
import { ActiveClientProvider } from "@/lib/activeClientContext"
import { DesignTokensInjector } from "@/components/shared/DesignTokensInjector"

/**
 * Listener global: Shift+ArrowUp/Down em <input type="number"> incrementa/decrementa
 * por 10x o step. Default step=1 -> Shift+arrow = +-10. Funciona em qualquer
 * input numerico do app sem cada componente precisar implementar a logica.
 *
 * Pra acionar onChange do React, usamos o setter nativo do HTMLInputElement +
 * disparamos um InputEvent bubbling (React intercepta via __reactProps).
 */
function useGlobalShiftStepBoost() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.shiftKey) return
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      const t = e.target as HTMLInputElement | null
      if (!t || t.tagName !== "INPUT" || t.type !== "number") return
      e.preventDefault()
      e.stopPropagation()
      const step = Number(t.step) || 1
      const cur = Number(t.value) || 0
      const delta = (e.key === "ArrowUp" ? 1 : -1) * step * 10
      let next = cur + delta
      const min = t.min !== "" ? Number(t.min) : undefined
      const max = t.max !== "" ? Number(t.max) : undefined
      if (min !== undefined && Number.isFinite(min)) next = Math.max(min, next)
      if (max !== undefined && Number.isFinite(max)) next = Math.min(max, next)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      setter?.call(t, String(next))
      t.dispatchEvent(new Event("input", { bubbles: true }))
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [])
}

export function Providers({ children }: { children: React.ReactNode }) {
  useGlobalShiftStepBoost()
  return (
    <SessionProvider>
      <DesignTokensInjector />
      <ActiveClientProvider>{children}</ActiveClientProvider>
    </SessionProvider>
  )
}
