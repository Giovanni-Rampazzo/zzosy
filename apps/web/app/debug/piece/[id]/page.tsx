"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

export default function DebugPiecePage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [now, setNow] = useState<number>(Date.now())
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const r = await fetch(`/api/pieces/${id}?_t=${Date.now()}`, { cache: "no-store" })
    const j = await r.json()
    setData(j)
    setNow(Date.now())
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  if (loading) return <div style={{ padding: 40, fontFamily: "monospace" }}>Carregando…</div>
  if (!data) return <div style={{ padding: 40 }}>Peça não encontrada</div>

  const updatedAtMs = new Date(data.updatedAt).getTime()
  const secondsAgo = Math.floor((now - updatedAtMs) / 1000)
  const parsedData = typeof data.data === "string" ? JSON.parse(data.data) : data.data
  const steps = parsedData?.steps ?? []

  const fresh = secondsAgo < 60
  const stale = secondsAgo > 3600

  return (
    <div style={{ padding: 30, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>🔍 Debug: {data.name}</h1>
      <div style={{ marginBottom: 20, fontSize: 13, color: "#666" }}>
        ID: <code>{id}</code>
      </div>

      <div style={{
        padding: 16, background: fresh ? "#e6ffe6" : stale ? "#ffe6e6" : "#fff8e6",
        border: `2px solid ${fresh ? "#4caf50" : stale ? "#f44336" : "#ff9800"}`,
        borderRadius: 8, marginBottom: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          ⏰ Última atualização: <span style={{ fontSize: 18 }}>
            {secondsAgo < 60 ? `${secondsAgo}s atrás` :
             secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)} min atrás` :
             `${Math.floor(secondsAgo / 3600)}h atrás`}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {new Date(data.updatedAt).toLocaleString("pt-BR")}
        </div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {fresh ? "✅ SAVE FUNCIONOU (timestamp recente)" :
           stale ? "❌ SAVE NÃO RODOU (timestamp muito antigo)" :
           "⚠️ Timestamp dúbio"}
        </div>
      </div>

      <button onClick={load} style={{
        padding: "10px 20px", background: "#F5C400", border: "none",
        borderRadius: 6, fontWeight: 700, cursor: "pointer", marginBottom: 20,
      }}>
        🔄 Atualizar
      </button>

      <h2 style={{ fontSize: 18, marginTop: 30 }}>Thumb principal da peça</h2>
      <div style={{ fontSize: 11, color: "#888", wordBreak: "break-all", marginBottom: 8 }}>
        {data.imageUrl ?? "(null)"}
      </div>
      {data.imageUrl && (
        <img src={`${data.imageUrl}?_t=${now}`} alt="thumb principal" style={{ maxWidth: 300, border: "1px solid #ccc" }} />
      )}

      {steps.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 30 }}>Steps ({steps.length})</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {steps.map((s: any, i: number) => (
              <div key={i} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Step {i + 1}</div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
                  {s.bgColor && <span>bg: <code>{s.bgColor}</code></span>}
                  {" • "}
                  {s.layers?.length ?? 0} layers
                </div>
                <div style={{ fontSize: 10, color: "#888", wordBreak: "break-all", marginBottom: 8 }}>
                  {s.imageUrl ?? "(sem imageUrl)"}
                </div>
                {s.imageUrl && (
                  <img src={`${s.imageUrl}?_t=${now}`} alt={`step ${i + 1}`}
                    style={{ width: "100%", border: "1px solid #ccc", background: "#f5f5f0" }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 18, marginTop: 30 }}>JSON cru</h2>
      <pre style={{ background: "#f5f5f0", padding: 12, borderRadius: 6, fontSize: 11, overflow: "auto", maxHeight: 400 }}>
        {JSON.stringify({ ...data, data: parsedData }, null, 2)}
      </pre>
    </div>
  )
}
