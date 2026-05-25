"use client"
/**
 * Button component — sistema padronizado ZZOSY.
 *
 * Hierarquia visual (do mais ao menos enfatico):
 *  - primary:   amarelo cheio. Use SO em CTA principal de uma area + botoes de navegacao
 *               do header (Voltar para campanha, etc). NAO usar pra tudo — perde o destaque.
 *  - secondary: borda cinza escuro #555, fill branco, texto preto. DEFAULT do sistema.
 *               Usar em qualquer botao "neutro" (Salvar nao-destaque, Aplicar, etc).
 *
 * Cores semanticas (todas com fill branco + borda colorida + texto preto):
 *  - danger:  vermelho. Apagar/destrutivo.
 *  - success: verde. Confirmar, OK, aprovar.
 *  - warning: laranja. Atencao, avisos.
 *  - info:    azul. Duplicar, copiar, acoes intermediarias.
 *  - ghost:   cinza bem claro. Acoes secundarias/menos importantes.
 *  - view:    amarelo (stroke amarelo, fill branco, texto preto). LEGADO —
 *             novo padrao ZZOSY (feedback_primary_action_fill_brand 2026-05-23):
 *             botao MAIS PROVAVEL de ser clicado usa `primary` (fill amarelo),
 *             nao `view`. Use `view` apenas quando ja ha um primary na mesma
 *             linha/grupo (pra nao ter 2 fills competindo).
 *
 * REGRA: todo botao com fill branco DEVE ter borda visivel (stroke). Nunca botao
 * sem borda em cima de fundo branco — fica "perdido". A unica excecao e o primary
 * (amarelo cheio) e o link.
 *
 * Variants legadas mantidas pra retrocompat: dark e link.
 */
import { ButtonHTMLAttributes, useRef } from "react"
import { clsx } from "clsx"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "dark" | "danger" | "success" | "warning" | "info" | "ghost" | "link" | "view"
  size?: "sm" | "md" | "lg"
  loading?: boolean
  /**
   * Quando definido, o botao vira <label> envolvendo um <input type="file"> escondido.
   * Click no botao abre o file picker; arquivo selecionado vai pro onFileSelect.
   * Use junto com `accept` pra restringir tipos. NAO use onClick simultaneamente.
   */
  onFileSelect?: (file: File) => void
  /** MIME/extension filter pro file input (ex: ".psd", "image/png,image/jpeg"). */
  accept?: string
}

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, onFileSelect, accept, ...props }: ButtonProps) {
  // Ref pro file input. Declarado SEMPRE no top-level (Rules of Hooks — React
  // nao permite hooks dentro de condicionais). So usado quando onFileSelect
  // existe; nos outros casos fica idle.
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const base = "inline-flex items-center justify-center font-semibold rounded-[var(--zz-radius-md)] transition-all cursor-pointer font-['DM_Sans',sans-serif] whitespace-nowrap"

  // Outline style por padrao — todos com fundo branco precisam de stroke visivel.
  // Cores e radius via CSS vars editaveis em /design-tokens.
  const sw = "border-[length:var(--zz-stroke-medio)]"
  const variants = {
    primary:   `bg-[var(--zz-brand-primary)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-brand-primary)] hover:bg-[var(--zz-brand-primary-hover)] hover:border-[var(--zz-brand-primary-hover)]`,
    secondary: `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-border-strong)] hover:bg-[var(--zz-bg-page)]`,
    dark:      `bg-[var(--zz-text-primary)] text-white ${sw} border-[var(--zz-text-primary)] hover:opacity-90`,
    danger:    `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-danger)] hover:bg-[#fef2f2]`,
    success:   `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-success)] hover:bg-[#f0fdf4]`,
    warning:   `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-warning)] hover:bg-[#fffbeb]`,
    info:      `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-info)] hover:bg-[#eff6ff]`,
    ghost:     `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[#D0D0D0] hover:border-[var(--zz-text-muted)]`,
    view:      `bg-[var(--zz-bg-card)] text-[var(--zz-text-primary)] ${sw} border-[var(--zz-brand-primary)] hover:bg-[#FFFBE6]`,
    link:      "bg-transparent text-[var(--zz-brand-primary)] border-0 hover:text-[var(--zz-brand-primary-hover)] underline-offset-2",
  }
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-2.5 text-base",
  }
  const cls = clsx(base, variants[variant], sizes[size], (disabled || loading) && "opacity-50 cursor-not-allowed", className)

  // Modo file input: usa OVERLAY pattern.
  // Tentamos antes:
  //  1) <label> envolvendo <input>: nao disparava picker (Next.js 16+React 19).
  //  2) <button> com fileInputRef.current.click(): logs confirmam que .click()
  //     foi chamado mas Chrome silenciosamente bloqueava (user activation budget
  //     consumido / input "muito escondido" / requisitos cada vez mais rigidos).
  // Padrao OVERLAY: renderiza <button> visualmente, sobreposto por <input type=
  // file> invisivel (opacity 0) ocupando exatamente a mesma area (position
  // absolute inset 0). O click do user atinge o INPUT diretamente — gesto nativo,
  // sem .click() programatico, sem JS gymnastics. Browser sempre abre o picker.
  if (onFileSelect) {
    const overlayDisabled = disabled || loading
    return (
      // display:block + align-self:stretch — sem isso, o span (inline-block)
      // nao estica no eixo cruzado de um flex column container e o botao
      // ficava visualmente menor que botoes <Button onClick> irmaos.
      <span style={{ position: "relative", display: "block", alignSelf: "stretch" }}>
        <button
          type="button"
          className={cls}
          disabled={overlayDisabled}
          title={(props.title as string) || undefined}
          style={{ width: "100%", ...props.style }}
          // Defense-in-depth (2026-05-24): primariamente o input invisivel
          // overlay captura o click, mas se por algum motivo nao captura
          // (z-index dev server crash residuo, browser policy, etc), onClick
          // do botao tambem dispara input.click() como fallback.
          onClick={(e) => {
            if (overlayDisabled) return
            // Se click ja foi no input (overlay funcionou), o input ja abriu o picker.
            // Aqui forca de novo so se target NAO eh o input (caso edge onde click
            // bate no button real). React de-duplica gestures nativos do mesmo tick.
            if ((e.target as HTMLElement).tagName !== "INPUT") {
              fileInputRef.current?.click()
            }
          }}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === " ") && !overlayDisabled) {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          {loading ? <span className="animate-spin">⟳</span> : children}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          disabled={overlayDisabled}
          // Ocupa a area inteira do button irmao, transparente. user clica "no
          // botao" mas tecnicamente clica neste input — gesto nativo do browser.
          // z-index 1 garante que fica SOBRE o <button> (que tem z-index auto).
          // pointerEvents auto garante que captura clicks mesmo em variantes
          // com cls/className que setem pointer-events:none. 2026-05-24.
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: overlayDisabled ? "not-allowed" : "pointer",
            zIndex: 1,
            pointerEvents: overlayDisabled ? "none" : "auto",
          }}
          tabIndex={-1}
          onClick={() => { if (typeof window !== "undefined") console.log("[Button-input-click] picker should open", { accept }) }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (typeof window !== "undefined") console.log("[Button-onFileSelect]", { hasFile: !!f, name: f?.name, accept })
            if (f) onFileSelect(f)
            e.target.value = ""
          }}
        />
      </span>
    )
  }

  return (
    <button
      className={cls}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="animate-spin">⟳</span> : children}
    </button>
  )
}
