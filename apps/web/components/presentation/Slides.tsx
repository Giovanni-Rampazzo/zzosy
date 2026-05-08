"use client"
/**
 * Componentes de slide da apresentacao da campanha.
 *
 * Cada slide tem aspect-ratio 16:9 e e renderizado como um card responsivo.
 * O layout HTML aqui espelha exatamente o PPTX gerado em lib/generatePresentation.ts —
 * o usuario ve aqui o que vai ser exportado.
 *
 * Posicionamento usa % do container pra escalar bem em qualquer largura.
 * Cada slide tem border-radius 12 e sombra discreta pra ficar elegante.
 */
import React from "react"

// Cores (mesmas do PPTX)
const YELLOW = "#F5C400"
const YELLOW_LIGHT = "#F4B942"
const BG_LIGHT = "#F8F8F8"
const TEXT_DARK = "#111111"
const TEXT_GRAY = "#888888"
const RADIUS = 12

const slideShellBase: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: RADIUS,
  overflow: "hidden",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  border: "1px solid #E5E5E5",
}

const footerStyle: React.CSSProperties = {
  position: "absolute",
  bottom: "2.2%",
  left: 0,
  right: 0,
  textAlign: "center",
  fontSize: "1.1cqw", // container query — escala com o card
  color: TEXT_GRAY,
  fontFamily: "system-ui, -apple-system, sans-serif",
}

function Footer() {
  return <div style={footerStyle}>Classificação da informação: Uso Interno</div>
}

/* ============== Slide 1 — Capa ============== */
export function SlideCover() {
  return (
    <div style={{ ...slideShellBase, background: BG_LIGHT, containerType: "inline-size" }}>
      {/* SUNO logo no topo direito */}
      <img
        src="/presentation/suno.png"
        alt="SUNO"
        style={{
          position: "absolute", top: "8%", right: "5%",
          height: "8cqw", width: "auto",
          display: "block",
        }}
      />
      {/* UNITED CREATORS gigante embaixo */}
      <img
        src="/presentation/united-creators.png"
        alt="UNITED CREATORS"
        style={{
          position: "absolute", bottom: "13%", left: "5%",
          width: "90%", height: "auto",
          display: "block",
        }}
      />
      <Footer />
    </div>
  )
}

/* ============== Slide 2 — Codigo + Nome ============== */
export function SlideCode({ campaignName }: { campaignName: string }) {
  return (
    <div style={{ ...slideShellBase, background: YELLOW, containerType: "inline-size" }}>
      <div style={{
        position: "absolute", left: "5%", right: "5%",
        bottom: "8%",
        background: YELLOW_LIGHT,
        border: "1px solid rgba(255,255,255,0.6)",
        borderRadius: RADIUS,
        padding: "3% 4%",
      }}>
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "3.2cqw", fontWeight: 800, color: "#fff",
          letterSpacing: "-0.01em", lineHeight: 1.1,
        }}>
          CÓDIGO CAMPANHA
        </div>
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "2.8cqw", fontWeight: 400, color: "#fff",
          letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: "1%",
          textTransform: "uppercase",
        }}>
          {campaignName || "—"}
        </div>
      </div>
      <Footer />
    </div>
  )
}

/* ============== Slide 3 — Segmento ============== */
export function SlideSegment() {
  return (
    <div style={{ ...slideShellBase, background: YELLOW, containerType: "inline-size" }}>
      <div style={{
        position: "absolute", left: "5%", right: "5%", bottom: "8%",
        background: YELLOW_LIGHT, border: "1px solid rgba(255,255,255,0.6)",
        borderRadius: RADIUS, padding: "2.5% 4%",
      }}>
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "3.2cqw", fontWeight: 700, fontStyle: "italic",
          color: "#fff", letterSpacing: "-0.01em",
        }}>
          SEGMENTO DA CAMPANHA
        </div>
      </div>
      <Footer />
    </div>
  )
}

/* ============== Slide N — Peca ============== */
interface PieceSlideProps {
  name: string
  width: number
  height: number
  imageUrl: string | null
  onClick?: () => void
}

export function SlidePiece({ name, width, height, imageUrl, onClick }: PieceSlideProps) {
  const dims = (width && height) ? `${width} x ${height} px` : "—"
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.() } }) : undefined}
      style={{
        ...slideShellBase, background: BG_LIGHT, containerType: "inline-size",
        cursor: clickable ? "pointer" : "default",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={clickable ? (e => {
        e.currentTarget.style.transform = "translateY(-2px)"
        e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,0,0,0.12)"
      }) : undefined}
      onMouseLeave={clickable ? (e => {
        e.currentTarget.style.transform = "translateY(0)"
        e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"
      }) : undefined}
      title={clickable ? "Abrir no editor" : undefined}
    >
      {/* Box amarelo nome */}
      <div style={{
        position: "absolute", top: "4%", left: "3%",
        background: YELLOW, borderRadius: RADIUS,
        padding: "0.9% 1.8%",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "1.6cqw", fontWeight: 700, color: TEXT_DARK,
        maxWidth: "60%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        zIndex: 2,
      }}>
        {name}
      </div>
      {/* Box amarelo dimensao */}
      <div style={{
        position: "absolute", top: "12.5%", left: "3%",
        background: YELLOW, borderRadius: RADIUS,
        padding: "0.6% 1.4%",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "1.2cqw", fontWeight: 500, color: TEXT_DARK,
        zIndex: 2,
      }}>
        {dims}
      </div>
      {/* Bolinha amarela top-right */}
      <div style={{
        position: "absolute", top: "5%", right: "4%",
        width: "3cqw", height: "3cqw", borderRadius: "50%",
        background: YELLOW, zIndex: 2,
      }} />
      {/* Imagem da peca centralizada vertical e horizontalmente no slide inteiro */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "8% 12%",
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{
              maxWidth: "100%", maxHeight: "100%",
              objectFit: "contain",
              borderRadius: RADIUS,
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            }}
          />
        ) : (
          <div style={{
            color: TEXT_GRAY, fontSize: "1.4cqw",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}>
            (Imagem não disponível)
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}

/* ============== Slide final — OBRIGADO ============== */
export function SlideThanks() {
  return (
    <div style={{ ...slideShellBase, background: BG_LIGHT, containerType: "inline-size" }}>
      {/* SUNO logo topo direito */}
      <img
        src="/presentation/suno.png"
        alt="SUNO"
        style={{
          position: "absolute", top: "6%", right: "5%",
          height: "5cqw", width: "auto",
          display: "block",
        }}
      />
      {/* OBRIGADO + smiley bottom-left */}
      <div style={{
        position: "absolute", left: "4%", bottom: "10%",
        display: "flex", alignItems: "center", gap: "1.5cqw",
      }}>
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "6.5cqw", fontWeight: 600, color: TEXT_DARK,
          letterSpacing: "-0.02em", lineHeight: 1,
        }}>
          OBRIGADO
        </div>
        <div style={{
          width: "5cqw", height: "5cqw", borderRadius: "50%",
          background: YELLOW,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "2.4cqw", fontWeight: 700, color: TEXT_DARK,
        }}>
          ;)
        </div>
      </div>
      <Footer />
    </div>
  )
}
