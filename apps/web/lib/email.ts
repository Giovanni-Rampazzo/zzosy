/**
 * Email transacional via Resend.
 *
 * Sem RESEND_API_KEY no env: send() loga + retorna sem mandar (dev mode).
 * Em prod com API key: envia de verdade.
 *
 * EMAIL_FROM: remetente padrao (precisa ser dominio verificado no Resend).
 *
 * Templates: HTML inline simples. Pra templates ricos no futuro, migrar
 * pra @react-email/components (mantem React JSX → HTML email-safe).
 */
import { Resend } from "resend"
import { logger } from "@/lib/logger"

const apiKey = process.env.RESEND_API_KEY
const from = process.env.EMAIL_FROM || "ZZOSY <noreply@zzosy.com>"
const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://app.zzosy.com"

const enabled = !!apiKey
const client = enabled ? new Resend(apiKey) : null

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string  // fallback text/plain pra clients sem HTML
}

export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!enabled || !client) {
    logger.warn("[email]", "RESEND_API_KEY nao setado — email NAO enviado", { to: params.to, subject: params.subject })
    return { ok: false, error: "EMAIL_DISABLED" }
  }
  try {
    const { data, error } = await client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? stripHtml(params.html),
    })
    if (error) {
      logger.error("[email]", "send falhou", { to: params.to, error: error.message })
      return { ok: false, error: error.message }
    }
    return { ok: true, id: data?.id }
  } catch (e: any) {
    logger.error("[email]", e, { to: params.to })
    return { ok: false, error: e?.message ?? "unknown" }
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

// ── Templates ────────────────────────────────────────────────────────────

export function sendPasswordResetEmail(to: string, resetUrl: string) {
  const html = baseLayout({
    title: "Redefinir senha — ZZOSY",
    bodyHtml: `
      <p>Recebemos um pedido para redefinir a senha da sua conta ZZOSY.</p>
      <p>Clique no botão abaixo para criar uma nova senha:</p>
      <p style="margin: 32px 0;">
        <a href="${resetUrl}" style="background:#F5C400; color:#111; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">
          Redefinir senha
        </a>
      </p>
      <p style="font-size:12px; color:#666;">O link expira em <strong>1 hora</strong>.</p>
      <p style="font-size:12px; color:#666;">Se você não pediu, ignore este email — sua senha continua a mesma.</p>
      <p style="font-size:11px; color:#999; word-break:break-all; margin-top:24px;">
        Se o botão não funcionar, copie e cole no navegador:<br>
        <span style="color:#555;">${resetUrl}</span>
      </p>
    `,
  })
  return sendEmail({
    to,
    subject: "Redefinir senha — ZZOSY",
    html,
  })
}

export function sendWelcomeEmail(to: string, name: string) {
  const html = baseLayout({
    title: "Bem-vindo ao ZZOSY",
    bodyHtml: `
      <p>Olá, <strong>${escapeHtml(name)}</strong>!</p>
      <p>Sua conta no ZZOSY foi criada com sucesso.</p>
      <p style="margin: 24px 0;">
        <a href="${appUrl}" style="background:#F5C400; color:#111; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; display:inline-block;">
          Abrir ZZOSY
        </a>
      </p>
      <p style="font-size:12px; color:#666;">
        Dúvidas? Responda este email — nosso time lê e responde rápido.
      </p>
    `,
  })
  return sendEmail({
    to,
    subject: "Bem-vindo ao ZZOSY",
    html,
  })
}

function baseLayout(opts: { title: string; bodyHtml: string }): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0; padding:0; background:#F5F5F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#222;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F0; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px; background:white; border-radius:12px; border:1px solid #E0E0E0; padding:32px;" cellpadding="0" cellspacing="0" border="0">
        <tr><td>
          <div style="font-size:22px; font-weight:800; color:#111; letter-spacing:-0.5px; margin-bottom:24px;">ZZOSY</div>
          ${opts.bodyHtml}
        </td></tr>
      </table>
      <div style="font-size:11px; color:#999; margin-top:24px;">
        © ${new Date().getFullYear()} ZZOSY · Automação de layout para campanhas
      </div>
    </td></tr>
  </table>
</body>
</html>
  `.trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
}

export const emailEnabled = enabled
