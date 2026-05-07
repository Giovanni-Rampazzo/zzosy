import { signOut } from "next-auth/react"

/**
 * Wrapper de fetch que detecta sessoes invalidas (STALE_SESSION quando o backend
 * retorna 401 com code: "STALE_SESSION", indicando que o tenantId/user da sessao
 * nao existem mais — geralmente apos um reset do banco).
 *
 * Quando detecta, faz signOut automatico e redireciona pra /login.
 */
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) {
    // Tenta ler body pra ver se eh STALE_SESSION
    try {
      const cloned = res.clone()
      const text = await cloned.text()
      if (text) {
        const data = JSON.parse(text)
        if (data?.code === "STALE_SESSION") {
          console.warn("[apiFetch] sessao invalida detectada, fazendo signOut")
          await signOut({ callbackUrl: "/login" })
        }
      }
    } catch { /* body nao eh JSON, ignora */ }
  }
  return res
}
