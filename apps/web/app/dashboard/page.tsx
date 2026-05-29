"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { RowThumb, colorFromString } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"
import { ClientEditModal } from "@/components/clients/ClientEditModal"

interface Client {
  id: string; name: string; email: string | null; contact: string | null
  phone?: string | null; address?: string | null; brandLogoUrl?: string | null
  _count: { campaigns: number; pieces: number }; createdAt: string
}

// Estilos vem de CSS vars (var(--zz-...)) — editaveis em
// /admin/settings/design-tokens. Container centralizado, grid de cards e
// thumb area sao todos tweakaveis sem rebuild. 2026-05-28.
const compactBtnStyle: React.CSSProperties = {
  padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)",
  fontSize: "var(--zz-btn-compact-fs)",
  lineHeight: 1.2,
}

export default function DashboardPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", address: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  useEffect(() => { fetchClients() }, [])

  async function fetchClients() {
    const res = await fetch("/api/clients")
    if (res.ok) setClients(await res.json())
    setLoading(false)
  }

  async function createClient(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError("Nome obrigatório"); return }
    setSaving(true); setError("")
    const res = await fetch("/api/clients", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form)
    })
    if (res.ok) { setShowModal(false); setForm({ name:"",contact:"",email:"",phone:"",address:"" }); fetchClients() }
    else {
      let msg = `Erro ao criar cliente (HTTP ${res.status})`
      try {
        const txt = await res.text()
        if (txt) {
          const d = JSON.parse(txt)
          if (d?.error) msg = d.error
        }
      } catch { /* body nao eh JSON */ }
      setError(msg)
      console.error("[createClient] falhou. status:", res.status)
    }
    setSaving(false)
  }

  async function deleteClient(clientId: string) {
    await fetch(`/api/clients/${clientId}`, { method: "DELETE" })
    setClients(prev => prev.filter(c => c.id !== clientId))
    setConfirmDelete(null)
  }

  async function duplicateClient(clientId: string) {
    setDuplicatingId(clientId)
    try {
      const res = await fetch(`/api/clients/${clientId}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao duplicar cliente: " + (err.detail ?? err.error ?? "?"))
        return
      }
      await fetchClients()
    } finally {
      setDuplicatingId(null)
    }
  }

  return (
    <PageShell>
      <div style={{
        maxWidth: "var(--zz-page-max-w)",
        margin: "0 auto",
        padding: "var(--zz-page-pad-y) var(--zz-page-pad-x) var(--zz-page-pad-bottom)",
      }}>
        <h1 style={{
          fontSize: "var(--zz-page-h1-size)",
          fontWeight: 700,
          color: "var(--zz-text-primary)",
          margin: "0 0 var(--zz-page-h1-mb)",
        }}>Clientes</h1>

        <div style={{
          display: "grid",
          // auto-fit + minmax centralizado pelos tokens: cards tem largura
          // limitada (nao esticam o vw inteiro), colunas vazias colapsam e as
          // existentes ficam centralizadas no container.
          gridTemplateColumns: "repeat(auto-fit, minmax(var(--zz-card-grid-min), var(--zz-card-grid-max)))",
          justifyContent: "center",
          gap: "var(--zz-card-grid-gap)",
        }}>
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}

          {!loading && clients.map(c => {
            const isConfirming = confirmDelete === c.id
            const accent = colorFromString(c.name)
            return (
              <div
                key={c.id}
                style={{
                  background: "var(--zz-bg-card)",
                  borderRadius: "var(--zz-card-radius-lg)",
                  border: "var(--zz-stroke-fino) solid var(--zz-border-default)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  transition: "box-shadow 0.15s, transform 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = "translateY(-2px)" }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)" }}
              >
                {/* Thumb area: logo centralizada com fallback de inicial colorida.
                    Cursor pointer pq clicar aqui = Entrar (atalho do botao Entrar). */}
                <div
                  onClick={() => router.push(`/clients/${c.id}`)}
                  style={{
                    height: "var(--zz-card-thumb-h)",
                    background: c.brandLogoUrl ? "var(--zz-bg-page)" : accent,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "var(--zz-card-thumb-pad)",
                    position: "relative",
                  }}
                >
                  {c.brandLogoUrl ? (
                    <RowThumb src={c.brandLogoUrl} alt={c.name} size={100} rounded={8} fit="contain" />
                  ) : (
                    <div style={{
                      color: "white",
                      fontSize: 44,
                      fontWeight: 700,
                      letterSpacing: "-2px",
                    }}>
                      {c.name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
                    </div>
                  )}
                </div>

                {/* Nome + stats */}
                <div
                  onClick={() => router.push(`/clients/${c.id}`)}
                  style={{ padding: "14px 16px 8px", cursor: "pointer", flex: 1 }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 8 }}>
                    <span><strong style={{ color: "#111" }}>{c._count.campaigns}</strong> {c._count.campaigns === 1 ? "campanha" : "campanhas"}</span>
                    <span>·</span>
                    <span><strong style={{ color: "#111" }}>{c._count.pieces}</strong> {c._count.pieces === 1 ? "peça" : "peças"}</span>
                  </div>
                </div>

                {/* Action row: 4 botoes outline (CLAUDE 1.1.B). Compact tokens
                    pra caber em card de 280px. */}
                <div style={{ padding: "10px 12px 12px", borderTop: "1px solid #f0f0f0", display: "flex", gap: "var(--zz-btn-compact-gap)" }}>
                  {isConfirming ? (
                    <>
                      <span style={{ fontSize: 11, color: "#666", alignSelf: "center", marginRight: 4 }}>Confirmar?</span>
                      <Button variant="danger" size="sm" style={compactBtnStyle} onClick={() => deleteClient(c.id)}>Sim</Button>
                      <Button variant="secondary" size="sm" style={compactBtnStyle} onClick={() => setConfirmDelete(null)}>Não</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="danger" size="sm" style={{ ...compactBtnStyle, flex: 1 }} onClick={() => setConfirmDelete(c.id)}>Apagar</Button>
                      <Button variant="info" size="sm" style={{ ...compactBtnStyle, flex: 1 }} loading={duplicatingId === c.id} onClick={() => duplicateClient(c.id)}>{duplicatingId === c.id ? "..." : "Duplicar"}</Button>
                      <Button variant="secondary" size="sm" style={{ ...compactBtnStyle, flex: 1 }} onClick={() => router.push(`/clients/${c.id}/edit`)}>Editar</Button>
                      <Button variant="view" size="sm" style={{ ...compactBtnStyle, flex: 1 }} onClick={() => router.push(`/clients/${c.id}`)}>Entrar</Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Tile "+ Novo Cliente" dentro da grid — regra ZZOSY 2.5:
              "+ Adicionar X" vive dentro da lista, nunca em header separado. */}
          {!loading && (
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: "transparent",
                border: "2px dashed #C0C0B8",
                borderRadius: "var(--zz-card-radius-lg)",
                cursor: "pointer",
                minHeight: 280,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--zz-text-muted)",
                fontFamily: "inherit",
                transition: "border-color 0.15s, color 0.15s, background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--zz-border-strong)"; e.currentTarget.style.color = "var(--zz-text-primary)"; e.currentTarget.style.background = "rgba(255,255,255,0.5)" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#C0C0B8"; e.currentTarget.style.color = "var(--zz-text-muted)"; e.currentTarget.style.background = "transparent" }}
            >
              <div style={{ fontSize: 36, fontWeight: 300, lineHeight: 1 }}>+</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Novo Cliente</div>
            </button>
          )}
        </div>
      </div>

      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:12,width:480,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <div style={{fontWeight:700,fontSize:16}}>Novo Cliente</div>
            </div>
            <form onSubmit={createClient} style={{padding:24,display:"flex",flexDirection:"column",gap:14}}>
              {[["name","Nome *","Nome do cliente"],["contact","Contato","Nome do contato"],["email","E-mail","email@cliente.com"],["phone","Telefone","(11) 99999-9999"],["address","Endereço","Cidade, Estado"]].map(([k,l,p]) => (
                <div key={k}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888",display:"block",marginBottom:5}}>{l}</label>
                  <input
                    type={k==="email"?"email":"text"}
                    value={(form as any)[k]}
                    onChange={e => setForm(f => ({...f,[k]:e.target.value}))}
                    placeholder={p}
                    required={k==="name"}
                    style={{width:"100%",padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" as const}}
                  />
                </div>
              ))}
              {error && <p style={{color:"#666",fontSize:12,margin:0}}>{error}</p>}
              <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:4}}>
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button type="submit" loading={saving}>{saving ? "Criando..." : "Criar cliente"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editingClient && (
        <ClientEditModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={(u) => setClients(prev => prev.map(c => c.id === u.id ? { ...c, ...u } : c))}
        />
      )}
    </PageShell>
  )
}

function SkeletonCard() {
  return (
    <div style={{
      background: "var(--zz-bg-card)",
      borderRadius: "var(--zz-card-radius-lg)",
      border: "var(--zz-stroke-fino) solid var(--zz-border-default)",
      overflow: "hidden",
      minHeight: 280,
    }}>
      <div style={{ height: "var(--zz-card-thumb-h)", background: "linear-gradient(90deg, #EDEDED 0%, #F5F5F5 50%, #EDEDED 100%)", backgroundSize: "200% 100%", animation: "rowthumb-pulse 1.2s ease-in-out infinite" }} />
      <div style={{ padding: "14px 16px" }}>
        <div style={{ height: 16, width: "60%", background: "#EDEDED", borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 12, width: "40%", background: "#EDEDED", borderRadius: 4 }} />
      </div>
    </div>
  )
}
