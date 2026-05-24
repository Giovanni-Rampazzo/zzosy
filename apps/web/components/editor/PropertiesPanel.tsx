"use client"
import { useEffect, useState } from "react"
import { FontPicker, WeightPicker } from "./FontPicker"
import { applyLeadingPtToFabric } from "@/lib/fabricLineHeight"

interface Props {
  selectedObj: any
  fabricRef: React.RefObject<any>
  onUpdate?: (fc: any) => void
  onBgColorChange?: (color: string) => void
}

const BG_SWATCHES = ["#ffffff","#111111","#F5C400","#e63946","#457b9d","#2a9d8f","#264653","#f4a261","#e9c46a","#2d6a4f","#8338ec","#ff006e"]
const TEXT_SWATCHES = ["#ffffff","#111111","#F5C400","#e63946","#457b9d","#2a9d8f","#f4a261","#264653","#8338ec","#ff006e"]

export function PropertiesPanel({ selectedObj, fabricRef, onUpdate, onBgColorChange }: Props) {
  const [fill, setFill] = useState("#111111")
  const [fontSize, setFontSize] = useState(80)
  const [fontFamily, setFontFamily] = useState("Arial")
  const [fontWeight, setFontWeight] = useState("normal")
  const [leadingPt, setLeadingPt] = useState(96)
  const [charSpacing, setCharSpacing] = useState(0)
  const [isEditing, setIsEditing] = useState(false)

  const isBg = selectedObj?.isBackground === true
  const isText = selectedObj?.type === "i-text" || selectedObj?.type === "IText" || selectedObj?.type === "textbox"
  // Smart Object preservado do PSD original. Renderer ZZOSY mostra o preview
  // raster (ag-psd composite) mas os bytes originais ficam intactos em
  // SmartObjectFile pra round-trip ao re-exportar pro Photoshop.
  const isSmartObject = (selectedObj as any)?.__isSmartObject === true
  const soOriginalName = (selectedObj as any)?.__smartObjectOriginalName as string | undefined
  const soMime = (selectedObj as any)?.__smartObjectMime as string | undefined

  useEffect(() => {
    if(!selectedObj) return
    const obj = fabricRef.current?.getObjects().find((o:any) => o === selectedObj || o.layerId === selectedObj.layerId)
    if(!obj) return

    // Se está editando texto, ler estilos da seleção atual
    if(obj.isEditing && obj.selectionStart !== obj.selectionEnd){
      const styles = obj.getSelectionStyles(obj.selectionStart, obj.selectionEnd)
      if(styles.length > 0){
        setFill(styles[0].fill ?? obj.fill ?? "#111111")
        setFontSize(styles[0].fontSize ?? obj.fontSize ?? 80)
        setFontFamily(styles[0].fontFamily ?? obj.fontFamily ?? "Arial")
        setFontWeight(styles[0].fontWeight ?? obj.fontWeight ?? "normal")
        setIsEditing(true)
        return
      }
    }

    setIsEditing(obj.isEditing ?? false)
    setFill(typeof obj.fill === "string" ? obj.fill : "#111111")
    setFontSize(obj.fontSize ?? 80)
    setFontFamily(obj.fontFamily ?? "Arial")
    setFontWeight(obj.fontWeight ?? "normal")
    // leadingPt eh fonte da verdade no editor; se ausente, deriva do lineHeight×fontSize.
    const fs = obj.fontSize ?? 80
    const lpt = typeof obj.leadingPt === "number" && obj.leadingPt > 0
      ? obj.leadingPt
      : Math.round((obj.lineHeight ?? 1.0) * fs)
    setLeadingPt(lpt)
    setCharSpacing(typeof obj.charSpacing === "number" ? obj.charSpacing : 0)
  }, [selectedObj])

  function applyText(key: string, val: any) {
    if(!selectedObj || !fabricRef.current) return
    const obj = fabricRef.current.getObjects().find((o:any) => o === selectedObj || o.layerId === selectedObj.layerId)
    if(!obj) return

    // leadingPt: usa helper centralizado (ajusta lineHeight + _fontSizeMult
    // + ascender pra match pixel-perfect com PSD/Photoshop).
    if(key === "leadingPt"){
      const lpt = +val
      ;(obj as any).leadingPt = lpt
      applyLeadingPtToFabric(obj, lpt)
      obj.setCoords?.()
      setLeadingPt(lpt)
      fabricRef.current.renderAll()
      onUpdate?.(fabricRef.current)
      return
    }

    // Se tem texto selecionado → aplica só na seleção (por caractere)
    if(obj.isEditing && obj.selectionStart !== obj.selectionEnd){
      const style: any = {}
      if(key === "fill") style.fill = val
      if(key === "fontSize") style.fontSize = +val
      if(key === "fontFamily") style.fontFamily = val
      if(key === "fontWeight") style.fontWeight = val
      if(key === "charSpacing") style.charSpacing = +val
      obj.setSelectionStyles(style)
    } else {
      // Aplica no objeto inteiro
      const numericKeys = new Set(["fontSize", "charSpacing"])
      obj.set(key, numericKeys.has(key) ? +val : val)
    }

    if(key === "fill") setFill(val)
    if(key === "fontSize") setFontSize(+val)
    if(key === "fontFamily") setFontFamily(val)
    if(key === "fontWeight") setFontWeight(val)
    if(key === "charSpacing") setCharSpacing(+val)

    fabricRef.current.renderAll()
    onUpdate?.(fabricRef.current)
  }

  const sec = {fontSize:10,fontWeight:700 as const,textTransform:"uppercase" as const,letterSpacing:"0.8px",color:"#555",marginBottom:10}
  const inp = {width:"100%",background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:12,padding:"5px 8px",borderRadius:4,fontFamily:"inherit",outline:"none"} as React.CSSProperties

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflowY:"auto"}}>
      <div style={{padding:"12px 16px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#555",borderBottom:"1px solid #2a2a2a"}}>
        Properties
      </div>

      {!selectedObj ? (
        <div style={{fontSize:11,color:"#444",textAlign:"center",padding:"32px 12px"}}>
          Select an element
        </div>
      ) : isSmartObject ? (
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:"rgba(96,165,250,0.12)",border:"1px solid rgba(96,165,250,0.35)",borderRadius:8}}>
            <div style={{fontSize:14,lineHeight:1}}>{"◇"}</div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#60a5fa",letterSpacing:"0.6px",textTransform:"uppercase"}}>Smart Object</div>
              <div style={{fontSize:10,color:"#777",marginTop:2}}>Preserved from original PSD. Bytes intact on re-export.</div>
            </div>
          </div>
          {soOriginalName && (
            <div style={{fontSize:10,color:"#888"}}>
              <span style={{color:"#555"}}>Original:</span> {soOriginalName}
            </div>
          )}
          {soMime && (
            <div style={{fontSize:10,color:"#888"}}>
              <span style={{color:"#555"}}>Format:</span> {soMime}
            </div>
          )}
          <div style={{fontSize:10,color:"#666",lineHeight:1.5,padding:"8px 10px",background:"#1a1a1a",borderRadius:6,marginTop:4}}>
            Position, scale and effects are editable. The original Smart Object
            content is preserved and re-exported to Photoshop.
          </div>
        </div>
      ) : isBg ? (
        <div style={{padding:16}}>
          <div style={{...sec,color:"#F5C400",marginBottom:12}}>Background</div>
          <input type="color" value={fill}
            onChange={e=>{setFill(e.target.value);onBgColorChange?.(e.target.value)}}
            style={{width:"100%",height:52,cursor:"pointer",border:"none",borderRadius:8,padding:0,background:"transparent"}}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:12}}>
            {BG_SWATCHES.map(c=>(
              <div key={c} onClick={()=>{setFill(c);onBgColorChange?.(c)}}
                style={{width:26,height:26,borderRadius:5,background:c,cursor:"pointer",border:fill===c?"2px solid #F5C400":"2px solid #2a2a2a"}}/>
            ))}
          </div>
        </div>
      ) : isText ? (
        <div style={{padding:16,display:"flex",flexDirection:"column",gap:14}}>
          {isEditing && (
            <div style={{padding:8,background:"rgba(245,196,0,0.1)",borderRadius:6,border:"1px solid rgba(245,196,0,0.3)",fontSize:10,color:"#F5C400"}}>
              Select letters to change individual color/size
            </div>
          )}

          {/* Tipografia agrupada: fonte, peso, tamanho, entrelinha, entreletra
              juntos. User pediu (2026-05-23) — antes só fonte+peso+tamanho
              estavam aqui, entrelinha/entreletra faltavam totalmente. */}
          <div style={{display:"flex",flexDirection:"column",gap:10,padding:12,background:"#0d0d0d",borderRadius:8,border:"1px solid #1f1f1f"}}>
            <div style={{...sec,marginBottom:0,color:"#888"}}>Typography</div>

            <div>
              <FontPicker value={fontFamily} onChange={(f) => applyText("fontFamily", f)} />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{...sec,fontSize:9,marginBottom:4}}>Size</div>
                <div style={{display:"flex",gap:4}}>
                  <button
                    type="button"
                    onClick={()=>applyText("fontSize",String(Math.max(1, Math.round(+fontSize) - 4)))}
                    title="Decrease 4pt"
                    style={{width:28,background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:14,fontWeight:700,borderRadius:4,cursor:"pointer",lineHeight:1}}
                  >−</button>
                  <input type="number" value={fontSize} onChange={e=>applyText("fontSize",e.target.value)} style={{...inp,textAlign:"center"}}/>
                  <button
                    type="button"
                    onClick={()=>applyText("fontSize",String(Math.round(+fontSize) + 4))}
                    title="Increase 4pt"
                    style={{width:28,background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:14,fontWeight:700,borderRadius:4,cursor:"pointer",lineHeight:1}}
                  >+</button>
                </div>
              </div>
              <div>
                <div style={{...sec,fontSize:9,marginBottom:4}}>Weight</div>
                <WeightPicker value={fontFamily} onChange={(f) => applyText("fontFamily", f)} />
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{...sec,fontSize:9,marginBottom:4}} title="Line height in points (PSD/Adobe). Baseline-to-baseline distance.">Line height</div>
                <input
                  type="number"
                  value={leadingPt}
                  min={0}
                  step={1}
                  onChange={e=>applyText("leadingPt", e.target.value)}
                  style={{...inp,textAlign:"center"}}
                  title="Line height in points"
                />
              </div>
              <div>
                <div style={{...sec,fontSize:9,marginBottom:4}} title="Letter spacing (tracking) in thousandths of em. Same unit as Photoshop.">Letter spacing</div>
                <input
                  type="number"
                  value={charSpacing}
                  step={10}
                  onChange={e=>applyText("charSpacing", e.target.value)}
                  style={{...inp,textAlign:"center"}}
                  title="Letter spacing (tracking) in thousandths of em"
                />
              </div>
            </div>
          </div>

          <div>
            <div style={sec}>Color {isEditing?"(selection)":"(entire text)"}</div>
            <input type="color" value={fill} onChange={e=>applyText("fill",e.target.value)}
              style={{width:"100%",height:40,cursor:"pointer",border:"none",borderRadius:6,padding:0,background:"transparent"}}/>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>
              {TEXT_SWATCHES.map(c=>(
                <div key={c} onClick={()=>applyText("fill",c)}
                  style={{width:24,height:24,borderRadius:4,background:c,cursor:"pointer",border:fill===c?"2px solid #F5C400":"2px solid #2a2a2a"}}/>
              ))}
            </div>
          </div>

          <div style={{padding:10,background:"#111",borderRadius:6,fontSize:10,color:"#555",lineHeight:1.5}}>
            Double click = edit text<br/>
            Enter = line break<br/>
            Select letters = change individual color
          </div>
        </div>
      ) : (
        <div style={{padding:16,fontSize:11,color:"#555",textAlign:"center"}}>
          Move and resize on canvas
        </div>
      )}
    </div>
  )
}
