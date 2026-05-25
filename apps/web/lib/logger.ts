/**
 * Logger central pra ZZOSY — wrapper sobre console com niveis + hook pra
 * provider externo (Sentry/Pino/Axiom) futuro.
 *
 * Hoje: writes pra console.{info,warn,error,debug} com prefixo padronizado.
 * Amanha (prod): plug Sentry/Logtail trocando a implementacao interna
 * SEM mudar caller code. Igual padrao storage adapter.
 *
 * Uso:
 *   import { logger } from "@/lib/logger"
 *   logger.info("[psd-import]", "iniciando", { campaignId })
 *   logger.error("[psd-import]", err, { campaignId, file: f.name })
 *
 * Convencao: primeiro arg eh "tag" (ex: "[psd-import]", "[gam]", "[storage]"),
 * pra que log aggregators consigam agrupar.
 */

export interface LogContext {
  [key: string]: unknown
}

type LogLevel = "debug" | "info" | "warn" | "error"

interface LoggerImpl {
  log(level: LogLevel, tag: string, message: unknown, context?: LogContext): void
}

/** Console-based default. Vira no-op pra `debug` em prod. */
class ConsoleLogger implements LoggerImpl {
  log(level: LogLevel, tag: string, message: unknown, context?: LogContext) {
    const isProd = process.env.NODE_ENV === "production"
    // Em prod, suprime debug (ruido em logs caros).
    if (level === "debug" && isProd) return
    const fn = level === "error" ? console.error
             : level === "warn" ? console.warn
             : level === "debug" ? console.debug
             : console.info
    if (context && Object.keys(context).length > 0) {
      fn(tag, message, context)
    } else {
      fn(tag, message)
    }
  }
}

/**
 * Stub Sentry — wrapper que CHAMA Sentry quando ele estiver inicializado, mas
 * por enquanto so console. Quando voce instalar @sentry/nextjs + setar DSN:
 *   1. Sentry.init({ dsn }) no instrumentation.ts
 *   2. Substituir esta classe por uma que chama Sentry.captureException pra
 *      nivel "error"
 * Sem trocar nenhum caller.
 */
class SentryStubLogger implements LoggerImpl {
  private base = new ConsoleLogger()
  log(level: LogLevel, tag: string, message: unknown, context?: LogContext) {
    this.base.log(level, tag, message, context)
    // FUTURO: if (level === "error") Sentry.captureException(message, { tags: { area: tag }, extra: context })
    // FUTURO: if (level === "warn") Sentry.captureMessage(String(message), "warning")
  }
}

const impl: LoggerImpl = new SentryStubLogger()

export const logger = {
  debug(tag: string, message: unknown, context?: LogContext) { impl.log("debug", tag, message, context) },
  info(tag: string, message: unknown, context?: LogContext) { impl.log("info", tag, message, context) },
  warn(tag: string, message: unknown, context?: LogContext) { impl.log("warn", tag, message, context) },
  error(tag: string, message: unknown, context?: LogContext) { impl.log("error", tag, message, context) },
}
