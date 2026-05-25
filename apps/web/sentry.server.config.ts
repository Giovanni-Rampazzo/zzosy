/**
 * Sentry — server-side config. Carregado automaticamente pelo Next.js
 * via @sentry/nextjs. Sem SENTRY_DSN env: init eh no-op, captureException
 * tambem (Sentry SDK trata isso internamente).
 *
 * Sample rate baixo em prod pra nao explodir quota free tier. Ajustar
 * conforme volume + plano contratado.
 */
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  // Capturar logs nao tratados (rejection promises, uncaught exceptions)
  // ja vem ligado por default.
  enabled: !!process.env.SENTRY_DSN,
})
