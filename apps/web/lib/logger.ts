/**
 * Logger central pra ZZOSY — niveis + structured logging.
 *
 * Backends:
 *   - Production: Pino (NDJSON em stdout). Railway/Vercel/qualquer container
 *     captura stdout — log aggregators (Axiom, Logtail, Better Stack, Datadog
 *     etc.) tipicamente fazem scrape de stdout direto, ZERO config extra.
 *   - Dev/test: console com formatacao legivel.
 *
 * Hook Sentry: PinoLogger chama Sentry.captureException no nivel "error"
 * quando @sentry/nextjs estiver carregado (verificacao defensiva).
 *
 * Uso:
 *   import { logger } from "@/lib/logger"
 *   logger.info("[psd-import]", "iniciando", { campaignId })
 *   logger.error("[psd-import]", err, { campaignId, file: f.name })
 *
 * Convencao: primeiro arg eh "tag" (ex: "[psd-import]", "[gam]", "[storage]"),
 * pra que log aggregators agrupem.
 */
import pino from "pino"

export interface LogContext {
  [key: string]: unknown
}

type LogLevel = "debug" | "info" | "warn" | "error"

interface LoggerImpl {
  log(level: LogLevel, tag: string, message: unknown, context?: LogContext): void
}

class ConsoleLogger implements LoggerImpl {
  log(level: LogLevel, tag: string, message: unknown, context?: LogContext) {
    // Em prod este caminho nao deveria rodar (PinoLogger captura), mas pra
    // dev/test mantemos formato legivel.
    const fn = level === "error" ? console.error
             : level === "warn" ? console.warn
             : level === "debug" ? console.debug
             : console.info
    if (context && Object.keys(context).length > 0) fn(tag, message, context)
    else fn(tag, message)
  }
}

/**
 * Pino-based logger. Output NDJSON pra stdout. Cada linha tem `level`, `time`,
 * `tag`, `msg`, e contextos arbitrarios.
 *
 * Tenta integrar Sentry se estiver instalado — defensivo via dynamic import,
 * sem hard dep (PROD-04 plug futuro).
 */
class PinoLogger implements LoggerImpl {
  private pino: pino.Logger

  constructor() {
    this.pino = pino({
      level: process.env.LOG_LEVEL || "info",
      // Em prod, formato JSON puro. Sem timestamp ISO custom — Pino default
      // `time: Date.now()` em ms eh suficiente e log aggregators normalizam.
      base: undefined,  // remove `pid`/`hostname` padrao (ruido em logs)
      formatters: {
        level: (label) => ({ level: label }),
      },
    })
  }

  log(level: LogLevel, tag: string, message: unknown, context?: LogContext) {
    const msg = message instanceof Error ? message.message : String(message)
    const stack = message instanceof Error ? message.stack : undefined
    const payload: Record<string, unknown> = { tag, ...context }
    if (stack) payload.stack = stack

    switch (level) {
      case "debug": this.pino.debug(payload, msg); break
      case "info": this.pino.info(payload, msg); break
      case "warn": this.pino.warn(payload, msg); break
      case "error": this.pino.error(payload, msg); break
    }

    // Hook Sentry futuro (PROD-04): se @sentry/nextjs estiver carregado e
    // nivel = error, captura. Defensivo — se Sentry nao estiver instalado,
    // dynamic import falha silencioso. Function-based import escapa do
    // static analysis do TypeScript (modulo eh OPCIONAL — adicionar tipos
    // hard quando PROD-04 instalar @sentry/nextjs de verdade).
    if (level === "error" && process.env.SENTRY_DSN) {
      const dyn = new Function("m", "return import(m)")
      ;(dyn("@sentry/nextjs") as Promise<any>).then((Sentry) => {
        if (message instanceof Error) {
          Sentry.captureException(message, { tags: { area: tag }, extra: context })
        } else {
          Sentry.captureMessage(String(message), { level: "error", tags: { area: tag }, extra: context })
        }
      }).catch(() => { /* @sentry/nextjs nao instalado, ignora */ })
    }
  }
}

// Selecao do impl: prod usa Pino (structured), dev usa console (legivel).
const impl: LoggerImpl = process.env.NODE_ENV === "production"
  ? new PinoLogger()
  : new ConsoleLogger()

export const logger = {
  debug(tag: string, message: unknown, context?: LogContext) { impl.log("debug", tag, message, context) },
  info(tag: string, message: unknown, context?: LogContext) { impl.log("info", tag, message, context) },
  warn(tag: string, message: unknown, context?: LogContext) { impl.log("warn", tag, message, context) },
  error(tag: string, message: unknown, context?: LogContext) { impl.log("error", tag, message, context) },
}
