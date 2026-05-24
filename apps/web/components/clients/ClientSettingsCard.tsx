"use client"
/**
 * Card de "Configurações" exibido na pagina do cliente. As 3 listas
 * (segments, categories, filters) sao GLOBAIS por tenant — viva uma so vez,
 * compartilhadas entre TODOS os clientes/campanhas/pecas/midias do tenant.
 *
 * Fica na pagina do cliente porque eh la que o user gerencia "configuracoes
 * do meu workspace", mas o backend persiste em Tenant.taxonomy.
 *
 * Cada lista tem:
 *   - Input "+" pra adicionar valor novo (Enter ou click)
 *   - Chips com X pra remover
 *   - Auto-save: debounce 600ms apos qualquer mudanca
 */
import { useEffect, useRef, useState } from "react"

interface Taxonomy {
  segments?: string[]
  categories?: string[]
  filters?: string[]
  statuses?: string[]
}

interface Props {
  initial?: Taxonomy
  /** Callback opcional pra exibir status (saving/saved) no header externo. */
  onStatusChange?: (status: "idle" | "saving" | "saved") => void
}

const FIELDS: Array<{ key: keyof Taxonomy; label: string; placeholder: string }> = [
  { key: "segments", label: "Segmentos", placeholder: "Ex: Black Friday, Volta às Aulas" },
  { key: "categories", label: "Áreas", placeholder: "Ex: Marketing, Comercial, RH" },
  { key: "filters", label: "Filtros", placeholder: "Ex: Storytelling, Lançamento" },
  { key: "statuses", label: "Status", placeholder: "Ex: Em revisão, Aprovado, Entregue" },
]

export function ClientSettingsCard({ initial, onStatusChange }: Props) {
  const [data, setData] = useState<Taxonomy>({
    segments: Array.isArray(initial?.segments) ? initial!.segments! : [],
    categories: Array.isArray(initial?.categories) ? initial!.categories! : [],
    filters: Array.isArray(initial?.filters) ? initial!.filters! : [],
    statuses: Array.isArray(initial?.statuses) ? initial!.statuses! : [],
  })
  const [inputs, setInputs] = useState<Taxonomy>({ segments: [""], categories: [""], filters: [""], statuses: [""] })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // dirty = user mexeu (addItem/removeItem) APOS o fetch inicial dar OK.
  // Auto-save SO dispara quando dirty=true. Sem isso, se o fetch falhasse
  // (sessao expirada, network), o componente disparava PATCH com data
  // vazio default e ZERAVA a taxonomia do tenant no banco.
  const dirty = useRef(false)
  const saveTimer = useRef<any>(null)

  // Fetch taxonomia global do tenant no mount (mesmo se initial veio, garante
  // sincronia com outras abas/pecas que tenham feito auto-merge).
  useEffect(() => {
    let cancelled = false
    fetch("/api/tenant/taxonomy")
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json) return
        setData({
          segments: Array.isArray(json.segments) ? json.segments : [],
          categories: Array.isArray(json.categories) ? json.categories : [],
          filters: Array.isArray(json.filters) ? json.filters : [],
          statuses: Array.isArray(json.statuses) ? json.statuses : [],
        })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!dirty.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      onStatusChange?.("saving")
      try {
        const res = await fetch(`/api/tenant/taxonomy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          setSavedAt(Date.now())
          onStatusChange?.("saved")
          setTimeout(() => { setSavedAt(null); onStatusChange?.("idle") }, 2000)
        } else {
          onStatusChange?.("idle")
        }
      } finally { setSaving(false) }
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [data, onStatusChange])

  function addItem(field: keyof Taxonomy, raw: string) {
    const value = raw.trim()
    if (!value) return
    let changed = false
    setData(prev => {
      const list = Array.isArray(prev[field]) ? prev[field]! : []
      if (list.some(v => v.trim().toLowerCase() === value.toLowerCase())) return prev
      changed = true
      return { ...prev, [field]: [...list, value] }
    })
    if (changed) dirty.current = true
    setInputs(prev => ({ ...prev, [field]: [""] }))
  }

  function removeItem(field: keyof Taxonomy, index: number) {
    dirty.current = true
    setData(prev => {
      const list = Array.isArray(prev[field]) ? prev[field]! : []
      return { ...prev, [field]: list.filter((_, i) => i !== index) }
    })
  }

  return (
    <div>
      <p style={{fontSize:12,color:"#666",margin:"0 0 18px",lineHeight:1.5}}>
        Listas globais usadas em todas as empresas, campanhas e peças. Valores criados
        em qualquer entidade são adicionados aqui automaticamente. Edite ou remova
        a qualquer momento.
      </p>
      {/* Layout vertical (2026-05-24): cada lista em sua propria row full-width.
          Antes era grid 4 colunas que overflowava + faltava espaco pros chips. */}
      <div style={{display:"flex",flexDirection:"column",gap:0}}>
        {FIELDS.map(({key, label, placeholder}, idx) => {
          const list = Array.isArray(data[key]) ? data[key]! : []
          const inputValue = (inputs[key]?.[0]) ?? ""
          return (
            <div
              key={key}
              style={{
                display:"grid",
                gridTemplateColumns:"110px 1fr",
                gap:16,
                alignItems:"start",
                padding:"14px 0",
                borderTop: idx === 0 ? "none" : "1px solid #F0F0F0",
              }}
            >
              {/* Coluna esquerda: titulo da lista (label uppercase) */}
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",color:"#666",paddingTop:6}}>{label}</div>
              {/* Coluna direita: input + botao + chips empilhados */}
              <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:0}}>
                <div style={{display:"flex",gap:6}}>
                  <input
                    value={inputValue}
                    onChange={e => setInputs(prev => ({...prev, [key]: [e.target.value]}))}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addItem(key, inputValue)
                      }
                    }}
                    placeholder={placeholder}
                    style={{flex:1,padding:"7px 10px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit",minWidth:0}}
                  />
                  <button
                    type="button"
                    onClick={() => addItem(key, inputValue)}
                    disabled={!inputValue.trim()}
                    style={{
                      padding:"7px 14px",
                      border:"1px solid #D0D0D0", borderRadius:6,
                      background: inputValue.trim() ? "#F5C400" : "#F0F0F0",
                      color: inputValue.trim() ? "#111" : "#999",
                      fontSize:13, fontWeight:700,
                      cursor: inputValue.trim() ? "pointer" : "not-allowed",
                    }}
                  >+ Adicionar</button>
                </div>
                {list.length > 0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {list.map((v, i) => (
                      <div key={`${key}-${i}-${v}`} style={{
                        display:"inline-flex",alignItems:"center",gap:4,
                        padding:"3px 4px 3px 10px",borderRadius:14,
                        background:"#F5F5F0",border:"1px solid #E0E0E0",
                        fontSize:12,color:"#333",
                      }}>
                        <span>{v}</span>
                        <button
                          type="button"
                          onClick={() => removeItem(key, i)}
                          title="Remover"
                          style={{
                            background:"transparent",border:"none",cursor:"pointer",
                            color:"#999",fontSize:14,padding:"0 4px",lineHeight:1,
                          }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
