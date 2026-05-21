"use client"
import { useEffect, useState } from "react"

export interface Brand {
  brandName?: string | null
  brandLogoUrl?: string | null
  brandSecondaryLogoUrl?: string | null
  whiteLabelAccentColor?: string | null
  brandFooterText?: string | null
}

/** Defaults usados quando o tenant nao customizou o branding. */
export const BRAND_DEFAULTS = {
  name: "ZZOSY",
  primaryColor: "#F5C400",
  footerText: "Classificação da informação: Uso Interno",
  // logos: paths estaticos servidos de /public/presentation
  logoUrl: "/presentation/suno.png",
  secondaryLogoUrl: "/presentation/united-creators.png",
}

/**
 * Resolve o brand do tenant atual com fallback nos defaults.
 * Retorna sempre valores nao-null prontos pra uso direto.
 * Re-fetch automatico quando 'zzosy:brand-updated' eh disparado (pra refletir
 * mudancas no /account sem reload).
 */
export function useBrand() {
  const [raw, setRaw] = useState<Brand>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetch("/api/account/brand", { cache: "no-store" })
        .then(r => r.ok ? r.json() : {})
        .then(d => { if (!cancelled) { setRaw(d ?? {}); setLoaded(true) } })
        .catch(() => { if (!cancelled) setLoaded(true) })
    }
    load()
    function onUpdate() { load() }
    window.addEventListener("zzosy:brand-updated", onUpdate)
    return () => { cancelled = true; window.removeEventListener("zzosy:brand-updated", onUpdate) }
  }, [])

  return {
    loaded,
    raw,
    name: (raw.brandName?.trim() || BRAND_DEFAULTS.name),
    primaryColor: (raw.whiteLabelAccentColor?.trim() || BRAND_DEFAULTS.primaryColor),
    footerText: (raw.brandFooterText?.trim() || BRAND_DEFAULTS.footerText),
    logoUrl: (raw.brandLogoUrl?.trim() || BRAND_DEFAULTS.logoUrl),
    secondaryLogoUrl: (raw.brandSecondaryLogoUrl?.trim() || BRAND_DEFAULTS.secondaryLogoUrl),
    // Indica se o tenant usa logos custom (pra ajustar dimensoes na capa se necessario)
    hasCustomLogo: !!raw.brandLogoUrl?.trim(),
    hasCustomSecondaryLogo: !!raw.brandSecondaryLogoUrl?.trim(),
  }
}
