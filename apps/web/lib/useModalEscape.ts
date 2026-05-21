"use client"
import { useEffect } from "react"

/**
 * Fecha o modal quando o user aperta ESC. Padroniza UX entre os varios dialogs
 * do app que antes nao tinham handler (audit F2.4: DeliveryDialog, ExportDialog,
 * DuplicateFormatDialog, NewClientModal — todos sem ESC).
 *
 * Uso: useModalEscape(open, onClose). Quando `open` muda pra true, registra
 * listener; quando false, remove.
 */
export function useModalEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])
}
