"use client"
import { useEffect, useState } from "react"
import Link from "next/link"

/**
 * Bloqueia o editor em dispositivos SEM mouse/teclado (touch primary).
 *
 * Lógica: detecta INPUT primário do device via media query `pointer: coarse`.
 *   - `coarse`: dedo (touch) → mobile/tablet → bloqueia
 *   - `fine`:   mouse/stylus → desktop ou laptop → libera
 *
 * Width da janela é IRRELEVANTE — desktop com janela estreita (split-screen,
 * sidebar do DevTools, monitor secundário em portrait) tem mouse+teclado e
 * deve funcionar. A versão anterior bloqueava por `innerWidth < 900` o que
 * gerava falso positivo em desktops.
 *
 * Tablets híbridos (iPad com Magic Keyboard, Surface) reportam `fine` quando
 * acoplados — passam pelo check corretamente.
 */
export function MobileWarning() {
  const [blocked, setBlocked] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    function check() {
      // `any-pointer: fine` = ALGUM input device é mouse/stylus, mesmo
      // que touch também esteja disponível. Hybrid devices (iPad com mouse,
      // Surface) reportam true aqui. Touch-only mobile reporta false.
      const hasFinePointer = window.matchMedia("(any-pointer: fine)").matches
      // Fallback pra browsers antigos sem matchMedia: assume desktop.
      setBlocked(!hasFinePointer)
    }
    check()
    // Re-check em events que podem mudar pointer (acoplar/desacoplar teclado)
    const mql = window.matchMedia("(any-pointer: fine)")
    mql.addEventListener?.("change", check)
    return () => mql.removeEventListener?.("change", check)
  }, [])

  if (!mounted || !blocked) return null

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#0a0a0a", color: "white",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 32, textAlign: "center",
    }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: "#F5C400", marginBottom: 16 }}>ZZOSY</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
        Editor precisa de mouse e teclado
      </div>
      <p style={{ fontSize: 14, color: "#aaa", maxWidth: 360, lineHeight: 1.5, marginBottom: 24 }}>
        O editor usa canvas + atalhos que exigem cursor preciso. Conecte um
        teclado/mouse ao dispositivo, ou abra ZZOSY num desktop/laptop.
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
