"use client"
/**
 * Aplica tokens customizados do localStorage no documentElement em TODA page
 * do ZZOSY. Sem isso, edicoes em /design-tokens nao propagariam pras outras
 * rotas. Carregado no Providers (que envolve toda a app).
 */
import { useEffect } from "react"
import { applyTokens, loadTokens } from "@/lib/designTokens"

export function DesignTokensInjector() {
  useEffect(() => {
    applyTokens(loadTokens())
  }, [])
  return null
}
