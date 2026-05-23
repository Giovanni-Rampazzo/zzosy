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

// Cores defaults (sobrescritas por brand props quando o tenant tem white-label)
const YELLOW = "#F5C400"
const BG_LIGHT = "#F8F8F8"
const TEXT_DARK = "#111111"
const TEXT_GRAY = "#888888"
const RADIUS = 12

export interface SlideBrand {
  primaryColor?: string  // substitui YELLOW
  logoUrl?: string       // substitui /presentation/suno.png
  secondaryLogoUrl?: string  // substitui /presentation/united-creators.png
  footerText?: string    // substitui "Classificacao..."
}

// Helper: gera cor 10% mais clara — mesma logica do PPTX (lib/generatePresentation.ts
// lightenHex) pra que preview HTML bata visualmente com o slide exportado.
// Multiplica cada canal RGB por 1.10 e clampa em 255. Cor 100% saturada (ex:
// #ff0000) fica igual porque ja esta no max; cores escuras clareiam mais.
function lightenColor(hex: string, factor = 1.10): string {
  const h = (hex ?? "").replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex
  const n = parseInt(h, 16)
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.round((n & 0xff) * factor))
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")
}

function getFooterText(brand?: SlideBrand): string {
  return (brand?.footerText?.trim()) || "Classificação da informação: Uso Interno"
}
function getPrimary(brand?: SlideBrand): string {
  return (brand?.primaryColor?.trim()) || YELLOW
}
function getLogo(brand?: SlideBrand): string {
  return (brand?.logoUrl?.trim()) || "/presentation/suno.png"
}
function getSecondaryLogo(brand?: SlideBrand): string {
  return (brand?.secondaryLogoUrl?.trim()) || "/presentation/united-creators.png"
}

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

function Footer({ brand }: { brand?: SlideBrand }) {
  return <div style={footerStyle}>{getFooterText(brand)}</div>
}

/* ============== Slide 1 — Capa ==============
 * Layout: logo PRINCIPAL pequeno no canto superior direito + logo GRANDE
 * horizontal embaixo (largura 90% do slide).
 *
 * IMPORTANTE: a CAPA sempre usa os defaults Suno + UNITED CREATORS,
 * ignorando o brand custom do tenant. User definiu 2026-05-22: "ela
 * precisa ser aquela da suno, united creator, que e o padrao".
 * Slides internos continuam respeitando o brand custom (cor primary,
 * footer, logos nos slides de codigo/segmento/etc).
 */
export function SlideCover({ brand }: { brand?: SlideBrand } = {}) {
  return (
    <div style={{ ...slideShellBase, background: BG_LIGHT, containerType: "inline-size" }}>
      {/* Logo principal — topo direito (sempre Suno, default) */}
      <img
        src="/presentation/suno.png"
        alt="Suno"
        style={{
          position: "absolute", top: "8%", right: "5%",
          height: "8cqw", width: "auto",
          display: "block",
        }}
      />
      {/* Logo grande horizontal embaixo (sempre United Creators, default) */}
      <img
        src="/presentation/united-creators.png"
        alt="United Creators"
        style={{
          position: "absolute", bottom: "13%", left: "5%",
          width: "90%", height: "auto",
          display: "block",
        }}
      />
      <Footer brand={brand} />
    </div>
  )
}

/* ============== Slide 2 — Codigo + Nome ==============
 * Quando campaignId eh passado, codigo e nome viram inputs inline editaveis
 * com auto-save (PATCH /api/campaigns/[id]). Estilo identico ao texto puro —
 * o user clica e edita direto no slide.
 */
export function SlideCode({ campaignName, code, brand, campaignId, onCampaignChange }: {
  campaignName: string
  code?: string | null
  brand?: SlideBrand
  campaignId?: string
  onCampaignChange?: (next: { name?: string; code?: string }) => void
}) {
  const primary = getPrimary(brand)
  const [nameLocal, setNameLocal] = React.useState(campaignName ?? "")
  const [codeLocal, setCodeLocal] = React.useState(code ?? "")
  const [saving, setSaving] = React.useState(false)
  const saveTimerRef = React.useRef<any>(null)
  // Sincroniza estado local quando a prop muda (ex: refetch externo)
  React.useEffect(() => { setNameLocal(campaignName ?? "") }, [campaignName, campaignId])
  React.useEffect(() => { setCodeLocal(code ?? "") }, [code, campaignId])

  const editable = !!campaignId

  function patch(field: "name" | "code", val: string) {
    if (!campaignId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        const body: any = {}
        body[field] = val.trim() || null
        await fetch(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        onCampaignChange?.({ [field]: val.trim() || undefined })
      } catch (e) { console.warn("[SlideCode save]", e) }
      finally { setSaving(false) }
    }, 600)
  }

  // Estilo base compartilhado entre input editavel e visualizacao read-only.
  // Sem padding/border/background pra input parecer texto puro. uppercase via
  // CSS pra exibir/digitar caixa baixa mas mostrar caixa alta.
  const inputBase: React.CSSProperties = {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    background: "transparent",
    border: "none",
    outline: "none",
    padding: 0,
    margin: 0,
    width: "100%",
    textTransform: "uppercase" as const,
    boxSizing: "border-box" as const,
  }

  return (
    <div style={{ ...slideShellBase, background: primary, containerType: "inline-size" }}>
      <div style={{
        position: "absolute", left: "5%", right: "5%",
        bottom: "8%",
        // F9: usa o MESMO amarelo do slide (sem lightenColor/brightness) pra
        // manter consistencia visual do amarelo da marca em todas as superficies.
        background: primary,
        border: "1px solid rgba(255,255,255,0.6)",
        borderRadius: RADIUS,
        padding: "3% 4%",
      }}>
        {editable ? (
          <input
            value={codeLocal}
            onChange={(e) => { setCodeLocal(e.target.value); patch("code", e.target.value) }}
            placeholder="CÓDIGO CAMPANHA"
            style={{
              ...inputBase,
              fontSize: "3.2cqw", fontWeight: 800,
            }}
            title="Clique pra editar o código da campanha"
          />
        ) : (
          <div style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: "3.2cqw", fontWeight: 800, color: "#fff",
            letterSpacing: "-0.01em", lineHeight: 1.1,
          }}>
            {code && code.trim() ? code.toUpperCase() : "CÓDIGO CAMPANHA"}
          </div>
        )}
        {editable ? (
          <input
            value={nameLocal}
            onChange={(e) => { setNameLocal(e.target.value); patch("name", e.target.value) }}
            placeholder="—"
            style={{
              ...inputBase,
              fontSize: "2.8cqw", fontWeight: 400,
              marginTop: "1%",
            }}
            title="Clique pra editar o nome da campanha"
          />
        ) : (
          <div style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: "2.8cqw", fontWeight: 400, color: "#fff",
            letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: "1%",
            textTransform: "uppercase",
          }}>
            {campaignName || "—"}
          </div>
        )}
        {saving && (
          <div style={{
            position: "absolute", top: "0.6cqw", right: "1cqw",
            fontSize: "0.9cqw", color: "rgba(255,255,255,0.7)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}>salvando…</div>
        )}
      </div>
      <Footer brand={brand} />
    </div>
  )
}

/* ============== Slide 3 — Segmento ============== */
export function SlideSegment({ segment, brand }: { segment?: string | null; brand?: SlideBrand }) {
  const primary = getPrimary(brand)
  return (
    <div style={{ ...slideShellBase, background: primary, containerType: "inline-size" }}>
      <div style={{
        position: "absolute", left: "5%", right: "5%", bottom: "8%",
        background: primary, border: "1px solid rgba(255,255,255,0.6)",
        borderRadius: RADIUS, padding: "2.5% 4%",
      }}>
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "3.2cqw", fontWeight: 700,
          color: "#fff", letterSpacing: "-0.01em",
        }}>
          {segment && segment.trim() ? segment.toUpperCase() : "SEGMENTO DA CAMPANHA"}
        </div>
      </div>
      <Footer brand={brand} />
    </div>
  )
}

/* ============== Slide N — Peca ============== */
interface PieceSlideProps {
  name: string
  width: number
  height: number
  /** Valor na unidade original (cm, mm, etc). Se nao passado, mostra width/height em px. */
  widthValue?: number | null
  heightValue?: number | null
  widthUnit?: string | null
  heightUnit?: string | null
  imageUrl: string | null
  /** Se a peca tem multiplos steps (carrossel etc), passa as miniaturas/imagens de cada um.
   * Quando steps tem length >= 2, renderiza todos lado a lado escalados pra caber. */
  steps?: Array<{ imageUrl?: string | null; thumbnailUrl?: string | null; index?: number }> | null
  copy?: string | null
  onClick?: () => void
  /** Callback quando user clica num step especifico em pecas multi-step.
   * Recebe o indice 0-based do step. Quando nao passado, fallback pra onClick. */
  onStepClick?: (index: number) => void
  /** ID da peca pra permitir auto-save da legenda via PATCH /api/pieces/[id]. Quando omitido, legenda fica read-only. */
  pieceId?: string
  /** Callback opcional pra propagar mudanca no copy pro state pai imediatamente. */
  onCopyChange?: (next: string) => void
  /** Se true, NAO renderiza o card de legenda (usado quando a peca foi
   * dividida em multiplos slides — so o ULTIMO chunk mostra a legenda). */
  hideCard?: boolean
  /** Brand do tenant (cor primaria, footer text). Quando omitido, usa defaults. */
  brand?: SlideBrand
}

// Formata "100 x 50 cm" / "1920 x 1080 px" etc. Quando largura e altura
// estao em unidades diferentes (raro mas possivel), mostra cada uma com
// sua unidade: "100 cm x 50 mm".
function formatDims(
  width: number, height: number,
  widthValue?: number | null, heightValue?: number | null,
  widthUnit?: string | null, heightUnit?: string | null,
): string {
  if (!width || !height) return "—"
  const wV = (widthValue != null && widthValue > 0) ? widthValue : width
  const hV = (heightValue != null && heightValue > 0) ? heightValue : height
  const wU = widthUnit || "px"
  const hU = heightUnit || "px"
  // Formata numero: integer se .0, senao 1 casa decimal
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString()
  if (wU === hU) return `${fmt(wV)} x ${fmt(hV)} ${wU}`
  return `${fmt(wV)} ${wU} x ${fmt(hV)} ${hU}`
}

export function SlidePiece({ name, width, height, widthValue, heightValue, widthUnit, heightUnit, imageUrl, steps, copy, onClick, onStepClick, pieceId, onCopyChange, hideCard, brand }: PieceSlideProps) {
  const primary = getPrimary(brand)
  const dims = formatDims(width, height, widthValue, heightValue, widthUnit, heightUnit)
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
  // Card aparece quando: ja tem copy OU usuario clicou em '+ Legenda',
  // EXCETO em chunks intermediarios de peca multi-slide (hideCard=true).
  const showCard = !hideCard && (hasCopy || editing)
  // Multi-step: se tem qualquer step com imageUrl, renderiza o(s) step(s) lado
  // a lado com label "Step N". Mesmo com 1 step (ex: chunk final de peca
  // dividida em multiplos slides), o label eh importante pra contexto.
  const hasMultiStep = Array.isArray(steps) && steps.length >= 1
  // Wrapper que decide entre renderizar a imagem unica ou o grid de steps.
  // Recebe boxShadow opcional pra layout sem legenda.
  function renderPieceVisual(opts?: { withShadow?: boolean }) {
    if (hasMultiStep) {
      const total = steps!.length
      // Layout unificado: flex centralizado pra todos os casos.
      // Cada peca tem width:auto (segue a propria proporcao) com maxWidth
      // limitada por total. Gap ajustado pelo numero de pecas.
      // Isso garante centralizacao horizontal perfeita independente do
      // numero de steps — sem espaco vazio assimetrico nas extremidades.
      const containerStyle: React.CSSProperties = {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: total === 2 ? "4%" : total === 3 ? "2.5%" : "1.8%",
        width: "100%", height: "100%",
      }
      return (
        <div style={containerStyle}>
          {steps!.map((s, i) => {
            // A URL ja vem versionada do API (?v=updatedAt). Sem cache-bust
            // adicional aqui pra evitar re-fetch desnecessario a cada render.
            const src = s.imageUrl ?? s.thumbnailUrl ?? null
            const stepIndex = s.index ?? i
            const stepClickable = !!onStepClick
            return (
              <div key={i}
                onClick={stepClickable ? (e) => {
                  // Stop propagation pra nao disparar o onClick do slide inteiro
                  // (que abria o editor sem o stepIndex). Aqui passamos o index
                  // exato do step clicado.
                  e.stopPropagation()
                  onStepClick!(stepIndex)
                } : undefined}
                style={{
                  // Container do step: inline-flex pra ter width baseada em
                  // conteudo. Empilha label + imagem verticalmente.
                  display: "inline-flex", flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  height: "100%",
                  // maxWidth limita pra cada peca caber na sua 'fatia'.
                  maxWidth: `calc(${100 / total}% - ${total > 1 ? "2%" : "0%"})`,
                  minHeight: 0, minWidth: 0,
                  cursor: stepClickable ? "pointer" : undefined,
                }}>
                {/* Label do step — alinhado a esquerda, colado na peca */}
                <div style={{
                  fontSize: "0.75cqw", fontWeight: 700,
                  color: TEXT_DARK, opacity: 0.6,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  textTransform: "uppercase", letterSpacing: 0.5,
                  marginBottom: "0.4cqw",
                }}>
                  Step {(s.index ?? i) + 1}
                </div>
                {/* Imagem com altura calculada (deixa espaco pro label).
                    width:auto deriva pela aspect ratio. */}
                {src ? (
                  <img src={src} alt={`${name} Step ${(s.index ?? i) + 1}`}
                    style={{
                      // Altura: max ate caber no container (descontando label+gap).
                      // Width: auto pra preservar aspect ratio.
                      maxWidth: "100%",
                      maxHeight: "calc(100% - 2.5cqw)", // 2.5cqw reserva pro label
                      width: "auto", height: "auto",
                      objectFit: "contain",
                      display: "block",
                      border: "1px solid rgba(0,0,0,0.15)",
                      boxShadow: opts?.withShadow ? "0 2px 12px rgba(0,0,0,0.06)" : undefined,
                    }} />
                ) : (
                  <div style={{ color: TEXT_GRAY, fontSize: "0.9cqw" }}>(sem preview)</div>
                )}
              </div>
            )
          })}
        </div>
      )
    }
    // Single step (peca normal/legada)
    return imageUrl ? (
      <img src={imageUrl} alt={name}
        // dataset.zzosyPieceImg=true marca esta img como "a area clicavel real
        // da peca". O wrapper externo escuta click por delegacao e so dispara
        // onClick se o alvo for esta img (nao o espaco vazio em volta).
        data-zzosy-piece-img="true"
        style={{
          maxWidth: "100%", maxHeight: "100%",
          objectFit: "contain",
          // Stroke sutil 1px pra delimitar a peca dentro do slide branco
          // (especialmente importante quando o BG da peca eh claro/branco).
          border: "1px solid rgba(0,0,0,0.15)",
          boxShadow: opts?.withShadow ? "0 2px 12px rgba(0,0,0,0.06)" : undefined,
          cursor: clickable ? "pointer" : undefined,
        }} />
    ) : (
      <div style={{ color: TEXT_GRAY, fontSize: "1.4cqw" }}>(Imagem não disponível)</div>
    )
  }

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

  // Click handler aplicado SO na area da peca (nao no slide inteiro). Usuario
  // pediu: clicar fora da peca (header amarelo, area de legenda, espaco vazio
  // ao redor da imagem dentro do container) NAO abre o editor.
  //
  // Implementacao: delegacao no wrapper — escuta click mas so dispara onClick
  // se o target.closest tiver [data-zzosy-piece-img], ou se for um step (que
  // tem seu proprio handler). Sem essa filtragem, clicar no espaco vazio em
  // volta da img (objectFit:contain deixa bordas vazias) tambem abriria o
  // editor, contrariando a expectativa do usuario.
  const pieceWrapperClick = (e: React.MouseEvent) => {
    if (!clickable || !onClick) return
    const target = e.target as HTMLElement | null
    // Step grid: cada step ja tem seu proprio onClick (com stopPropagation).
    // Se o evento chegou aqui, foi no espaco entre/fora dos steps — ignora.
    if (hasMultiStep) return
    // Single piece: so dispara se o click foi NA img (ou um filho dela).
    if (target?.closest?.('[data-zzosy-piece-img="true"]')) {
      onClick()
    }
    // Caso contrario (clicou no padding/espaco vazio do wrapper): ignora.
  }
  const pieceClickProps = clickable ? {
    onClick: pieceWrapperClick,
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.() } },
    title: "Clique na peça para abrir no editor",
    style: { cursor: "default" as const },
  } : {}

  return (
    <div
      style={{
        ...slideShellBase, background: BG_LIGHT, containerType: "inline-size",
      }}
    >
      {/* Header: box amarelo com nome + dimensao em texto puro ao lado.
          Estilo referencia visual: pequeno, discreto, top-left, dimensao
          sem fundo. */}
      <div style={{
        position: "absolute", top: "4%", left: "3%",
        display: "flex", alignItems: "center", gap: "1.5cqw",
        zIndex: 2,
        maxWidth: "70cqw",
      }}>
        {/* Box amarelo nome — expande conforme o texto, com padding lateral confortavel */}
        <div style={{
          background: primary, borderRadius: RADIUS,
          padding: "0.6cqw 1.7cqw",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "clamp(11px, 1.25cqw, 16px)", fontWeight: 700, color: TEXT_DARK,
          whiteSpace: "nowrap",
        }}>
          {name}
        </div>
        {/* Dimensao em texto puro (sem fundo amarelo) */}
        <div style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "clamp(11px, 1.25cqw, 16px)", fontWeight: 500, color: TEXT_DARK,
          whiteSpace: "nowrap",
        }}>
          {dims}
        </div>
      </div>
      {/* Bolinha amarela top-right */}
      <div style={{
        position: "absolute", top: "5%", right: "4%",
        width: "3cqw", height: "3cqw", borderRadius: "50%",
        background: primary, zIndex: 2,
      }} />

      {/* CONTEUDO: imagem (e legenda, se houver ou se usuario adicionar) */}
      {showCard ? (
        // Layout split: peca a esquerda ~2/3, legenda a direita ~1/3.
        // alignItems center: legenda SEMPRE centralizada verticalmente no
        // slide, independente do tamanho do texto (UX consistente).
        <div style={{
          position: "absolute", inset: 0,
          display: "grid", gridTemplateColumns: "2fr 1fr",
          padding: "10% 3% 8% 3%",
          gap: "2.5%",
          alignItems: "center",
        }}>
          {/* Peca — area clickable (resto do slide nao abre o editor) */}
          <div
            {...pieceClickProps}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", minHeight: 0,
              ...(pieceClickProps.style ?? {}),
            }}
          >
            {renderPieceVisual()}
          </div>
          {/* Card legenda — header amarelo em cima, corpo branco embaixo.
              Altura segue o conteudo: card pequeno pra legenda curta,
              cresce quando o texto eh longo (limite: 100% do slide). */}
          <div style={{
            background: "white",
            borderRadius: RADIUS,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            border: "1px solid rgba(0,0,0,0.05)",
            display: "flex", flexDirection: "column",
            position: "relative",
            maxHeight: "100%",
            overflow: "hidden",
          }}
          onClick={(e) => { if (editable) e.stopPropagation() }}
          >
            {/* Header amarelo cheio: 'Legenda:' */}
            <div style={{
              background: primary,
              padding: "1.1cqw 1.6cqw",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "1.05cqw", fontWeight: 700,
              color: TEXT_DARK,
              fontStyle: "italic",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              flexShrink: 0,
            }}>
              <span>Legenda:</span>
              {saving && <span style={{ fontSize: "0.85cqw", fontWeight: 500, fontStyle: "normal", opacity: 0.7 }}>salvando…</span>}
            </div>
            {/* Corpo — padding sutil (vertical menor que lateral pra respiro proporcional).
                NÃO usa flex:1 pra que o card encolha quando o texto for curto. */}
            <div style={{
              padding: "1.1cqw 1.6cqw",
              minHeight: 0,
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
                    fontSize: "1.05cqw",
                    lineHeight: 1.5,
                    color: TEXT_DARK,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    padding: 0,
                    minHeight: "1.05cqw",
                    // Auto-resize via field-sizing-content (Chrome 123+). Cresce ate
                    // a altura disponivel; fallback nativo do textarea pra outros.
                    fieldSizing: "content" as any,
                  }}
                />
              ) : (
                <div style={{
                  width: "100%",
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
        // Layout sem legenda: área da peça definida ABSOLUTAMENTE no slide
        // com inset top/bottom/left/right — mais previsível que padding+flex
        // (max-% no wrapper interno não funciona bem com flex intrinsic
        // size do <img>). Top 18% pro header amarelo + bolinha. Bottom 18%
        // pro Footer + respiro. Sides 18% pra peças verticais não colarem
        // nas bordas. Área útil ~64% × 64% do slide.
        <>
          <div style={{
            position: "absolute",
            top: "18%", bottom: "18%", left: "18%", right: "18%",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div
              {...pieceClickProps}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "100%", height: "100%",
                ...(pieceClickProps.style ?? {}),
              }}
            >
              {renderPieceVisual({ withShadow: true })}
            </div>
          </div>
          {/* Botão '+ Legenda' relativo ao SLIDE inteiro (não ao container
              da peça) pra ficar no canto inferior direito visível, fora da
              area restrita da peça. */}
          {editable && !hideCard && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              style={{
                position: "absolute", bottom: "4%", right: "4%",
                background: primary, color: TEXT_DARK,
                border: "none", borderRadius: RADIUS,
                padding: "0.7cqw 1.7cqw",
                fontSize: "clamp(11px, 1.25cqw, 16px)", fontWeight: 700,
                cursor: "pointer",
                fontFamily: "system-ui, -apple-system, sans-serif",
                zIndex: 3,
              }}
              title="Adicionar legenda a esta peca">
              + Legenda
            </button>
          )}
        </>
      )}
      <Footer brand={brand} />
    </div>
  )
}

/* ============== Slide final — OBRIGADO ============== */
export function SlideThanks({ brand }: { brand?: SlideBrand } = {}) {
  const primary = getPrimary(brand)
  return (
    <div style={{ ...slideShellBase, background: BG_LIGHT, containerType: "inline-size" }}>
      {/* Logo topo direito */}
      <img
        src={getLogo(brand)}
        alt="Logo"
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
          background: primary,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "2.4cqw", fontWeight: 700, color: TEXT_DARK,
        }}>
          ;)
        </div>
      </div>
      <Footer brand={brand} />
    </div>
  )
}
