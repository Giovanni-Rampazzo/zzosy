"use client"
import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const res = await signIn("credentials", { email, password, redirect: false })
    if (res?.ok) {
      router.push("/dashboard")
    } else {
      setError("E-mail ou senha incorretos")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111]">
      <div className="w-[400px]">
        <div className="text-center mb-10">
          <div className="text-[#F5C400] text-3xl font-bold tracking-[3px]">ZZOSY</div>
          <div className="text-[#555] text-[13px] mt-2">Sistema de automação de campanhas</div>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-8 border border-[#2a2a2a]">
          <div className="text-white text-lg font-bold mb-6">Entrar</div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-[#111] border border-[#333] rounded-md px-3 py-2 text-white text-[13px] focus:outline-none focus:border-[#F5C400]"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#111] border border-[#333] rounded-md px-3 py-2 text-white text-[13px] focus:outline-none focus:border-[#F5C400]"
                required
              />
            </div>
            {error && <p className="text-red-400 text-[12px]">{error}</p>}
            <Button type="submit" loading={loading} className="w-full mt-2">{loading ? "Entrando..." : "Entrar"}</Button>
          </form>
          <p className="text-center text-[12px] text-[#444] mt-4">
            Não tem conta?{" "}
            <Link href="/register" className="text-[#F5C400]">Criar conta</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
