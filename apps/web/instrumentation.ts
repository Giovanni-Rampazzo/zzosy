/**
 * Next.js boot hook. Roda UMA vez quando o servidor sobe (server/edge runtimes).
 *
 * Hoje:
 *  - Validation eager de env (lib/env.ts faz lazy via Proxy; aqui forcamos
 *    parse no boot pra crash-fast em config invalida em vez de runtime).
 *  - Sentry init via import dos arquivos sentry.{server,edge}.config.ts
 *    (no-op se SENTRY_DSN nao setado).
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry server config — import auto-init. Sem DSN, init eh no-op.
    await import("./sentry.server.config")

    // Eager validation de env — forca parse pra crash-fast.
    const { env } = await import("@/lib/env")
    const { logger } = await import("@/lib/logger")
    try {
      // Access pra trigger Proxy → parseEnv
      void env.DATABASE_URL
      logger.info("[boot]", `env validated, NODE_ENV=${env.NODE_ENV}, STORAGE_DRIVER=${env.STORAGE_DRIVER}`)
    } catch (e) {
      logger.error("[boot]", "env validation failed", { error: (e as Error).message })
      throw e // re-throw — app NAO deve subir com env invalida
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

// @sentry/nextjs hook pro Next.js capturar request errors automaticamente.
// Sem essa export, Sentry nao recebe erros de Server Components / Route Handlers.
export async function onRequestError(err: unknown, request: unknown, context: unknown) {
  const { captureRequestError } = await import("@sentry/nextjs")
  captureRequestError(err, request as any, context as any)
}
