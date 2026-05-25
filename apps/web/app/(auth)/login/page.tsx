"use client"
import { useState } from "react"
import { signIn, signOut, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

export default function LoginPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

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

  async function handleLogout() {
    setLoggingOut(true)
    // redirect: false pra ficar na pagina /login depois de deslogar
    await signOut({ redirect: false })
    setLoggingOut(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111]">
      <div className="w-[400px]">
        <div className="text-center mb-10">
          <div className="text-[#F5C400] text-3xl font-bold tracking-[3px]">ZZOSY</div>
          <div className="text-[#555] text-[13px] mt-2">Sistema de automação de campanhas</div>
        </div>
        {status === "authenticated" && session?.user && (
          <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#2a2a2a] mb-4 flex items-center justify-between">
            <div className="text-[12px]">
              <span className="text-[#666]">Sessão ativa: </span>
              <span className="text-white">{session.user.email}</span>
            </div>
            <Button onClick={handleLogout} variant="secondary" size="sm" loading={loggingOut}>
              {loggingOut ? "Saindo..." : "Sair"}
            </Button>
          </div>
        )}
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
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[#111] border border-[#333] rounded-md pl-3 pr-10 py-2 text-white text-[13px] focus:outline-none focus:border-[#F5C400]"
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
                    // Olho cortado (oculto)
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    // Olho aberto (visivel)
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {error && <p className="text-red-400 text-[12px]">{error}</p>}
            <Button type="submit" variant="primary" loading={loading} className="w-full mt-2">{loading ? "Entrando..." : "Entrar"}</Button>
          </form>
          <p className="text-center text-[12px] text-[#888] mt-3">
            <Link href="/forgot-password" className="hover:text-[#F5C400]">Esqueci minha senha</Link>
          </p>
          <p className="text-center text-[12px] text-[#444] mt-4">
            Não tem conta?{" "}
            <Link href="/register" className="text-[#F5C400]">Criar conta</Link>
          </p>
          <p className="text-center text-[11px] text-[#666] mt-3">
            Ao entrar, você concorda com os{" "}
            <Link href="/legal/terms" className="underline">Termos de Uso</Link>
            {" "}e a{" "}
            <Link href="/legal/privacy" className="underline">Política de Privacidade</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
