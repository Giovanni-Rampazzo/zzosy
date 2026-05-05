"use client"

interface Layer { id:string;label:string;type:string;locked:boolean;isBackground:boolean;obj:any }
interface Props {
  layers: Layer[]
  selectedObj: any
  onSelect: (id:string)=>void
  onDelete: (id:string)=>void
}

export function LayerPanel({ layers, selectedObj, onSelect, onDelete }: Props) {
  function getDot(layer:Layer) {
    if(layer.isBackground) return "#888"
    if(layer.type==="i-text"||layer.type==="IText") return "#F5C400"
    return "#86efac"
  }

  return (
    <div style={{width:200,background:"#1a1a1a",borderRight:"1px solid #222",display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"12px 16px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#555",borderBottom:"1px solid #222"}}>
        Layers
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"4px 0"}}>
        {layers.length===0&&(
          <div style={{fontSize:11,color:"#444",textAlign:"center",padding:"32px 12px"}}>
            Nenhum layer.<br/>Adicione assets acima.
          </div>
        )}
        {layers.map(layer=>{
          const isSel=selectedObj?.layerId===layer.id
          return (
            <div key={layer.id} onClick={()=>onSelect(layer.id)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",
                background:isSel?"rgba(245,196,0,0.08)":"transparent",
                borderLeft:isSel?"2px solid #F5C400":"2px solid transparent"}}
            >
              <div style={{width:7,height:7,borderRadius:2,background:getDot(layer),flexShrink:0}}/>
              <span style={{fontSize:12,color:isSel?"#fff":"#888",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {layer.isBackground?"🎨 ":""}{layer.label}
              </span>
              {!layer.isBackground&&(
                <button
                  onClick={e=>{e.stopPropagation();onDelete(layer.id)}}
                  style={{color:"#555",background:"transparent",border:"none",cursor:"pointer",fontSize:12,padding:"0 2px",lineHeight:1,opacity:0,transition:"opacity 0.1s"}}
                  onMouseOver={e=>(e.currentTarget.style.opacity="1")}
                  onMouseOut={e=>(e.currentTarget.style.opacity="0")}
                >✕</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
