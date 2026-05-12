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
export function SlideCode({ campaignName, code }: { campaignName: string; code?: string | null }) {
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
          {code && code.trim() ? code.toUpperCase() : "CÓDIGO CAMPANHA"}
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
export function SlideSegment({ segment }: { segment?: string | null }) {
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
          {segment && segment.trim() ? segment.toUpperCase() : "SEGMENTO DA CAMPANHA"}
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
  copy?: string | null
  onClick?: () => void
  /** ID da peca pra permitir auto-save da legenda via PATCH /api/pieces/[id]. Quando omitido, legenda fica read-only. */
  pieceId?: string
  /** Callback opcional pra propagar mudanca no copy pro state pai imediatamente. */
  onCopyChange?: (next: string) => void
}

export function SlidePiece({ name, width, height, imageUrl, copy, onClick, pieceId, onCopyChange }: PieceSlideProps) {
  const dims = (width && height) ? `${width} x ${height} px` : "—"
  const clickable = !!onClick
  // copyLocal: estado interno editavel. Sincroniza com prop copy ao mudar
  // a peca (re-render externo). Auto-save com debounce.
  const [copyLocal, setCopyLocal] = React.useState(copy ?? "")
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const saveTimerRef = React.useRef<any>(null)
  React.useEffect(() => { setCopyLocal(copy ?? "") }, [copy, pieceId])

  const hasCopy = copyLocal.trim().length > 0
  const editable = !!pieceId
  // Card aparece quando: ja tem copy OU usuario clicou em '+ Legenda'
  const showCard = hasCopy || editing

  function handleCopyChange(next: string) {
    setCopyLocal(next)
    onCopyChange?.(next)
    if (!pieceId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fetch(`/api/pieces/${pieceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copy: next || null }),
        })
      } catch (e) { console.warn("[slide copy] save fail:", e) }
      finally { setSaving(false) }
    }, 600)
  }

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
      {/* Header: box amarelo com nome + dimensao em texto puro ao lado.
          Estilo referencia visual: pequeno, discreto, top-left, dimensao
          sem fundo. */}
      <div style={{
        position: "absolute", top: "4%", left: "3%",
        display: "flex", alignItems: "center", gap: "1.2cqw",
        zIndex: 2,
      }}>
        {/* Box amarelo nome */}
        <div style={{
          background: YELLOW, borderRadius: RADIUS,
          padding: "0.54% 1.4%",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "1cqw", fontWeight: 700, color: TEXT_DARK,
          maxWidth: "40cqw", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {name}
        </div>
        {/* Dimensao em texto puro (sem fundo amarelo) */}
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "0.9cqw", fontWeight: 500, color: TEXT_DARK,
        }}>
          {dims}
        </div>
      </div>
      {/* Bolinha amarela top-right */}
      <div style={{
        position: "absolute", top: "5%", right: "4%",
        width: "3cqw", height: "3cqw", borderRadius: "50%",
        background: YELLOW, zIndex: 2,
      }} />

      {/* CONTEUDO: imagem (e legenda, se houver ou se usuario adicionar) */}
      {showCard ? (
        // Layout split: peca a esquerda ~2/3, legenda a direita ~1/3
        <div style={{
          position: "absolute", inset: 0,
          display: "grid", gridTemplateColumns: "2fr 1fr",
          padding: "10% 3% 8% 3%",
          gap: "2.5%",
          alignItems: "center",
        }}>
          {/* Peca */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%",
          }}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={name}
                style={{
                  maxWidth: "100%", maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
            ) : (
              <div style={{ color: TEXT_GRAY, fontSize: "1.4cqw" }}>
                (Imagem não disponível)
              </div>
            )}
          </div>
          {/* Card legenda — header amarelo cheio em cima, corpo branco embaixo */}
          <div style={{
            background: "white",
            borderRadius: RADIUS,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            border: "1px solid rgba(0,0,0,0.05)",
            maxHeight: "100%",
            overflow: "hidden",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
          onClick={(e) => { if (editable) e.stopPropagation() }}
          >
            {/* Header amarelo cheio: 'Legenda:' */}
            <div style={{
              background: YELLOW,
              padding: "1.1cqw 1.6cqw",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "1.05cqw", fontWeight: 700,
              color: TEXT_DARK,
              fontStyle: "italic",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>Legenda:</span>
              {saving && <span style={{ fontSize: "0.85cqw", fontWeight: 500, fontStyle: "normal", opacity: 0.7 }}>salvando…</span>}
            </div>
            {/* Corpo */}
            <div style={{
              flex: 1,
              padding: "1.6cqw 1.6cqw",
              overflow: "auto",
            }}>
              {editable ? (
                <textarea
                  value={copyLocal}
                  onChange={(e) => handleCopyChange(e.target.value)}
                  placeholder="Digite a legenda da peca…"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    minHeight: "100%",
                    fontSize: "1.05cqw",
                    lineHeight: 1.5,
                    color: TEXT_DARK,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    padding: 0,
                  }}
                />
              ) : (
                <div style={{
                  fontSize: "1.05cqw",
                  lineHeight: 1.5,
                  color: TEXT_DARK,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {copyLocal}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Layout sem legenda: peca centralizada.
        // padding top maior pra nao colidir com header (nome+dim em y 4%-7%).
        // padding bottom maior pra nao colidir com Footer (bottom 2.2% + fonte 1.1cqw).
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "10% 5% 8% 5%",
        }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              style={{
                maxWidth: "100%", maxHeight: "100%",
                objectFit: "contain",
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
          {/* Botao '+ Legenda' aparece no canto inferior direito quando a peca
              tem pieceId (editavel) e ainda nao tem legenda. Clicar abre o card
              de legenda vazio pronto pra editar. */}
          {editable && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              style={{
                position: "absolute", bottom: "4%", right: "4%",
                background: YELLOW, color: TEXT_DARK,
                border: "none", borderRadius: RADIUS,
                padding: "0.6% 1.4%",
                fontSize: "1cqw", fontWeight: 700,
                cursor: "pointer",
                fontFamily: "system-ui, -apple-system, sans-serif",
                zIndex: 3,
              }}
              title="Adicionar legenda a esta peca">
              + Legenda
            </button>
          )}
        </div>
      )}
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
