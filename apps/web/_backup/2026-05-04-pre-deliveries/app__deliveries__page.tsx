"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"

interface Delivery {
  id: string
  number: number
  status: string
  totalSize: number | null
  createdAt: string
  campaign: { name: string; client: { name: string } }
  files: { extension: string }[]
  _count: { pieces: number }
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  DRAFT:{bg:"#f1f1f1",color:"#666"},
  REVIEW:{bg:"#fef9c3",color:"#ca8a04"},
  APPROVED:{bg:"#dcfce7",color:"#16a34a"},
  SENT:{bg:"#dbeafe",color:"#2563eb"},
}
const STATUS_LABELS: Record<string,string> = {DRAFT:"Rascunho",REVIEW:"Em revisão",APPROVED:"Aprovada",SENT:"Enviada"}

export default function DeliveriesPage() {
  const router = useRouter()
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/deliveries").then(r => r.json()).then(d => { setDeliveries(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  return (
    <PageShell>
      <div style={{padding:32}}>
        <div style={{marginBottom:32}}>
          <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Entregas</h1>
          <p style={{fontSize:12,color:"#888",margin:"4px 0 0"}}>Histórico de exports realizados</p>
        </div>

        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                {["Campanha","Cliente","Formatos","Arquivos","Peso","Data","Status",""].map(h => (
                  <th key={h} style={{textAlign:"left",fontSize:11,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.5px",padding:"8px 16px",borderBottom:"1px solid #E0E0E0"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Carregando...</td></tr>}
              {!loading && deliveries.length === 0 && <tr><td colSpan={8} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Nenhuma entrega realizada</td></tr>}
              {deliveries.map(d => (
                <tr key={d.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                  <td style={{padding:"12px 16px",fontWeight:600,fontSize:13}}>{d.campaign.name}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{d.campaign.client.name}</td>
                  <td style={{padding:"12px 16px"}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {Array.from(new Set(d.files.map(f => f.extension))).map(ext => (
                        <span key={ext} style={{fontSize:10,padding:"2px 6px",background:"#f1f1f1",color:"#666",borderRadius:10,fontWeight:600}}>{ext.toUpperCase()}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{d._count.pieces}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{formatSize(d.totalSize)}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{new Date(d.createdAt).toLocaleDateString("pt-BR")}</td>
                  <td style={{padding:"12px 16px"}}>
                    <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:10,...(STATUS_COLORS[d.status]??{bg:"#f1f1f1",color:"#666"})}}>
                      {STATUS_LABELS[d.status]??d.status}
                    </span>
                  </td>
                  <td style={{padding:"12px 16px",textAlign:"right",display:"flex",gap:6,justifyContent:"flex-end"}}>
                    <button onClick={() => router.push(`/deliveries/${d.id}`)} style={{fontSize:11,fontWeight:600,border:"1px solid #E0E0E0",padding:"4px 10px",borderRadius:5,background:"white",cursor:"pointer"}}>Detalhes</button>
                    <button style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:5,background:"#F5C400",border:"none",cursor:"pointer"}}>↓ ZIP</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  )
}
