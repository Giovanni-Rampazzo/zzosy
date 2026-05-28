"use client"
/**
 * Guidebook do sistema ZZOSY — sidebar com sumario por categoria + conteudo
 * principal. Fonte de dados em lib/guidebook.tsx (single source).
 *
 * Adicionar uma secao = adicionar entry em GUIDEBOOK_SECTIONS. Aparece
 * automaticamente no sumario.
 */
import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { GUIDEBOOK_SECTIONS, type GuidebookCategory } from "@/lib/guidebook"

const CATEGORY_LABELS: Record<GuidebookCategory, string> = {
  sitemap: "Sitemap",
  conceitos: "Conceitos",
  logica: "Lógica do sistema",
  integracao: "Integrações",
  tutoriais: "Tutoriais",
}

const CATEGORY_ORDER: GuidebookCategory[] = ["sitemap", "conceitos", "logica", "integracao", "tutoriais"]

export default function GuidebookPage() {
  const router = useRouter()
  const [activeId, setActiveId] = useState<string>(GUIDEBOOK_SECTIONS[0]?.id ?? "")
  const [query, setQuery] = useState("")

  // Hash sync (link direto pra seção)
  useEffect(() => {
    const h = window.location.hash.slice(1)
    if (h && GUIDEBOOK_SECTIONS.find(s => s.id === h)) setActiveId(h)
  }, [])
  useEffect(() => {
    if (activeId) window.history.replaceState(null, "", `#${activeId}`)
  }, [activeId])

  const grouped = useMemo(() => {
    const m: Record<string, typeof GUIDEBOOK_SECTIONS> = {}
    for (const s of GUIDEBOOK_SECTIONS) {
      if (!m[s.category]) m[s.category] = []
      m[s.category].push(s)
    }
    return m
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return GUIDEBOOK_SECTIONS
    const q = query.toLowerCase()
    return GUIDEBOOK_SECTIONS.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    )
  }, [query])

  const active = GUIDEBOOK_SECTIONS.find(s => s.id === activeId) ?? GUIDEBOOK_SECTIONS[0]

  return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page)", fontFamily: "var(--zz-font-family)" }}>
      <div style={{ background: "#111", color: "#FFF", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontWeight: 900, fontSize: "1.1rem", letterSpacing: "-0.03em" }}>ZZOSY · Guidebook</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Sitemap • Lógicas • Tutoriais</span>
        </div>
        <button onClick={() => router.push("/admin")}
          style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#FFF", padding: "6px 14px", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontFamily: "var(--zz-font-family)" }}>
          ← Admin
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 0, minHeight: "calc(100vh - 56px)" }}>
        {/* SIDEBAR */}
        <aside style={{ borderRight: "1px solid var(--zz-border-default)", background: "var(--zz-bg-card)", padding: 16, overflowY: "auto", maxHeight: "calc(100vh - 56px)", position: "sticky", top: 56 }}>
          <input
            type="text"
            placeholder="Buscar seção..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px", fontSize: 13,
              border: "1px solid var(--zz-border-default)",
              borderRadius: "var(--zz-radius-md)", outline: "none",
              marginBottom: 16, fontFamily: "var(--zz-font-family)",
            }}
          />
          {query.trim() ? (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--zz-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Resultados ({filtered.length})
              </div>
              {filtered.map(s => (
                <button key={s.id} onClick={() => setActiveId(s.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 10px", marginBottom: 4,
                    background: activeId === s.id ? "var(--zz-bg-subtle)" : "transparent",
                    border: "none", borderRadius: "var(--zz-radius-sm)",
                    cursor: "pointer", fontSize: 12, lineHeight: 1.3,
                    color: "var(--zz-text-primary)", fontFamily: "var(--zz-font-family)",
                  }}>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: "var(--zz-text-muted)", marginTop: 2 }}>
                    {CATEGORY_LABELS[s.category]}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            CATEGORY_ORDER.map(cat => grouped[cat] && (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--zz-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  {CATEGORY_LABELS[cat]}
                </div>
                {grouped[cat].map(s => (
                  <button key={s.id} onClick={() => setActiveId(s.id)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 10px", marginBottom: 2,
                      background: activeId === s.id ? "var(--zz-brand-primary)" : "transparent",
                      border: "none", borderRadius: "var(--zz-radius-sm)",
                      cursor: "pointer", fontSize: 13,
                      color: "var(--zz-text-primary)",
                      fontWeight: activeId === s.id ? 700 : 500,
                      fontFamily: "var(--zz-font-family)",
                    }}>
                    {s.title}
                  </button>
                ))}
              </div>
            ))
          )}
        </aside>

        {/* CONTENT */}
        <main style={{ padding: "32px 48px", maxWidth: 1000, overflowY: "auto" }}>
          {active ? (
            <article>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--zz-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                {CATEGORY_LABELS[active.category]}
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", marginBottom: 8, color: "var(--zz-text-primary)" }}>
                {active.title}
              </h1>
              <p style={{ fontSize: 14, color: "var(--zz-text-secondary)", marginBottom: 24 }}>
                {active.summary}
              </p>
              <div style={{ fontSize: 14, color: "var(--zz-text-primary)", lineHeight: 1.6 }}>
                {active.content}
              </div>
              <div style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid var(--zz-border-light)", fontSize: 11, color: "var(--zz-text-muted)" }}>
                Editar essa seção: <code style={{ background: "#f4f4f4", padding: "1px 6px", borderRadius: 3 }}>apps/web/lib/guidebook.tsx</code> · id={active.id}
              </div>
            </article>
          ) : (
            <div style={{ color: "var(--zz-text-muted)" }}>Nenhuma seção selecionada.</div>
          )}
        </main>
      </div>
    </div>
  )
}
