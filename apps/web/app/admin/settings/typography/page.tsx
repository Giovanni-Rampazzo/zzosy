"use client"
/**
 * Tipografia ao vivo — mostra a hierarquia de textos do ZZOSY com cada
 * tamanho/peso usado. Edita tamanhos e familia no painel da direita; cascata
 * para todo o sistema (qualquer page que use var(--zz-text-xxx) reage).
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { TOKENS, loadTokens, setToken } from "@/lib/designTokens"
import { Button } from "@/components/ui/Button"

const TYPO_KEYS = [
  "--zz-font-family",
  "--zz-text-display",
  "--zz-text-h1",
  "--zz-text-h2",
  "--zz-text-xl",
  "--zz-text-lg",
  "--zz-text-md",
  "--zz-text-base",
  "--zz-text-sm",
  "--zz-text-xs",
]

interface Sample {
  varName: string
  label: string
  weight: number
  color: string
  example: string
}

const SAMPLES: Sample[] = [
  { varName: "--zz-text-display", label: "Display · hero / landing", weight: 900, color: "var(--zz-text-primary)", example: "ZZOSY Studio" },
  { varName: "--zz-text-h1", label: "H1 · título de página", weight: 700, color: "var(--zz-text-primary)", example: "Empresas" },
  { varName: "--zz-text-h2", label: "H2 · subtítulo de seção", weight: 700, color: "var(--zz-text-primary)", example: "Campanhas ativas" },
  { varName: "--zz-text-xl", label: "XL · título de card", weight: 700, color: "var(--zz-text-primary)", example: "Cliente XYZ" },
  { varName: "--zz-text-lg", label: "LG · título de linha", weight: 600, color: "var(--zz-text-primary)", example: "Promoção de natal 2026" },
  { varName: "--zz-text-md", label: "MD · body padrão", weight: 400, color: "var(--zz-text-primary)", example: "Texto corrido em listas e parágrafos." },
  { varName: "--zz-text-base", label: "Base · captions, subtítulos", weight: 500, color: "var(--zz-text-secondary)", example: "Subtítulo secundário ou caption" },
  { varName: "--zz-text-sm", label: "SM · helpers, hints", weight: 500, color: "var(--zz-text-muted)", example: "Dica abaixo do input, helper text" },
  { varName: "--zz-text-xs", label: "XS · badges, code, micro labels", weight: 700, color: "var(--zz-text-muted)", example: "BADGE · LABEL" },
]

export default function TypographyPage() {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => { setValues(loadTokens()) }, [])

  function onChange(key: string, v: string) {
    setValues(prev => ({ ...prev, [key]: v }))
    setToken(key, v)
  }

  const typoTokens = TOKENS.filter(t => TYPO_KEYS.includes(t.key))

  return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page)", fontFamily: "var(--zz-font-family)" }}>
      <div style={{ background: "#111", color: "#FFF", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <span style={{ fontWeight: 900, fontSize: "1.1rem", letterSpacing: "-0.03em" }}>ZZOSY Admin · Tipografia</span>
        <button onClick={() => router.push("/admin")}
          style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#FFF", padding: "6px 14px", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
          ← Admin
        </button>
      </div>

      <div style={{ padding: "32px 40px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 32, alignItems: "start" }}>
        {/* ESQUERDA: amostras com cada tamanho aplicado */}
        <div>
          <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
            Hierarquia de textos
          </div>
          <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
            {SAMPLES.map(s => (
              <div key={s.varName} style={{ paddingBottom: 20, borderBottom: "1px solid var(--zz-border-light)" }}>
                <div
                  style={{
                    fontSize: `var(${s.varName})`,
                    fontWeight: s.weight,
                    color: s.color,
                    fontFamily: "var(--zz-font-family)",
                    lineHeight: 1.2,
                    marginBottom: 6,
                  }}
                >
                  {s.example}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "var(--zz-text-muted)" }}>
                  <span>{s.label}</span>
                  <code>{s.varName} · weight {s.weight}</code>
                </div>
              </div>
            ))}
          </div>

          {/* Combinacoes reais */}
          <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)", margin: "24px 0 12px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
            Combinações comuns
          </div>
          <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Page header */}
            <div style={{ borderBottom: "1px solid var(--zz-border-light)", paddingBottom: 16 }}>
              <h1 style={{ fontSize: "var(--zz-text-h1)", fontWeight: 700, margin: 0, color: "var(--zz-text-primary)" }}>Campanhas <span style={{ fontSize: "var(--zz-text-md)", fontWeight: 500, color: "var(--zz-text-muted)" }}>(12)</span></h1>
              <p style={{ fontSize: "var(--zz-text-base)", color: "var(--zz-text-muted)", margin: "4px 0 0" }}>Subtítulo opcional explicando contexto</p>
            </div>
            {/* Card */}
            <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 16 }}>
              <div style={{ fontSize: "var(--zz-text-lg)", fontWeight: 600, color: "var(--zz-text-primary)", marginBottom: 4 }}>Promoção de natal 2026</div>
              <div style={{ fontSize: "var(--zz-text-base)", color: "var(--zz-text-secondary)", marginBottom: 12 }}>SUNO United Creators · 8 peças</div>
              <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)" }}>Atualizada há 2 horas</div>
            </div>
            {/* Form field */}
            <div>
              <label style={{ fontSize: "var(--zz-text-sm)", fontWeight: 700, color: "var(--zz-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Nome da campanha</label>
              <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)", marginBottom: 6 }}>Como vai aparecer na lista e nos relatórios</div>
              <input placeholder="Ex: Black Friday 2026" style={{ width: "100%", padding: "8px 12px", fontSize: "var(--zz-text-md)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-md)", fontFamily: "var(--zz-font-family)", outline: "none" }} />
            </div>
            {/* Botoes */}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary">Salvar</Button>
              <Button variant="secondary">Cancelar</Button>
            </div>
          </div>
        </div>

        {/* DIREITA: editor */}
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
            Editar tokens
          </div>
          <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {typoTokens.map(t => {
              const current = values[t.key] ?? t.default
              const isCustom = !!values[t.key] && values[t.key] !== t.default
              return (
                <div key={t.key} style={{ display: "grid", gridTemplateColumns: "1fr 110px 60px", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--zz-text-primary)", fontWeight: 500 }}>
                      {t.label}
                      {isCustom && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--zz-brand-primary)" }}>● custom</span>}
                    </div>
                    {t.hint && <div style={{ fontSize: 9, color: "var(--zz-text-muted)", marginTop: 1 }}>{t.hint}</div>}
                    <code style={{ fontSize: 9, color: "var(--zz-text-muted)" }}>{t.key}</code>
                  </div>
                  {(() => {
                    // Numeric+unit: number input com setas + unit suffix com espaco.
                    // Match "10px", "1.5rem", "100%". Sem match: cai no text input.
                    const m = /^(-?\d+(?:\.\d+)?)\s*([a-z%]+)?$/i.exec(current)
                    if (!m) {
                      return (
                        <input type="text" value={current}
                          onChange={e => onChange(t.key, e.target.value)}
                          style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--zz-border-default)", borderRadius: 4, fontFamily: "ui-monospace,SFMono-Regular,monospace", outline: "none" }}
                        />
                      )
                    }
                    const num = m[1]
                    const unit = m[2] ?? "px"
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="number" value={num} step="1"
                          onChange={e => onChange(t.key, `${e.target.value}${unit}`)}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                          style={{ width: 56, padding: "4px 8px", fontSize: 11, border: "1px solid var(--zz-border-default)", borderRadius: 4, fontFamily: "ui-monospace,SFMono-Regular,monospace", outline: "none" }}
                        />
                        <span style={{ fontSize: 11, color: "var(--zz-text-muted)" }}>{unit}</span>
                      </div>
                    )
                  })()}
                  <button
                    onClick={() => { onChange(t.key, t.default); setValues(prev => { const next = { ...prev }; delete next[t.key]; return next }); setToken(t.key, t.default) }}
                    disabled={!isCustom}
                    style={{ fontSize: 10, padding: "4px 6px", background: "transparent", border: "1px solid var(--zz-border-default)", borderRadius: 4, cursor: isCustom ? "pointer" : "not-allowed", opacity: isCustom ? 1 : 0.4, color: "var(--zz-text-secondary)" }}
                  >
                    Default
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)", marginTop: 12 }}>
            Mudanças aplicam em todo ZZOSY que use <code>var(--zz-text-xxx)</code> ou <code>var(--zz-font-family)</code>. Sweep gradual em componentes pra usar essas vars.
          </div>
        </div>
      </div>
    </div>
  )
}
