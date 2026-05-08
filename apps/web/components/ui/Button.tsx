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
 * Cores semanticas (todas com fill branco + borda+texto da cor — outline style):
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
}

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center font-semibold rounded-md transition-all cursor-pointer font-['DM_Sans',sans-serif] whitespace-nowrap"

  // Outline style por padrao — todos com fundo branco precisam de stroke visivel.
  const variants = {
    primary:   "bg-[#F5C400] text-[#111111] border border-[#F5C400] hover:bg-[#e0b000] hover:border-[#e0b000]",
    secondary: "bg-white text-[#111111] border border-[#555555] hover:bg-[#F5F5F0]",
    dark:      "bg-[#111111] text-white border border-[#111111] hover:bg-[#000]",
    danger:    "bg-white text-[#dc2626] border border-[#dc2626] hover:bg-[#fef2f2]",
    success:   "bg-white text-[#15803d] border border-[#15803d] hover:bg-[#f0fdf4]",
    warning:   "bg-white text-[#d97706] border border-[#d97706] hover:bg-[#fffbeb]",
    info:      "bg-white text-[#2563eb] border border-[#2563eb] hover:bg-[#eff6ff]",
    ghost:     "bg-white text-[#888888] border border-[#D0D0D0] hover:text-[#111111] hover:border-[#888888]",
    link:      "bg-transparent text-[#F5C400] border-0 hover:text-[#e0b000] underline-offset-2",
  }
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-2.5 text-base",
  }
  return (
    <button
      className={clsx(base, variants[variant], sizes[size], (disabled || loading) && "opacity-50 cursor-not-allowed", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="animate-spin">⟳</span> : children}
    </button>
  )
}
