"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: "", email: "", password: "", agencyName: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      router.push("/login?registered=1")
    } else {
      const d = await res.json()
      setError(d.error || "Erro ao criar conta")
      setLoading(false)
    }
  }

  const inp = "w-full bg-[#111] border border-[#333] rounded-md px-3 py-2 text-white text-[13px] focus:outline-none focus:border-[#F5C400]"

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111] py-10">
      <div className="w-[480px]">
        <div className="text-center mb-8">
          <div className="text-[#F5C400] text-3xl font-bold tracking-[3px]">ZZOSY</div>
          <div className="text-[#555] text-[13px] mt-2">Crie sua conta gratuitamente</div>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-8 border border-[#2a2a2a]">
          <div className="text-white text-lg font-bold mb-6">Criar conta</div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">Nome</label>
                <input className={inp} value={form.name} onChange={e => set("name", e.target.value)} required />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">Agência</label>
                <input className={inp} value={form.agencyName} onChange={e => set("agencyName", e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">E-mail</label>
              <input type="email" className={inp} value={form.email} onChange={e => set("email", e.target.value)} required />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-1.5">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className={`${inp} pr-10`}
                  value={form.password}
                  onChange={e => set("password", e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#F5C400] cursor-pointer bg-transparent border-0 p-0"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {error && <p className="text-red-400 text-[12px]">{error}</p>}
            <Button type="submit" loading={loading} className="w-full mt-2">{loading ? "Criando conta..." : "Criar conta"}</Button>
          </form>
          <p className="text-center text-[12px] text-[#444] mt-4">
            Já tem conta?{" "}
            <Link href="/login" className="text-[#F5C400]">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
