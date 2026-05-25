"use client"
import { useEffect, useState } from "react"
import Link from "next/link"

/**
 * Detecta mobile/tablet pequeno + bloqueia o editor com mensagem clara.
 * Editor de canvas Fabric exige mouse + viewport amplo — Touch UX seria
 * trabalho de PROD-12 dedicado. Por enquanto: warning + redirecionar
 * pra outras pages.
 *
 * Threshold: 900px (cobre tablets pequenos em portrait). Acima disso
 * libera (laptop pequeno, tablet em landscape).
 */
export function MobileWarning() {
  const [isMobile, setIsMobile] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    function check() {
      setIsMobile(window.innerWidth < 900 || window.matchMedia("(pointer: coarse) and (max-width: 1100px)").matches)
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  if (!mounted || !isMobile) return null

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0a0a0a", color: "white",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 32, textAlign: "center",
    }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: "#F5C400", marginBottom: 16 }}>ZZOSY</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
        Editor disponível só em desktop
      </div>
      <p style={{ fontSize: 14, color: "#aaa", maxWidth: 360, lineHeight: 1.5, marginBottom: 24 }}>
        O editor de peças usa canvas + atalhos de teclado que não funcionam bem em
        celular ou tablet pequeno. Abre numa tela ≥ 900px.
      </p>
      <div style={{ display: "flex", gap: 12, flexDirection: "column", width: "100%", maxWidth: 320 }}>
        <Link href="/campaigns" style={{
          background: "#F5C400", color: "#111", padding: "12px 24px",
          borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14,
        }}>
          Ver campanhas
        </Link>
        <Link href="/dashboard" style={{
          background: "transparent", color: "white",
          border: "2px solid #555",
          padding: "12px 24px", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 14,
        }}>
          Dashboard
        </Link>
      </div>
    </div>
  )
}
