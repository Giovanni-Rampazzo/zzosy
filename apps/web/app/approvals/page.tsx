"use client"
import { useEffect, useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { statusMeta, PIECE_STATUSES } from "@/lib/pieceStatus"
import { Button } from "@/components/ui/Button"
import { FilterPill } from "@/components/ui/FilterPill"

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

export default function ApprovalsPage() {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("ALL")
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/pieces", { cache: "no-store" }).then(r=>r.json()).then(d=>{
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
    CLIENTE: pieces.filter(p=>p.status==="CLIENTE").length,
    APROVADO: pieces.filter(p=>p.status==="APROVADO").length,
    REPROVADO: pieces.filter(p=>p.status==="REPROVADO").length,
  }

  return (
    <PageShell>
      <div style={{padding:32}}>
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",marginBottom:32}}>
          <div style={{display:"flex",gap:8}}>
            {[["ALL","Todas"],["CLIENTE","Cliente"],["APROVADO","Aprovadas"],["REPROVADO","Reprovadas"]].map(([v,l])=>(
              <FilterPill key={v} active={filter===v} onClick={()=>setFilter(v)}>
                {l} ({counts[v as keyof typeof counts] ?? 0})
              </FilterPill>
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
                    background:statusMeta(piece.status).bg,color:statusMeta(piece.status).color
                  }}>
                    {statusMeta(piece.status).label}
                  </span>
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:8,padding:"10px 14px",borderTop:"1px solid #f5f5f5",background:"#fafafa"}}>
                  {(piece.status === "STANDBY" || piece.status === "CRIACAO") && (
                    <Button variant="primary" size="sm" loading={updating === piece.id} onClick={() => updateStatus(piece.id, "CLIENTE")} className="flex-1">Enviar para cliente</Button>
                  )}
                  {piece.status === "CLIENTE" && (
                    <>
                      <Button variant="danger" size="sm" loading={updating === piece.id} onClick={() => updateStatus(piece.id, "REPROVADO")}>Reprovar</Button>
                      <Button variant="success" size="sm" loading={updating === piece.id} onClick={() => updateStatus(piece.id, "APROVADO")} className="flex-1">Aprovar</Button>
                    </>
                  )}
                  {(piece.status === "APROVADO" || piece.status === "REPROVADO") && (
                    <Button variant="secondary" size="sm" loading={updating === piece.id} onClick={() => updateStatus(piece.id, "CLIENTE")}>Reabrir</Button>
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
