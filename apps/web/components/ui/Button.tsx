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
 *
 * REGRA: todo botao com fill branco DEVE ter borda visivel (stroke). Nunca botao
 * sem borda em cima de fundo branco — fica "perdido". A unica excecao e o primary
 * (amarelo cheio) e o link.
 *
 * Variants legadas mantidas pra retrocompat: dark e link.
 */
import { ButtonHTMLAttributes } from "react"
import { clsx } from "clsx"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "dark" | "danger" | "success" | "warning" | "info" | "ghost" | "link"
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
  const base = "inline-flex items-center justify-center font-semibold rounded-md transition-all cursor-pointer font-['DM_Sans',sans-serif] whitespace-nowrap"

  // Outline style por padrao — todos com fundo branco precisam de stroke visivel.
  const variants = {
    primary:   "bg-[#F5C400] text-[#111111] border border-[#F5C400] hover:bg-[#e0b000] hover:border-[#e0b000]",
    secondary: "bg-white text-[#111111] border border-[#555555] hover:bg-[#F5F5F0]",
    dark:      "bg-[#111111] text-white border border-[#111111] hover:bg-[#000]",
    danger:    "bg-white text-[#111111] border-4 border-[#dc2626] hover:bg-[#fef2f2]",
    success:   "bg-white text-[#111111] border-4 border-[#15803d] hover:bg-[#f0fdf4]",
    warning:   "bg-white text-[#111111] border-4 border-[#d97706] hover:bg-[#fffbeb]",
    info:      "bg-white text-[#111111] border-4 border-[#2563eb] hover:bg-[#eff6ff]",
    ghost:     "bg-white text-[#111111] border border-[#D0D0D0] hover:border-[#888888]",
    link:      "bg-transparent text-[#F5C400] border-0 hover:text-[#e0b000] underline-offset-2",
  }
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-2.5 text-base",
  }
  const cls = clsx(base, variants[variant], sizes[size], (disabled || loading) && "opacity-50 cursor-not-allowed", className)

  // Modo file input: renderiza <label> envolvendo input. Mesma aparencia, mas
  // clique abre o file picker do browser em vez de disparar onClick.
  if (onFileSelect) {
    return (
      <label className={cls} title={(props.title as string) || undefined} style={{ ...(props.style || {}) }}>
        {loading ? <span className="animate-spin">⟳</span> : children}
        <input
          type="file"
          accept={accept}
          disabled={disabled || loading}
          style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
          tabIndex={-1}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onFileSelect(f)
            e.target.value = ""
          }}
        />
      </label>
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
