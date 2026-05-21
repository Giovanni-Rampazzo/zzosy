/**
 * Design tokens canonicos do ZZOSY. Use em vez de hex hardcoded.
 *
 * Auditoria F8.1: ~958 hex literais inline pelo app. Sao cosmetics — nao causam
 * bug — mas matam consistencia (8 tons de cinza diferentes pra mesma intencao).
 * Tokens abaixo expressam a INTENCAO (texto principal, borda sutil, hover,
 * surface de card, etc), e o valor pode evoluir num lugar so.
 *
 * Migracao gradual: novos componentes usam tokens. Refactors progressivos
 * substituem hex inline. Mass-replace via sed nao foi feito porque cada hex
 * varia 1 digito por motivo intencional em alguns lugares (ex: #444 vs #555).
 */
const theme = {
  colors: {
    // ── Brand
    yellow:    "#F5C400",  // accent default ZZOSY (substituido pelo whiteLabelAccentColor do tenant)
    green:     "#34A853",  // success/aprovado
    blue:      "#4285F4",  // info
    red:       "#dc2626",  // danger/erro/destructive

    // ── Grayscale (texto + surface). Escala consistente claro → escuro.
    white:     "#FFFFFF",
    gray50:    "#FAFAFA",  // surface very light (modal/card bg sobre fundo)
    gray100:   "#F5F5F0",  // app bg / surface card sobre branco
    gray200:   "#F0F0F0",  // surface 2 / divider strong
    gray300:   "#E5E5E5",  // border default
    gray400:   "#E0E0E0",  // border alt (slightly darker)
    gray500:   "#D0D0D0",  // border focus / decorativa
    gray600:   "#AAAAAA",  // text very muted (timestamp, hint)
    gray700:   "#888888",  // text muted (labels, breadcrumb)
    gray800:   "#666666",  // text subtle (paragraph subdued)
    gray900:   "#333333",  // text dark (body em tema dark)
    black:     "#111111",  // text principal
    inkBlack:  "#000000",  // shadow/contraste maximo

    // ── Semantic (use estes quando possivel — intencao explicita)
    background:    "#FFFFFF",
    surface:       "#F5F5F0",  // mesmo q gray100, alias mais explicito
    surfaceMuted:  "#FAFAFA",  // alias gray50
    border:        "#E0E0E0",  // alias gray400 (default border do app)
    borderSubtle:  "#F0F0F0",  // alias gray200 (dividers em listas)
    text:          "#111111",  // alias black
    textMuted:     "#888888",  // alias gray700
    textSubtle:    "#666666",  // alias gray800
    textHint:      "#AAAAAA",  // alias gray600
    primary:       "#111111",  // CTA principal (dark button)
    primaryText:   "#FFFFFF",  // texto sobre primary

    // ── Status (badge/pill backgrounds — sao tints suaves)
    successBg:  "#dcfce7", successText: "#16a34a",
    errorBg:    "#fee2e2", errorText:   "#dc2626",
    warningBg:  "#fef3c7", warningText: "#92400e",
    infoBg:     "#dbeafe", infoText:    "#1d4ed8",

    // ── Editor (tema dark exclusivo do KeyVisionEditor)
    editorBg:       "#1a1a1a",  // canvas wrapper
    editorPanel:    "#2a2a2a",  // painel lateral
    editorBorder:   "#333333",
    editorText:     "#FFFFFF",
    editorTextDim:  "#888888",

    // ── Aliases legados (mantidos pra back-compat — nao usar em codigo novo)
    error:    "#dc2626",   // → use red
    success:  "#34A853",   // → use green
    warning:  "#F5C400",   // → use yellow
  },
  typography: {
    fontDisplay: "'DM Sans', sans-serif",
    fontBody:    "'DM Sans', sans-serif",
    // Tamanhos: rem-based pra escalar com user font-size do browser.
    // sm/base/lg cobrem 90% dos usos. xs pra labels, xl+ pra titulos.
    size: {
      xs:   "0.75rem",   // 12px — labels uppercase
      sm:   "0.875rem",  // 14px — body padrao
      base: "1rem",      // 16px — body grande / CTA
      lg:   "1.125rem",  // 18px — subtitulo
      xl:   "1.25rem",   // 20px
      xl2:  "1.5rem",    // 24px — h2
      xl3:  "1.875rem",  // 30px — h1 hero
      xl4:  "2.25rem",   // 36px — hero
    },
    weight: { normal: 400, medium: 500, semibold: 600, bold: 700, black: 900 },
    leading: { tight: 1.2, normal: 1.5, relaxed: 1.6 },
  },
  spacing: {
    xs:  "4px",
    sm:  "8px",
    md:  "16px",
    lg:  "24px",
    xl:  "32px",
    xl2: "48px",
    xl3: "64px",
  },
  borderRadius: {
    sm:   "4px",  // chips, small badges
    md:   "8px",  // buttons, inputs
    lg:   "12px", // cards
    xl:   "16px", // hero cards
    full: "9999px",
  },
  shadows: {
    sm: "0 1px 3px rgba(0,0,0,0.08)",   // hover sutil
    md: "0 4px 12px rgba(0,0,0,0.08)",  // card lifted
    lg: "0 8px 24px rgba(0,0,0,0.10)",  // modal
    xl: "0 20px 60px rgba(0,0,0,0.30)", // dialog destacado
  },
  // Layout grid
  layout: {
    pageMaxWidth:    "1200px",
    contentMaxWidth: "900px",
    sidebarWidth:    "220px",
    topNavHeight:    "52px",
    cardPadding:     "24px",
  },
  // Identidade visual do logo ZZOSY (defaults pra white-label)
  logo: {
    text: "ZZOSY",
    dots: ["#F5C400", "#34A853", "#4285F4"],
  },
  // Transicoes padrao
  transitions: {
    fast:   "0.1s ease",
    base:   "0.15s ease",
    smooth: "0.25s ease",
  },
} as const

export default theme
export const { colors, typography, spacing, borderRadius, shadows, layout, transitions } = theme

// Tipos pra TS pegar typos em uso de token (ex: colors.foo errado vira erro).
export type ThemeColor = keyof typeof theme.colors
export type ThemeSpacing = keyof typeof theme.spacing
export type ThemeRadius = keyof typeof theme.borderRadius
