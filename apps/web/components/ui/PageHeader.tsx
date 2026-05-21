"use client"
/**
 * Header padrao das pages internas do ZZOSY: titulo grande + subtitulo
 * opcional + count opcional + slot de actions.
 *
 * Antes (audit F5.4) cada page rolava o proprio header com fontSize/peso/cor
 * diferente — `/dashboard` usava 1.5rem 900, `/pieces` usava text-2xl bold,
 * `/medias` 22px 700, `/clients/[id]` div nao-h1 22px 700. Padronizado: 22px /
 * weight 700, subtitle 12px / #888, gap 18px abaixo. Conta seca como pill cinza.
 */
import React from "react"

export interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  count?: number
  actions?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function PageHeader({ title, subtitle, count, actions, className, style }: PageHeaderProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: subtitle ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            lineHeight: 1.2,
          }}
        >
          <span>{title}</span>
          {typeof count === "number" && (
            <span style={{ fontSize: 13, fontWeight: 500, color: "#888" }}>({count})</span>
          )}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "#888",
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{actions}</div>
      )}
    </div>
  )
}
