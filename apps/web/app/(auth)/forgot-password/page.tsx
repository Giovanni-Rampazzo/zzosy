"use client"
import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setSent(true)
      } else {
        const j = await res.json().catch(() => ({}))
        if (res.status === 429) setError("Muitas tentativas. Tente em alguns minutos.")
        else setError(j?.error ?? "Falha ao processar pedido")
      }
    } catch {
      setError("Erro de rede")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-4">
      <div className="w-full max-w-md bg-[#171717] border-2 border-[#333] rounded-xl p-8">
        <div className="text-white text-lg font-bold mb-2">Recuperar senha</div>
        <p className="text-[#888] text-[13px] mb-6">
          Informe seu e-mail e enviaremos um link pra criar uma nova senha.
        </p>
        {sent ? (
          <div>
            <div className="bg-[#1a3320] border border-[#2d6a3e] rounded-lg p-4 text-[#a8e8b6] text-[13px] mb-6">
              Se o e-mail estiver cadastrado, você receberá um link em alguns minutos.
              <br /><br />
              O link expira em 1 hora.
            </div>
            <Link href="/login" className="block text-center text-[#F5C400] text-[13px]">
              ← Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-[#bbb] text-[12px] mb-1 block">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full bg-[#0a0a0a] border-2 border-[#333] rounded-md px-3 py-2 text-white text-[14px] outline-none focus:border-[#F5C400]"
              />
            </div>
            {error && <p className="text-red-400 text-[12px]">{error}</p>}
            <Button type="submit" variant="primary" loading={loading} className="w-full mt-2">
              {loading ? "Enviando..." : "Enviar link"}
            </Button>
            <Link href="/login" className="block text-center text-[#888] text-[12px] mt-2">
              ← Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
