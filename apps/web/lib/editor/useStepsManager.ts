/**
 * useStepsManager — owns state/refs do conceito de "steps" do editor.
 *
 * Extraido de KeyVisionEditor.tsx em 2026-05-29 (audit #5 HIGH).
 *
 * O que esta DENTRO do hook:
 *   - stepCount state + ref espelho
 *   - activeStepIndex state + ref espelho
 *   - inactiveStepsRef (buffer dos steps inativos — array com length =
 *     stepCount - 1)
 *   - setStepCountSync / setActiveStepIndexSync (mantem state e ref em
 *     sincrono — caller NUNCA chama setStepCount diretamente pra nao
 *     quebrar o ref que performSave/doSaveNow leem)
 *
 * O que FICA no editor (tightly coupled com Fabric canvas):
 *   - loadStepIntoCanvas (~70 linhas — limpa objetos, recria Rects BG,
 *     re-cria layers via addAssetToCanvas, sync espelhos legacy)
 *   - switchToStep / addStep / removeStep (chamam loadStepIntoCanvas +
 *     manipulam estado via setters do hook)
 *   - save flow (performSave grava data.steps[]=... + activeStepIndex)
 */
import { useRef, useState } from "react"

export interface InactiveStep {
  layers: any[]
  bgColor: string
  bgOpacity?: number
  thumbnailUrl?: string | null
  imageUrl?: string | null
}

export interface StepsManagerAPI {
  stepCount: number
  activeStepIndex: number
  stepCountRef: React.MutableRefObject<number>
  activeStepIndexRef: React.MutableRefObject<number>
  inactiveStepsRef: React.MutableRefObject<InactiveStep[]>
  setStepCountSync: (next: number | ((prev: number) => number)) => void
  setActiveStepIndexSync: (next: number | ((prev: number) => number)) => void
}

export function useStepsManager(): StepsManagerAPI {
  // States — React batched. Use sempre os refs em leitura sincrona dentro de
  // performSave/doSaveNow/addStep, NUNCA setX direto sem o ref ficar stale.
  const [stepCount, setStepCount] = useState(1)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const stepCountRef = useRef(1)
  const activeStepIndexRef = useRef(0)
  // Buffer dos steps NAO ativos (o ativo vive no Fabric canvas). Length sempre
  // = stepCount - 1.
  const inactiveStepsRef = useRef<InactiveStep[]>([])

  function setStepCountSync(next: number | ((prev: number) => number)) {
    const value = typeof next === "function" ? (next as any)(stepCountRef.current) : next
    stepCountRef.current = value
    setStepCount(value)
  }
  function setActiveStepIndexSync(next: number | ((prev: number) => number)) {
    const value = typeof next === "function" ? (next as any)(activeStepIndexRef.current) : next
    activeStepIndexRef.current = value
    setActiveStepIndex(value)
  }

  return {
    stepCount, activeStepIndex,
    stepCountRef, activeStepIndexRef, inactiveStepsRef,
    setStepCountSync, setActiveStepIndexSync,
  }
}
