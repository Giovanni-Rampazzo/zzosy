"use client"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"

const KeyVisionEditor = dynamic(
  () => import("@/components/editor/KeyVisionEditor").then(m => m.KeyVisionEditor),
  {
    ssr: false,
    loading: () => (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1a1a1a",color:"#888",fontSize:14}}>
        Carregando editor...
      </div>
    )
  }
)

function EditorContent() {
  const searchParams = useSearchParams()
  const campaignId = searchParams.get("campaignId") ?? ""
  const pieceId = searchParams.get("pieceId") ?? undefined
  const from = searchParams.get("from") ?? undefined
  if (!campaignId) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#111",color:"white"}}>
      Campaign ID não encontrado
    </div>
  )
  return <KeyVisionEditor campaignId={campaignId} pieceId={pieceId} from={from} />
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1a1a1a",color:"#888",fontSize:14}}>
        Carregando...
      </div>
    }>
      <EditorContent />
    </Suspense>
  )
}
