/**
 * Sentry — client-side (browser) config. Carregado automaticamente pelo
 * Next.js. NEXT_PUBLIC_SENTRY_DSN exposto pro bundle do cliente (necessario
 * pra Sentry funcionar no navegador).
 *
 * Sem env: no-op. Sample rate baixo em prod.
 */
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
  // Replay: opcional, util pra reproduzir bugs do user. Caro em quota.
  // Ligar quando tiver volume real e plano pago.
  // replaysSessionSampleRate: 0,
  // replaysOnErrorSampleRate: 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
})
