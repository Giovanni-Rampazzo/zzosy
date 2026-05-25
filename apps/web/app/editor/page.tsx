"use client"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { MobileWarning } from "@/components/editor/MobileWarning"

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
  // stepIndex opcional: quando user clica num step especifico na apresentacao,
  // queremos abrir o editor JA naquele step (em vez do activeStepIndex salvo).
  const stepIndexParam = searchParams.get("stepIndex")
  const initialStepIndex = stepIndexParam != null && !Number.isNaN(parseInt(stepIndexParam, 10))
    ? parseInt(stepIndexParam, 10)
    : undefined
  // openGenerator=1: vem do botao "Gerar peca" em /campaigns/[id]. Abre o
  // modal de geracao automaticamente depois do init.
  const openGenerator = searchParams.get("openGenerator") === "1"
  if (!campaignId) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#111",color:"white"}}>
      Campaign ID não encontrado
    </div>
  )
  return <KeyVisionEditor campaignId={campaignId} pieceId={pieceId} from={from} initialStepIndex={initialStepIndex} openGenerator={openGenerator} />
}

export default function EditorPage() {
  return (
    <>
      <MobileWarning />
      <Suspense fallback={
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1a1a1a",color:"#888",fontSize:14}}>
          Carregando...
        </div>
      }>
        <EditorContent />
      </Suspense>
    </>
  )
}
