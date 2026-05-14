// ─── ZZYSY THEME ─────────────────────────────────────────────────
// Edite este arquivo para alterar o visual de todo o sistema.

const theme = {
  // ─── CORES PRINCIPAIS ───────────────────────────────────────────
  colors: {
    // Base
    background:   "#FFFFFF",
    surface:      "#F7F7F7",   // cards, inputs
    border:       "#E5E5E5",
    text:         "#111111",
    textMuted:    "#888888",

    // Marca — três pontos do logo
    yellow:       "#F5C400",
    green:        "#34A853",
    blue:         "#4285F4",

    // Ação principal (use um dos três acima ou crie um)
    primary:      "#111111",   // botões, links ativos
    primaryText:  "#FFFFFF",

    // Feedbacks
    error:        "#E53935",
    success:      "#34A853",
    warning:      "#F5C400",
  },

  // ─── TIPOGRAFIA ─────────────────────────────────────────────────
  typography: {
    // Fonte do logo / headings (bold, geométrica)
    fontDisplay:  "'DM Sans', sans-serif",
    // Fonte do corpo / UI
    fontBody:     "'DM Sans', sans-serif",

    // Tamanhos (em rem)
    size: {
      xs:   "0.75rem",   // 12px
      sm:   "0.875rem",  // 14px
      base: "1rem",      // 16px
      lg:   "1.125rem",  // 18px
      xl:   "1.25rem",   // 20px
      "2xl":"1.5rem",    // 24px
      "3xl":"1.875rem",  // 30px
      "4xl":"2.25rem",   // 36px
    },

    weight: {
      normal: 400,
      medium: 500,
      bold:   700,
      black:  900,
    },
  },

  // ─── ESPAÇAMENTO ────────────────────────────────────────────────
  spacing: {
    xs:  "4px",
    sm:  "8px",
    md:  "16px",
    lg:  "24px",
    xl:  "32px",
    "2xl": "48px",
    "3xl": "64px",
  },

  // ─── BORDAS ─────────────────────────────────────────────────────
  borderRadius: {
    sm:   "4px",
    md:   "8px",
    lg:   "12px",
    xl:   "16px",
    full: "9999px",
  },

  // ─── SOMBRAS ────────────────────────────────────────────────────
  shadows: {
    sm:  "0 1px 3px rgba(0,0,0,0.08)",
    md:  "0 4px 12px rgba(0,0,0,0.08)",
    lg:  "0 8px 24px rgba(0,0,0,0.10)",
  },

  // ─── LOGO ───────────────────────────────────────────────────────
  logo: {
    text: "ZZYSY",
    dots: ["#F5C400", "#34A853", "#4285F4"], // amarelo, verde, azul
  },
};

module.exports = theme;
