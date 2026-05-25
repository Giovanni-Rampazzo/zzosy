/**
 * Design tokens editaveis ao vivo. As chaves casam com as vars CSS no
 * globals.css (`--zz-xxx`). Editor em `/design-tokens` mexe nesses valores,
 * persiste em localStorage e injeta no documentElement — qualquer componente
 * que use `var(--zz-xxx)` reage imediatamente.
 */

export type TokenGroup = "Cor" | "Borda" | "Traço" | "Raio" | "Fundo" | "Semantica" | "Tipografia"

export interface TokenDef {
  key: string
  label: string
  type: "color" | "size" | "text"
  default: string
  group: TokenGroup
  hint?: string
}

export const TOKENS: TokenDef[] = [
  // Brand
  { key: "--zz-brand-primary", label: "Brand primary (amarelo)", type: "color", default: "#F5C400", group: "Cor", hint: "Cor do CTA principal, ativo, destaques" },
  { key: "--zz-brand-primary-hover", label: "Brand primary hover", type: "color", default: "#e0b000", group: "Cor" },
  // Texto
  { key: "--zz-text-primary", label: "Texto principal", type: "color", default: "#111111", group: "Cor" },
  { key: "--zz-text-secondary", label: "Texto secundario", type: "color", default: "#666666", group: "Cor" },
  { key: "--zz-text-muted", label: "Texto muted", type: "color", default: "#888888", group: "Cor" },
  // Borda
  { key: "--zz-border-strong", label: "Borda forte", type: "color", default: "#555555", group: "Borda", hint: "Usada em botoes secondary" },
  { key: "--zz-border-default", label: "Borda padrao", type: "color", default: "#E0E0E0", group: "Borda" },
  { key: "--zz-border-light", label: "Borda leve", type: "color", default: "#f0f0f0", group: "Borda" },
  // Fundo
  { key: "--zz-bg-page", label: "Fundo da pagina", type: "color", default: "#F5F5F0", group: "Fundo" },
  { key: "--zz-bg-subtle", label: "Fundo subtle (hover row)", type: "color", default: "#fafafa", group: "Fundo" },
  { key: "--zz-bg-card", label: "Fundo card", type: "color", default: "#ffffff", group: "Fundo" },
  // Raio
  { key: "--zz-radius-sm", label: "Raio pequeno", type: "size", default: "4px", group: "Raio" },
  { key: "--zz-radius-md", label: "Raio medio (botoes)", type: "size", default: "6px", group: "Raio" },
  { key: "--zz-radius-lg", label: "Raio grande (cards)", type: "size", default: "10px", group: "Raio" },
  // Traço (espessura de bordas/strokes)
  { key: "--zz-stroke-fino", label: "Traço fino", type: "size", default: "1px", group: "Traço", hint: "Bordas leves (cards, divisores)" },
  { key: "--zz-stroke-medio", label: "Traço médio (botões)", type: "size", default: "2px", group: "Traço", hint: "Padrão dos botões secondary/danger/etc" },
  { key: "--zz-stroke-forte", label: "Traço forte", type: "size", default: "3px", group: "Traço", hint: "Destaques/seleção" },
  // Semantica
  { key: "--zz-danger", label: "Danger (apagar)", type: "color", default: "#dc2626", group: "Semantica" },
  { key: "--zz-success", label: "Success (aprovar)", type: "color", default: "#15803d", group: "Semantica" },
  { key: "--zz-warning", label: "Warning (atencao)", type: "color", default: "#d97706", group: "Semantica" },
  { key: "--zz-info", label: "Info (duplicar)", type: "color", default: "#2563eb", group: "Semantica" },
  // Tipografia
  { key: "--zz-font-family", label: "Família da fonte", type: "text", default: "'DM Sans', system-ui, sans-serif", group: "Tipografia", hint: "Aplicada em todo o sistema" },
  { key: "--zz-text-xs", label: "Extra pequeno (badges, code)", type: "size", default: "10px", group: "Tipografia" },
  { key: "--zz-text-sm", label: "Pequeno (helpers, labels)", type: "size", default: "11px", group: "Tipografia" },
  { key: "--zz-text-base", label: "Base (subtitulo, captions)", type: "size", default: "12px", group: "Tipografia" },
  { key: "--zz-text-md", label: "Médio (body, listas)", type: "size", default: "13px", group: "Tipografia" },
  { key: "--zz-text-lg", label: "Grande (cards, body emphasis)", type: "size", default: "14px", group: "Tipografia" },
  { key: "--zz-text-xl", label: "Extra grande (titulo card)", type: "size", default: "16px", group: "Tipografia" },
  { key: "--zz-text-h2", label: "Subtítulo (h2)", type: "size", default: "18px", group: "Tipografia" },
  { key: "--zz-text-h1", label: "Título (h1)", type: "size", default: "22px", group: "Tipografia" },
  { key: "--zz-text-display", label: "Display (hero)", type: "size", default: "28px", group: "Tipografia" },
]

const STORAGE_KEY = "zzosy.designTokens.v1"

export function loadTokens(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveTokens(values: Record<string, string>): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)) } catch {}
}

export function applyTokens(values: Record<string, string>): void {
  if (typeof window === "undefined") return
  const root = document.documentElement
  for (const t of TOKENS) {
    const v = values[t.key]
    if (v) root.style.setProperty(t.key, v)
    else root.style.removeProperty(t.key)
  }
}

export function resetTokens(): void {
  if (typeof window === "undefined") return
  saveTokens({})
  applyTokens({})
  // Dispara evento pra editor re-render
  window.dispatchEvent(new Event("zzosy:designTokens:reset"))
}

export function setToken(key: string, value: string): void {
  const cur = loadTokens()
  cur[key] = value
  saveTokens(cur)
  applyTokens(cur)
}
