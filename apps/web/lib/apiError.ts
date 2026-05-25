import { NextResponse } from "next/server"

/**
 * Helper centralizado pra retornar erros de rota API com shape consistente.
 *
 * Antes (audit F5.3):
 *   - Algumas rotas retornavam `{ error: "..." }`, outras `{ detail: ... }`,
 *     outras `{ message }`, outras `{ error: e.message }` (leak de stack).
 *   - Mix PT/EN ("Not found" vs "nao encontrado" vs "Não autenticado").
 *
 * Agora: todos os erros respondem `{ error: <PT mensagem>, code?: <opcional> }`.
 * O `code` eh string estavel pra UI tratar casos especificos (ex: STALE_SESSION).
 */
export function apiError(message: string, status: number, opts?: { code?: string }) {
  const body: Record<string, unknown> = { error: message }
  if (opts?.code) body.code = opts.code
  return NextResponse.json(body, { status })
}

export const apiErrors = {
  unauthorized: () => apiError("Não autenticado", 401),
  forbidden: (msg: string = "Sem permissão") => apiError(msg, 403),
  notFound: (msg: string = "Não encontrado") => apiError(msg, 404),
  badRequest: (msg: string, opts?: { code?: string }) => apiError(msg, 400, opts),
  internal: (msg: string = "Erro interno") => apiError(msg, 500),
  tooManyRequests: (retryAfterSeconds: number = 60) => {
    const res = apiError(`Limite de requisições excedido. Tente novamente em ${retryAfterSeconds}s.`, 429, { code: "RATE_LIMITED" })
    res.headers.set("Retry-After", String(retryAfterSeconds))
    return res
  },
}
