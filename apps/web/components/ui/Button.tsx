"use client"
import { ButtonHTMLAttributes } from "react"
import { clsx } from "clsx"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "dark" | "danger" | "ghost" | "link"
  size?: "sm" | "md" | "lg"
  loading?: boolean
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-md transition-all cursor-pointer border-0 font-['DM_Sans',sans-serif] whitespace-nowrap"
  const variants = {
    primary: "bg-[#F5C400] text-[#111111] hover:bg-[#e0b000]",
    secondary: "bg-white text-[#333] border border-[#E0E0E0] hover:bg-[#F5F5F0]",
    dark: "bg-[#111] text-white hover:bg-[#000]",
    danger: "bg-[#fee2e2] text-[#dc2626] border border-[#fecaca] hover:bg-[#fecaca]",
    ghost: "bg-transparent text-[#888888] hover:text-[#111111] hover:bg-[#F5F5F0]",
    link: "bg-transparent text-[#F5C400] hover:text-[#e0b000] underline-offset-2",
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
