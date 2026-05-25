"use client"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("Senha deve ter no minimo 8 caracteres")
      return
    }
    if (password !== confirm) {
      setError("Senhas nao conferem")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      if (res.ok) {
        setDone(true)
        setTimeout(() => router.push("/login"), 2500)
      } else {
        const j = await res.json().catch(() => ({}))
        if (j?.code === "EXPIRED_TOKEN") setError("Link expirado. Solicite um novo.")
        else if (j?.code === "INVALID_TOKEN") setError("Link invalido. Solicite um novo.")
        else if (res.status === 429) setError("Muitas tentativas. Tente em alguns minutos.")
        else setError(j?.error ?? "Falha ao redefinir senha")
      }
    } catch {
      setError("Erro de rede")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-red-400 text-[13px] mb-4">Link invalido ou expirado.</p>
        <Link href="/forgot-password" className="text-[#F5C400] text-[13px]">
          Solicitar novo link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div>
        <div className="bg-[#1a3320] border border-[#2d6a3e] rounded-lg p-4 text-[#a8e8b6] text-[13px] mb-6">
          Senha redefinida com sucesso. Redirecionando para login...
        </div>
        <Link href="/login" className="block text-center text-[#F5C400] text-[13px]">
          Ir para login agora
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="text-[#bbb] text-[12px] mb-1 block">Nova senha</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-[#0a0a0a] border-2 border-[#333] rounded-md px-3 py-2 text-white text-[14px] outline-none focus:border-[#F5C400]"
        />
      </div>
      <div>
        <label className="text-[#bbb] text-[12px] mb-1 block">Confirmar senha</label>
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full bg-[#0a0a0a] border-2 border-[#333] rounded-md px-3 py-2 text-white text-[14px] outline-none focus:border-[#F5C400]"
        />
      </div>
      {error && <p className="text-red-400 text-[12px]">{error}</p>}
      <Button type="submit" variant="primary" loading={loading} className="w-full mt-2">
        {loading ? "Salvando..." : "Redefinir senha"}
      </Button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-4">
      <div className="w-full max-w-md bg-[#171717] border-2 border-[#333] rounded-xl p-8">
        <div className="text-white text-lg font-bold mb-6">Nova senha</div>
        <Suspense fallback={<div className="text-[#888] text-[13px]">Carregando...</div>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  )
}
