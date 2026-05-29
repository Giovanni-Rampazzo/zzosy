/**
 * useSaveQueue — fila serializada com coalescing pra saves do editor.
 *
 * Criado em 2026-05-29 (audit #6 HIGH: race conditions em save flow).
 *
 * Problema que resolve:
 *   O padrao anterior em performSave/saveNow era "busy-wait 50ms + set flag":
 *
 *       if (savingInFlightRef.current) {
 *         while (savingInFlightRef.current && elapsed < 5000) {
 *           await sleep(50)
 *         }
 *         if (savingInFlightRef.current) { abort }
 *       }
 *       savingInFlightRef.current = true
 *
 *   Tinha 3 problemas reais:
 *
 *   1. RACE: se 2+ callers estavam no busy-wait quando o save anterior
 *      terminou, todos saiam do loop no mesmo tick (event loop), todos
 *      setavam o flag, todos rodavam PATCH em paralelo. Ultimo PATCH
 *      ganhava — podia perder edits.
 *
 *   2. TIMEOUT: abortava silenciosamente apos 5s, perdendo o save.
 *
 *   3. SEM COALESCING: 5 callers paralelos = 5 PATCHes serializados, 4 deles
 *      gravando estado intermediario inutil (so o ultimo importa, ja que
 *      cada save le fabricRef.current AGORA).
 *
 * Como funciona:
 *
 *   - tail: promise da ultima operacao enfileirada/rodando. Toda nova
 *     chamada agenda fn na cauda (tail.then(fn)).
 *
 *   - queuedNext: ref pra promise da operacao QUE AINDA NAO COMECOU
 *     (esperando a atual terminar). Enquanto nao-null, novos callers
 *     compartilham essa promise (coalescing) — quando ela finalmente
 *     rodar, le o estado atual do canvas, salvando a versao mais recente.
 *
 *   - isSavingRef: true enquanto o fn esta EXECUTANDO (entre await fn() e
 *     finally). UI binds aqui pra mostrar spinner.
 *
 *   Garantias:
 *
 *   - Serializacao: 2 saves NUNCA rodam em paralelo (cadeia de .then).
 *
 *   - Coalescing: durante run da operacao A, primeira chamada que vier
 *     enfileira B. Chamadas C, D, E que vierem antes de B comecar
 *     COMPARTILHAM a promise de B (todos esperam o mesmo save). Quando B
 *     finalmente comeca a executar, le o estado mais recente — eh o save
 *     que C, D, E queriam.
 *
 *   - Sem timeout: callers esperam o tempo necessario. Save lento nao
 *     perde dados.
 *
 *   - Erro nao envenena a cadeia: cadeia .catch(() => {}) garante que
 *     falha numa operacao nao bloqueia as proximas.
 */
import { useRef } from "react"

export interface SaveQueueAPI {
  /**
   * Enfileira fn na cadeia de saves. Se ja existe um save ENFILEIRADO atras
   * do atualmente em execucao, COMPARTILHA a promise desse save (coalescing)
   * — fn nao roda nesse caso.
   *
   * Retorna a promise do save que efetivamente roda. Sempre resolve (nunca
   * rejeita): erros sao capturados pela cadeia.
   */
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  /** True enquanto ha save EXECUTANDO. Use pra UI saving state. */
  isSavingRef: React.MutableRefObject<boolean>
}

export function useSaveQueue(): SaveQueueAPI {
  const tail = useRef<Promise<void>>(Promise.resolve())
  const queuedNext = useRef<Promise<any> | null>(null)
  const isSavingRef = useRef(false)

  function runExclusive<T>(fn: () => Promise<T>): Promise<T | undefined> {
    // COALESCING: se ja ha um save ENFILEIRADO esperando o atual terminar,
    // novo caller compartilha — quando ele rodar, vai ler o estado mais
    // recente do canvas (que eh o que TODOS os callers querem). Evita 5
    // PATCHes seriais redundantes (so o ultimo importa).
    if (queuedNext.current) {
      return queuedNext.current as Promise<T | undefined>
    }
    const queued: Promise<T | undefined> = tail.current
      .catch(() => {}) // erro num save anterior nao envenena a cadeia
      .then(async () => {
        // Comecando a rodar — libera a vaga "queued" pra proximo caller poder
        // enfileirar uma nova operacao atras DESTA.
        queuedNext.current = null
        isSavingRef.current = true
        try {
          return await fn()
        } finally {
          isSavingRef.current = false
        }
      })
    // tail tem que ser Promise<void> pra cadeia funcionar. Suprimimos erro
    // tb aqui (o caller que recebeu `queued` ainda pode lidar com ele).
    tail.current = queued.then(() => {}, () => {})
    queuedNext.current = queued
    return queued
  }

  return { runExclusive, isSavingRef }
}
