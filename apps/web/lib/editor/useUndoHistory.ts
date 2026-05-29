/**
 * useUndoHistory — owns refs/state do undo stack do editor + pushHistory.
 *
 * Extraido de KeyVisionEditor.tsx em 2026-05-29 (audit #5 HIGH).
 *
 * O que esta DENTRO do hook:
 *   - undoStack / redoStack (refs com snapshots JSON)
 *   - isApplyingHistory (ref boolean — gate pra todos os listeners do canvas
 *     nao re-pushar durante restore)
 *   - applySnapshotSeq (ref counter — usado por rebakes de raster mask pra
 *     detectar Cmd+Z duplo em <100ms e cancelar o rebake do snap antigo)
 *   - historyTick (state — re-renderiza botoes Undo/Redo)
 *   - pushHistory(opts) — captura snapshot do canvas via toObject() +
 *     HISTORY_PROPS_TO_INCLUDE, dedupa contra topo, mantem N=100 entradas
 *
 * O que FICA no editor (tightly coupled):
 *   - applySnapshot — interage com loadFromJSON, mask rebake, brand resync,
 *     saveTimer cancel, listeners attach/detach. Refactor isolado nao roda.
 *   - undo / redo — wrappers que chamam applySnapshot
 *   - listeners do canvas (object:modified etc) que chamam pushHistory
 *
 * Risco: pushHistory tem DIAGNOSTICO multi-obj override (linhas 2929-2971 do
 * KeyVisionEditor original) que detecta acoes silenciosas. Preservado integro.
 */
import { useRef, useState } from "react"
import { HISTORY_PROPS_TO_INCLUDE } from "@/lib/editor/canvasOverlays"

interface UseUndoHistoryOpts {
  /** Ref pro Fabric canvas. pushHistory le fabricRef.current. */
  fabricRef: React.MutableRefObject<any>
  /** Callback executado quando o snap eh PUSHADO (markDirty=true). Editor
   *  usa pra setIsDirty + isDirtyRef.current = true. Quando markDirty=false
   *  (push de selecao apenas), nao eh chamado. */
  onMarkDirty: () => void
  /** Extrai os ids da selecao atual (estavel via __assetId/__assetLabel).
   *  Sera serializado em canvasObj._selection pra applySnapshot restaurar. */
  getCurrentSelectionIds: (fc: any) => string[]
}

export interface UndoHistoryAPI {
  undoStack: React.MutableRefObject<string[]>
  redoStack: React.MutableRefObject<string[]>
  isApplyingHistory: React.MutableRefObject<boolean>
  applySnapshotSeq: React.MutableRefObject<number>
  historyTick: number
  setHistoryTick: React.Dispatch<React.SetStateAction<number>>
  pushHistory: (opts?: { markDirty?: boolean }) => void
}

export function useUndoHistory(opts: UseUndoHistoryOpts): UndoHistoryAPI {
  const { fabricRef, onMarkDirty, getCurrentSelectionIds } = opts
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  // historyTick: forca re-render dos botoes undo/redo quando push/undo/redo
  // mudam os tamanhos das pilhas (que sao refs, nao reativos).
  const [historyTick, setHistoryTick] = useState(0)
  // Flag GLOBAL pra todos os listeners do canvas saberem "nao pushHistory
  // durante restore" (object:modified, brand sync, selection change, etc).
  const isApplyingHistory = useRef(false)
  // Counter incrementado a cada applySnapshot. Rebakes de raster mask em
  // voo verificam mySeq != applySnapshotSeq.current → cancelam (Cmd+Z
  // duas vezes em <100ms invalida o rebake do snap intermediario).
  const applySnapshotSeq = useRef(0)

  function pushHistory(o?: { markDirty?: boolean }) {
    if (isApplyingHistory.current) return
    const fc = fabricRef.current
    if (!fc) return
    const markDirty = o?.markDirty !== false
    try {
      // ORPHAN HANDLING: detecta orfaos (objs sem __assetId/__embedded), MAS
      // nao pula o push — snap eh salvo mesmo com orfao transitorio pra
      // manter continuidade temporal do stack. saveNow + health-cleanup
      // de applySnapshot tratam separado.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphans.length > 0) {
        console.warn("[pushHistory] aviso —", orphans.length, "objetos orfaos detectados. Snapshot ainda eh salvo (continuidade temporal preservada).")
      }
      const canvasObj = (fc as any).toObject(HISTORY_PROPS_TO_INCLUDE)
      // _selection: ids dos objs ativos (estavel via __assetId/__assetLabel).
      // Restaurado em applySnapshot.
      canvasObj._selection = getCurrentSelectionIds(fc)
      const snap = JSON.stringify(canvasObj)
      // Dedup contra topo.
      const top = undoStack.current[undoStack.current.length - 1]
      if (top === snap) return
      // DIAGNOSTICO: detecta mod silenciosa de OVERRIDE props em MULTIPLOS objs.
      // Multi-select drag/scale eh normal (transform props); override em 2+
      // simultaneamente = bug real ("undo reseta override de outro layer").
      try {
        if (top) {
          const prevObjs: any[] = JSON.parse(top)?.objects ?? []
          const newObjs: any[] = JSON.parse(snap)?.objects ?? []
          const keyOf = (o: any) => o?.__assetId ?? o?.__assetLabel ?? `${o?.type}@${Math.round(o?.left ?? 0)},${Math.round(o?.top ?? 0)}`
          const prevByKey = new Map<string, any>()
          for (const o of prevObjs) prevByKey.set(keyOf(o), o)
          // Props que SO mudam por acao direta em 1 layer — excluidas
          // transform (multi-select OK) + fontSize/lineHeight (recalculo).
          const OVERRIDE_PROPS = [
            "fill", "fontFamily", "fontWeight", "fontStyle",
            "charSpacing", "textAlign", "text",
          ]
          const overrideChanges: Array<{ label: string; diffs: string[] }> = []
          for (const newObj of newObjs) {
            const prev = prevByKey.get(keyOf(newObj))
            if (!prev) continue
            const diffs: string[] = []
            for (const k of OVERRIDE_PROPS) {
              if (JSON.stringify(prev[k]) !== JSON.stringify(newObj[k])) diffs.push(k)
            }
            if (JSON.stringify(prev.styles ?? {}) !== JSON.stringify(newObj.styles ?? {})) diffs.push("styles")
            if (diffs.length > 0) overrideChanges.push({ label: newObj.__assetLabel ?? "?", diffs })
          }
          if (overrideChanges.length > 1) {
            console.warn("[pushHistory] MULTI-OBJ OVERRIDE DIFF — provavel mod silenciosa de fill/font/text em multiplos layers:", overrideChanges)
          }
        }
      } catch { /* diagnostico nao critico */ }
      undoStack.current.push(snap)
      // Cap 100 entradas. ~50KB/snap × 100 = ~5MB de memoria.
      if (undoStack.current.length > 101) undoStack.current.shift()
      redoStack.current = []
      setHistoryTick(t => t + 1)
      // markDirty=false em pushes que sao SO de selecao (UI state).
      if (markDirty) onMarkDirty()
    } catch { /* ignora */ }
  }

  return {
    undoStack,
    redoStack,
    isApplyingHistory,
    applySnapshotSeq,
    historyTick,
    setHistoryTick,
    pushHistory,
  }
}
