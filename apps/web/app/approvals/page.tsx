"use client"
import { useEffect, useState } from "react"
import { PageShell } from "@/components/layout/PageShell"

interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  status: string
  imageUrl?: string | null
  campaign?: { name: string; client?: { name: string } }
}

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT:    { label: "Rascunho",    bg: "#f1f1f1", color: "#666" },
  REVIEW:   { label: "Em revisão",  bg: "#fef9c3", color: "#ca8a04" },
  APPROVED: { label: "Aprovada",    bg: "#dcfce7", color: "#16a34a" },
  EXPORTED: { label: "Exportada",   bg: "#dbeafe", color: "#2563eb" },
}

export default function ApprovalsPage() {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("ALL")
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/pieces").then(r=>r.json()).then(d=>{
      setPieces(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    await fetch(`/api/pieces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setPieces(prev => prev.map(p => p.id === id ? { ...p, status } : p))
    setUpdating(null)
  }

  const filtered = filter === "ALL" ? pieces : pieces.filter(p => p.status === filter)
  const counts = {
    ALL: pieces.length,
    REVIEW: pieces.filter(p=>p.status==="REVIEW").length,
    APPROVED: pieces.filter(p=>p.status==="APPROVED").length,
    DRAFT: pieces.filter(p=>p.status==="DRAFT").length,
  }

  const tabStyle = (active: boolean) => ({
    padding:"6px 16px",fontSize:12,fontWeight:600,cursor:"pointer",
    background:active?"#111":"transparent",
    color:active?"white":"#888",
    border:"1px solid #E0E0E0",
    borderRadius:6,
  })

  return (
    <PageShell>
      <div style={{padding:32}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:32}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Aprovação de Peças</h1>
            <p style={{fontSize:12,color:"#888",margin:"4px 0 0"}}>Revise e aprove as peças geradas</p>
          </div>
          <div style={{display:"flex",gap:8}}>
            {[["ALL","Todas"],["DRAFT","Rascunho"],["REVIEW","Em revisão"],["APPROVED","Aprovadas"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)} style={tabStyle(filter===v)}>
                {l} ({counts[v as keyof typeof counts] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{textAlign:"center",padding:"64px 0",color:"#888"}}>Carregando...</div>
        ) : filtered.length === 0 ? (
          <div style={{textAlign:"center",padding:"64px 0",color:"#888"}}>Nenhuma peça encontrada</div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:20}}>
            {filtered.map(piece => (
              <div key={piece.id} style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
                {/* Preview */}
                <div style={{height:160,background:"#F5F5F0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderBottom:"1px solid #E0E0E0",padding:0,overflow:"hidden"}}>
                  {piece.imageUrl ? (
                    <img src={piece.imageUrl} alt={piece.name} style={{width:"100%",height:"100%",objectFit:"contain"}} />
                  ) : (
                    <div style={{padding:16,textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#888",marginBottom:4}}>{piece.format}</div>
                      <div style={{fontSize:11,color:"#aaa"}}>{piece.width} × {piece.height} px</div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{padding:14}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{piece.name}</div>
                  {piece.campaign && (
                    <div style={{fontSize:11,color:"#888",marginBottom:8}}>
                      {piece.campaign.client?.name} — {piece.campaign.name}
                    </div>
                  )}
                  <span style={{
                    fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:10,
                    background:STATUS[piece.status]?.bg,color:STATUS[piece.status]?.color
                  }}>
                    {STATUS[piece.status]?.label ?? piece.status}
                  </span>
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:8,padding:"10px 14px",borderTop:"1px solid #f5f5f5",background:"#fafafa"}}>
                  {piece.status === "DRAFT" && (
                    <button
                      onClick={() => updateStatus(piece.id, "REVIEW")}
                      disabled={updating === piece.id}
                      style={{flex:1,padding:"6px 0",background:"#F5C400",border:"none",borderRadius:6,fontWeight:600,fontSize:12,cursor:"pointer"}}
                    >
                      Enviar para revisão
                    </button>
                  )}
                  {piece.status === "REVIEW" && (
                    <>
                      <button
                        onClick={() => updateStatus(piece.id, "APPROVED")}
                        disabled={updating === piece.id}
                        style={{flex:1,padding:"6px 0",background:"#16a34a",color:"white",border:"none",borderRadius:6,fontWeight:600,fontSize:12,cursor:"pointer"}}
                      >
                        ✓ Aprovar
                      </button>
                      <button
                        onClick={() => updateStatus(piece.id, "DRAFT")}
                        disabled={updating === piece.id}
                        style={{padding:"6px 12px",border:"1px solid #E0E0E0",borderRadius:6,background:"white",fontSize:12,cursor:"pointer"}}
                      >
                        ↩ Devolver
                      </button>
                    </>
                  )}
                  {piece.status === "APPROVED" && (
                    <button
                      onClick={() => updateStatus(piece.id, "REVIEW")}
                      disabled={updating === piece.id}
                      style={{padding:"6px 12px",border:"1px solid #E0E0E0",borderRadius:6,background:"white",fontSize:12,cursor:"pointer",color:"#888"}}
                    >
                      Reabrir revisão
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
