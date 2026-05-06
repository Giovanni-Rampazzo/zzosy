"use client"
import { useEffect, useState } from "react"
import { FontPicker } from "./FontPicker"

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
  const [isEditing, setIsEditing] = useState(false)

  const isBg = selectedObj?.isBackground === true
  const isText = selectedObj?.type === "i-text" || selectedObj?.type === "IText" || selectedObj?.type === "textbox"

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
  }, [selectedObj])

  function applyText(key: string, val: any) {
    if(!selectedObj || !fabricRef.current) return
    const obj = fabricRef.current.getObjects().find((o:any) => o === selectedObj || o.layerId === selectedObj.layerId)
    if(!obj) return
    if (key === "fontFamily") console.log("[FONT-DEBUG] applyText fontFamily", { val, isEditing: obj.isEditing, selStart: obj.selectionStart, selEnd: obj.selectionEnd })

    // Se tem texto selecionado → aplica só na seleção (por caractere)
    if(obj.isEditing && obj.selectionStart !== obj.selectionEnd){
      const style: any = {}
      if(key === "fill") style.fill = val
      if(key === "fontSize") style.fontSize = +val
      if(key === "fontFamily") style.fontFamily = val
      if(key === "fontWeight") style.fontWeight = val
      obj.setSelectionStyles(style)
    } else {
      // Aplica no objeto inteiro
      obj.set(key, key === "fontSize" ? +val : val)
    }

    if(key === "fill") setFill(val)
    if(key === "fontSize") setFontSize(+val)
    if(key === "fontFamily") setFontFamily(val)
    if(key === "fontWeight") setFontWeight(val)

    fabricRef.current.renderAll()
    onUpdate?.(fabricRef.current)
  }

  const sec = {fontSize:10,fontWeight:700 as const,textTransform:"uppercase" as const,letterSpacing:"0.8px",color:"#555",marginBottom:10}
  const inp = {width:"100%",background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:12,padding:"5px 8px",borderRadius:4,fontFamily:"inherit",outline:"none"} as React.CSSProperties

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflowY:"auto"}}>
      <div style={{padding:"12px 16px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#555",borderBottom:"1px solid #2a2a2a"}}>
        Propriedades
      </div>

      {!selectedObj ? (
        <div style={{fontSize:11,color:"#444",textAlign:"center",padding:"32px 12px"}}>
          Selecione um elemento
        </div>
      ) : isBg ? (
        <div style={{padding:16}}>
          <div style={{...sec,color:"#F5C400",marginBottom:12}}>🎨 Background</div>
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
              ✏️ Selecione letras para mudar cor/tamanho individual
            </div>
          )}

          <div>
            <div style={sec}>Fonte</div>
            <FontPicker value={fontFamily} onChange={(f) => applyText("fontFamily", f)} />
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div>
              <div style={sec}>Tamanho</div>
              <div style={{display:"flex",gap:4}}>
                <button
                  type="button"
                  onClick={()=>applyText("fontSize",String(Math.max(1, Math.round(+fontSize) - 4)))}
                  title="Diminuir 4pt"
                  style={{width:28,background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:14,fontWeight:700,borderRadius:4,cursor:"pointer",lineHeight:1}}
                >−</button>
                <input type="number" value={fontSize} onChange={e=>applyText("fontSize",e.target.value)} style={{...inp,textAlign:"center"}}/>
                <button
                  type="button"
                  onClick={()=>applyText("fontSize",String(Math.round(+fontSize) + 4))}
                  title="Aumentar 4pt"
                  style={{width:28,background:"#111",border:"1px solid #2a2a2a",color:"white",fontSize:14,fontWeight:700,borderRadius:4,cursor:"pointer",lineHeight:1}}
                >+</button>
              </div>
            </div>
            <div>
              <div style={sec}>Peso</div>
              <select value={fontWeight} onChange={e=>applyText("fontWeight",e.target.value)} style={inp}>
                <option value="normal">Regular</option>
                <option value="500">Medium</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </div>

          <div>
            <div style={sec}>Cor {isEditing?"(seleção)":"(texto todo)"}</div>
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
            💡 Duplo clique = editar texto<br/>
            Enter = quebrar linha<br/>
            Selecionar letras = mudar cor individual
          </div>
        </div>
      ) : (
        <div style={{padding:16,fontSize:11,color:"#555",textAlign:"center"}}>
          Mova e redimensione no canvas
        </div>
      )}
    </div>
  )
}
