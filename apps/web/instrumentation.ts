/**
 * Next.js boot hook. Roda UMA vez quando o servidor sobe (server/edge runtimes).
 *
 * Hoje:
 *  - Validation eager de env (lib/env.ts faz lazy via Proxy; aqui forcamos
 *    parse no boot pra crash-fast em config invalida em vez de runtime).
 *
 * Futuro (quando voce setar Sentry DSN):
 *  - Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV })
 *  - Storage adapter health check (ping bucket)
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
}
