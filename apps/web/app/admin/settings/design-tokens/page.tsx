"use client"
/**
 * Editor de design tokens — mexe nas CSS vars do ZZOSY (cores, bordas, raios)
 * com preview ao vivo. Mudancas salvam em localStorage e propagam pra todo o
 * sistema (qualquer pagina que abrir ja le os valores via DesignTokensInjector).
 */
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { TOKENS, loadTokens, setToken, resetTokens, TokenDef } from "@/lib/designTokens"
import { Button } from "@/components/ui/Button"

export default function DesignTokensPage() {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    setValues(loadTokens())
  }, [])

  const grouped = useMemo(() => {
    const map: Record<string, TokenDef[]> = {}
    for (const t of TOKENS) {
      if (!map[t.group]) map[t.group] = []
      map[t.group].push(t)
    }
    return map
  }, [])

  function onChange(key: string, v: string) {
    setValues(prev => ({ ...prev, [key]: v }))
    setToken(key, v)
  }

  function doReset() {
    if (!confirm("Restaurar TODOS os tokens pros valores padrao?")) return
    resetTokens()
    setValues({})
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page)", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: "#111", color: "#FFF", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontWeight: 900, fontSize: "1.1rem", letterSpacing: "-0.03em" }}>ZZOSY Admin · Design Tokens</span>
        </div>
        <button onClick={() => router.push("/admin")}
          style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#FFF", padding: "6px 14px", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          ← Admin
        </button>
      </div>

      <div style={{ padding: "32px 40px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
        {/* ESQUERDA: editor */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "var(--zz-text-muted)" }}>
              Edita ao vivo. Salva em localStorage — afeta todas as paginas do ZZOSY pra <strong>este browser</strong>.
            </div>
            <Button variant="danger" size="sm" onClick={doReset}>Resetar tudo</Button>
          </div>
          {Object.entries(grouped).map(([groupName, tokens]) => (
            <div key={groupName} style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--zz-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>{groupName}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tokens.map(t => {
                  const current = values[t.key] ?? t.default
                  const isCustom = !!values[t.key] && values[t.key] !== t.default
                  return (
                    <div key={t.key} style={{ display: "grid", gridTemplateColumns: "1fr 56px 100px 80px", gap: 8, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--zz-text-primary)", fontWeight: 500 }}>
                          {t.label}
                          {isCustom && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--zz-brand-primary)" }}>● custom</span>}
                        </div>
                        {t.hint && <div style={{ fontSize: 10, color: "var(--zz-text-muted)", marginTop: 2 }}>{t.hint}</div>}
                        <code style={{ fontSize: 10, color: "var(--zz-text-muted)" }}>{t.key}</code>
                      </div>
                      {t.type === "color" ? (
                        <input
                          type="color"
                          value={current}
                          onChange={e => onChange(t.key, e.target.value)}
                          style={{ width: 48, height: 30, padding: 0, border: "1px solid var(--zz-border-default)", borderRadius: 4, cursor: "pointer" }}
                        />
                      ) : (
                        <div />
                      )}
                      {t.type === "size" ? (
                        // Numeric+unit: number input (arrows nativos) + unit separado por espaco.
                        // Match valores tipo "16px", "1.5rem", "100%". Sem match: cai pro text input.
                        (() => {
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
                        })()
                      ) : (
                        <input type="text" value={current}
                          onChange={e => onChange(t.key, e.target.value)}
                          style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--zz-border-default)", borderRadius: 4, fontFamily: "ui-monospace,SFMono-Regular,monospace", outline: "none" }}
                        />
                      )}
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
            </div>
          ))}
        </div>

        {/* DIREITA: preview ao vivo */}
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--zz-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Preview ao vivo</div>
          <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginBottom: 12 }}>Botões (label real de produção · variant técnica)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              {[
                { variant: "primary" as const, label: "Ver" },
                { variant: "secondary" as const, label: "Cancelar" },
                { variant: "danger" as const, label: "Apagar" },
                { variant: "success" as const, label: "Aprovar" },
                { variant: "warning" as const, label: "Atenção" },
                { variant: "info" as const, label: "Duplicar" },
                { variant: "ghost" as const, label: "Opcional" },
                { variant: "view" as const, label: "Visualizar", legacy: true },
              ].map(b => (
                <div key={b.variant} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <Button variant={b.variant}>{b.label}</Button>
                  <code style={{ fontSize: 9, color: "var(--zz-text-muted)" }}>
                    {b.variant}
                    {(b as any).legacy && <span style={{ marginLeft: 4, color: "var(--zz-warning)" }}>legacy</span>}
                  </code>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginBottom: 12 }}>Card</div>
            <div style={{ background: "var(--zz-bg-card)", border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-lg)", padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--zz-text-primary)", marginBottom: 4 }}>Titulo do card</div>
              <div style={{ fontSize: 12, color: "var(--zz-text-secondary)" }}>Subtitulo secundario</div>
              <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginTop: 6 }}>Texto muted, valor menor</div>
            </div>
            <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginBottom: 12 }}>Row hover (com tokens --zz-row-pad-y/x)</div>
            <div style={{ border: "1px solid var(--zz-border-default)", borderRadius: "var(--zz-radius-md)", overflow: "hidden", marginBottom: 16 }}>
              {["Linha 1", "Linha 2 (hover simulado)", "Linha 3"].map((l, i) => (
                <div key={i} style={{
                  padding: "var(--zz-row-pad-y) var(--zz-row-pad-x)",
                  fontSize: "var(--zz-text-base)",
                  color: "var(--zz-text-primary)",
                  borderBottom: i < 2 ? "1px solid var(--zz-border-light)" : "none",
                  background: i === 1 ? "var(--zz-bg-subtle)" : "var(--zz-bg-card)",
                }}>{l}</div>
              ))}
            </div>

            {/* Botoes compactos — replica row de Apagar/Duplicar/Editar/Entrar */}
            <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginBottom: 12 }}>Row de ações compacta (4 botões padrão ZZOSY)</div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "var(--zz-btn-compact-gap)", flexWrap: "nowrap", marginBottom: 16, padding: 8, background: "var(--zz-bg-subtle)", borderRadius: "var(--zz-radius-md)" }}>
              <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Apagar</Button>
              <Button variant="info" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Duplicar</Button>
              <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Editar</Button>
              <Button variant="view" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Entrar</Button>
            </div>

            {/* Card de peça (replica /campaigns/[id] grid) */}
            <div style={{ fontSize: 11, color: "var(--zz-text-muted)", marginBottom: 12 }}>Card de peça (replica /campaigns/[id])</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(var(--zz-card-grid-min), 1fr))", gap: "var(--zz-card-grid-gap)" }}>
              {[1, 2].map(i => (
                <div key={i} style={{ background: "var(--zz-bg-card)", borderRadius: "var(--zz-radius-lg)", border: "1px solid var(--zz-border-default)", display: "flex", flexDirection: "column" }}>
                  <div style={{ height: 120, background: "var(--zz-bg-subtle)", borderRadius: "var(--zz-radius-lg) var(--zz-radius-lg) 0 0", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--zz-text-muted)", fontSize: "var(--zz-text-sm)" }}>
                    Preview {i}
                  </div>
                  <div style={{ padding: "var(--zz-card-pad-sm)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: "var(--zz-text-md)", fontWeight: 600 }}>Peça {i}</div>
                    <div style={{ fontSize: "var(--zz-text-sm)", color: "var(--zz-text-muted)" }}>1080 × 1440 px</div>
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "var(--zz-btn-compact-gap)", flexWrap: "nowrap", marginTop: "auto" }}>
                      <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Apagar</Button>
                      <Button variant="info" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Duplicar</Button>
                      <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Editar</Button>
                      <Button variant="view" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }}>Entrar</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--zz-text-muted)" }}>
            Mudancas aplicam tambem em <code>/dashboard</code>, <code>/campaigns</code>, etc. Abre nova aba pra ver.
          </div>
        </div>
      </div>
    </div>
  )
}
