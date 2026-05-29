/**
 * ZzosyIcon — set oficial de icones do ZZOSY (5 icones em 2026-05-29):
 *   acessar     #ff8500  losango com furo (CTA principal, substitui label "Entrar")
 *   adicionar   #1a4     cruz arredondada (substitui label "+ Adicionar"/"+ Gerar")
 *   apagar      #c61c2c  X arredondado (substitui label "Apagar")
 *   duplicar    #5f20c4  dois circulos sobrepostos (substitui label "Duplicar")
 *   informacao  #1c7fea  pilula vertical (info/details popup)
 *
 * SVGs ficam em /public/zzosy-icons/{name}.svg — sao tambem inlinados aqui
 * via path embutido pra evitar request HTTP + permitir colorir.
 *
 * Atencao: CLAUDE.md 3.3 PROIBE emojis e icones aleatorios na UI ZZOSY.
 * Esses 5 sao EXCECAO oficial — parte da identidade visual. NAO substituir
 * por unicode (✕, ＋, ＠ etc) nem outros sets de icones (Lucide, Feather,
 * Material) — quebra a brand consistency.
 */
import React from "react"

export type ZzosyIconName = "acessar" | "adicionar" | "apagar" | "duplicar" | "informacao"

interface IconDef {
  viewBox: string
  fill: string
  path: string
}

const ICONS: Record<ZzosyIconName, IconDef> = {
  acessar: {
    viewBox: "0 0 66.29 66.29",
    fill: "#ff8500",
    path: "m4.67,28.47c-2.57,2.57-2.57,6.78,0,9.35l23.8,23.8c2.57,2.57,6.78,2.57,9.35,0l23.8-23.8c2.57-2.57,2.57-6.78,0-9.35L37.82,4.67c-2.57-2.57-6.78-2.57-9.35,0L4.67,28.47Zm35.18,0c2.57,2.57,2.57,6.78,0,9.35l-2.02,2.02c-2.57,2.57-6.78,2.57-9.35,0l-2.04-2.04c-2.57-2.57-2.57-6.78,0-9.35l2.02-2.02c2.57-2.57,6.78-2.57,9.35,0l2.04,2.04Z",
  },
  adicionar: {
    viewBox: "0 0 60.8 60.8",
    fill: "#1a4",
    path: "m60.8,28.42c0-3.63-2.97-6.61-6.61-6.61h-8.59c-3.63,0-6.61-2.97-6.61-6.61V6.61c0-3.63-2.97-6.61-6.61-6.61h-3.96c-3.63,0-6.61,2.97-6.61,6.61v8.59c0,3.63-2.97,6.61-6.61,6.61H6.61c-3.63,0-6.61,2.97-6.61,6.61v3.96c0,3.63,2.97,6.61,6.61,6.61h8.59c3.63,0,6.61,2.97,6.61,6.61v8.59c0,3.63,2.97,6.61,6.61,6.61h3.96c3.63,0,6.61-2.97,6.61-6.61v-8.59c0-3.63,2.97-6.61,6.61-6.61h8.59c3.63,0,6.61-2.97,6.61-6.61v-3.96Z",
  },
  apagar: {
    viewBox: "0 0 53.42 53.42",
    fill: "#c61c2c",
    path: "m51.34,48.33c2.77-2.77,2.77-7.29,0-10.06l-6.54-6.54c-2.77-2.77-2.77-7.29,0-10.06l6.54-6.54c2.77-2.77,2.77-7.29,0-10.06l-3.02-3.02c-2.77-2.77-7.29-2.77-10.06,0l-6.54,6.54c-2.77,2.77-7.29,2.77-10.06,0l-6.54-6.54c-2.77-2.77-7.29-2.77-10.06,0l-3.02,3.02c-2.77,2.77-2.77,7.29,0,10.06l6.54,6.54c2.77,2.77,2.77,7.29,0,10.06l-6.54,6.54c-2.77,2.77-2.77,7.29,0,10.06l3.02,3.02c2.77,2.77,7.29,2.77,10.06,0l6.54-6.54c2.77-2.77,7.29-2.77,10.06,0l6.54,6.54c2.77,2.77,7.29,2.77,10.06,0l3.02-3.02Z",
  },
  duplicar: {
    viewBox: "0 0 60.8 58.19",
    fill: "#5f20c4",
    path: "m42.87.04c-10.52-.64-19.57,7.37-20.21,17.89-.05.83-.03,1.65.03,2.46-.8-.15-1.61-.27-2.44-.32C9.73,19.42.68,27.43.04,37.95c-.64,10.52,7.37,19.57,17.89,20.21,10.52.64,19.57-7.37,20.21-17.89.05-.83.03-1.65-.03-2.46.8.15,1.61.27,2.44.33,10.52.64,19.57-7.37,20.21-17.89C61.4,9.73,53.39.68,42.87.04Zm-17.1,39.48c-.23,3.7-3.41,6.51-7.1,6.28-3.7-.23-6.51-3.41-6.28-7.1.23-3.7,3.4-6.51,7.1-6.28,3.7.23,6.51,3.4,6.28,7.1Zm22.63-20.02c-.23,3.7-3.41,6.51-7.1,6.28-3.7-.23-6.51-3.41-6.28-7.1.23-3.7,3.4-6.51,7.1-6.28,3.7.23,6.51,3.4,6.28,7.1Z",
  },
  informacao: {
    viewBox: "0 0 17.18 60.8",
    fill: "#1c7fea",
    // Single rect — formato pilula vertical (info badge).
    path: "M6.61 0 H10.57 A6.61 6.61 0 0 1 17.18 6.61 V54.19 A6.61 6.61 0 0 1 10.57 60.8 H6.61 A6.61 6.61 0 0 1 0 54.19 V6.61 A6.61 6.61 0 0 1 6.61 0 Z",
  },
}

interface ZzosyIconProps {
  name: ZzosyIconName
  /** Tamanho em px (largura e altura iguais; SVG preserva aspect via viewBox). Default 18. */
  size?: number
  /** Override do fill (raro — cor oficial eh parte da identidade). Use somente pra estados disabled/hover sutis. */
  fill?: string
  /** Texto pra screen readers. Default: o proprio name. */
  ariaLabel?: string
  /** Marca como decorativo — esconde de screen readers. Use quando o botao tem label proprio ao lado. */
  decorative?: boolean
  style?: React.CSSProperties
  className?: string
}

export function ZzosyIcon({ name, size = 18, fill, ariaLabel, decorative, style, className }: ZzosyIconProps) {
  const ic = ICONS[name]
  if (!ic) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox={ic.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (ariaLabel ?? name)}
      aria-hidden={decorative ? true : undefined}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style }}
      className={className}
    >
      <path d={ic.path} fill={fill ?? ic.fill} />
    </svg>
  )
}
