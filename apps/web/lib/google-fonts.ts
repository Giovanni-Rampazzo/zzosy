/**
 * Lista curada de Google Fonts populares pra identidade visual de marca.
 * Agrupadas por categoria. Foco em fontes versateis com mais de 1 peso.
 *
 * Pra adicionar uma fonte nova: nome exato do Google Fonts (case-sensitive).
 * O loader abaixo monta a URL automaticamente.
 */

export interface FontOption {
  name: string
  category: "sans" | "serif" | "display" | "mono" | "handwriting"
}

export const GOOGLE_FONTS: FontOption[] = [
  // Sans-serif (mais usadas em UI e branding moderno)
  { name: "Inter", category: "sans" },
  { name: "Roboto", category: "sans" },
  { name: "Open Sans", category: "sans" },
  { name: "Lato", category: "sans" },
  { name: "Montserrat", category: "sans" },
  { name: "Poppins", category: "sans" },
  { name: "Nunito", category: "sans" },
  { name: "Raleway", category: "sans" },
  { name: "Work Sans", category: "sans" },
  { name: "Manrope", category: "sans" },
  { name: "DM Sans", category: "sans" },
  { name: "Plus Jakarta Sans", category: "sans" },
  { name: "Outfit", category: "sans" },
  { name: "Figtree", category: "sans" },
  { name: "Karla", category: "sans" },
  { name: "Mulish", category: "sans" },
  { name: "Public Sans", category: "sans" },
  { name: "Source Sans 3", category: "sans" },
  { name: "Exo 2", category: "sans" },

  // Serif (mais formais, editoriais)
  { name: "Playfair Display", category: "serif" },
  { name: "Merriweather", category: "serif" },
  { name: "Lora", category: "serif" },
  { name: "EB Garamond", category: "serif" },
  { name: "Cormorant Garamond", category: "serif" },
  { name: "Crimson Pro", category: "serif" },
  { name: "Spectral", category: "serif" },
  { name: "Libre Baskerville", category: "serif" },
  { name: "Source Serif 4", category: "serif" },

  // Display (titulos com personalidade)
  { name: "Oswald", category: "display" },
  { name: "Bebas Neue", category: "display" },
  { name: "Anton", category: "display" },
  { name: "Archivo Black", category: "display" },
  { name: "Abril Fatface", category: "display" },

  // Monospace (tech, codigo)
  { name: "JetBrains Mono", category: "mono" },
  { name: "Fira Code", category: "mono" },
  { name: "IBM Plex Mono", category: "mono" },
  { name: "Roboto Mono", category: "mono" },

  // Handwriting (assinatura, casual)
  { name: "Caveat", category: "handwriting" },
  { name: "Pacifico", category: "handwriting" },
  { name: "Dancing Script", category: "handwriting" },
  { name: "Kalam", category: "handwriting" },
]

/**
 * Carrega uma Google Font dinamicamente injetando uma tag <link> no <head>.
 * Idempotente: se a mesma fonte ja foi carregada, nao re-injeta.
 * Pesos carregados: 400 e 700 (regular e bold) — atende 99% dos casos.
 */
export function loadGoogleFont(fontName: string): void {
  if (typeof document === "undefined") return // SSR safe
  if (!fontName) return

  const id = `gfont-${fontName.replace(/\s+/g, "-")}`
  if (document.getElementById(id)) return

  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, "+")}:wght@400;700&display=swap`
  document.head.appendChild(link)
}
