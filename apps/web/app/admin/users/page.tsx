"use client"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"

interface User {
  id: string
  name: string | null
  email: string
  role: string
  blocked: boolean
  createdAt: string
  tenant: { id: string; name: string; slug: string }
}

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "SUPER_ADMIN", label: "Super Admin" },
]

export default function AdminUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guard: redireciona se nao for SUPER_ADMIN
  useEffect(() => {
    if (status === "loading") return
    if (status === "unauthenticated") { router.push("/login"); return }
    if ((session?.user as any)?.role !== "SUPER_ADMIN") { router.push("/dashboard"); return }
  }, [status, session, router])

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`)
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    if ((session?.user as any)?.role === "SUPER_ADMIN") load()
  }, [session])

  async function toggleBlocked(u: User) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, blocked: !u.blocked }),
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, blocked: updated.blocked } : x))
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || "Falha ao atualizar")
    }
  }

  async function deleteUser(u: User, skipConfirm = false) {
    if (!skipConfirm && !confirm(`Apagar usuario "${u.email}"? Esta acao nao pode ser desfeita.`)) return
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" })
    if (res.ok) {
      setUsers(prev => prev.filter(x => x.id !== u.id))
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || "Falha ao deletar")
    }
  }

  if (status === "loading" || (session?.user as any)?.role !== "SUPER_ADMIN") {
    return <PageShell><div className="p-8 text-[#888]">Carregando...</div></PageShell>
  }

  return (
    <PageShell>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Usuários do Sistema</h1>
            <p className="text-sm text-[#888888] mt-1">Gerencie quem tem acesso ao ZZOSY</p>
          </div>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") load() }}
              placeholder="Buscar por nome ou email..."
              className="px-3 py-1.5 text-xs border border-[#E0E0E0] rounded-md w-64 outline-none focus:border-[#888]"
            />
            <button
              onClick={() => { setError(null); setShowCreate(true) }}
              className="px-4 py-1.5 text-xs font-semibold rounded-md bg-[#F5C400] text-black hover:bg-[#E5B400] cursor-pointer"
            >
              + Novo usuário
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#888888]">Carregando...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhum usuário encontrado</div>
        ) : (
          <div className="bg-white rounded-xl border border-[#E0E0E0] overflow-hidden">
            <table className="w-full border-collapse">
              <thead className="bg-[#fafafa] border-b border-[#E0E0E0]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Tenant</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Criado em</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#666]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isMe = (session?.user as any)?.id === u.id
                  return (
                    <tr key={u.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                      <td className="px-4 py-3 text-sm font-semibold">{u.name || <span className="text-[#aaa]">(sem nome)</span>}</td>
                      <td className="px-4 py-3 text-sm text-[#666]">{u.email} {isMe && <span className="text-[10px] text-[#F5C400] font-semibold">(você)</span>}</td>
                      <td className="px-4 py-3 text-sm text-[#666]">{u.tenant.name}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${u.role === "SUPER_ADMIN" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {u.blocked ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Bloqueado</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ativo</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#666]">{new Date(u.createdAt).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setError(null); setEditing(u) }}
                            className="text-xs font-semibold px-3 py-1 border border-[#E0E0E0] rounded-md bg-white hover:bg-[#fafafa] cursor-pointer"
                          >
                            Editar
                          </button>
                          {!isMe && (
                            <>
                              <button
                                onClick={() => toggleBlocked(u)}
                                className={`text-xs font-semibold px-3 py-1 rounded-md cursor-pointer ${u.blocked ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}
                              >
                                {u.blocked ? "Desbloquear" : "Bloquear"}
                              </button>
                              <button
                                onClick={(e) => deleteUser(u, e.altKey)}
                                title="Option/Alt+click pra apagar sem confirmação"
                                className="text-xs font-semibold px-3 py-1 border border-red-200 text-red-700 bg-red-50 rounded-md hover:bg-red-100 cursor-pointer"
                              >
                                Apagar
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <UserModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={(u) => { setUsers(prev => [u, ...prev]); setShowCreate(false) }}
          error={error}
          setError={setError}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => { setUsers(prev => prev.map(x => x.id === u.id ? u : x)); setEditing(null) }}
          error={error}
          setError={setError}
        />
      )}
    </PageShell>
  )
}

function UserModal({ mode, user, onClose, onSaved, error, setError }: {
  mode: "create" | "edit"
  user?: User
  onClose: () => void
  onSaved: (u: User) => void
  error: string | null
  setError: (s: string | null) => void
}) {
  const [name, setName] = useState(user?.name ?? "")
  const [email, setEmail] = useState(user?.email ?? "")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState(user?.role ?? "ADMIN")
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const url = "/api/admin/users"
      const method = mode === "create" ? "POST" : "PATCH"
      const body: any = mode === "create"
        ? { name, email, password, role }
        : { id: user!.id, name, role, ...(password ? { password } : {}) }
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || "Falha ao salvar")
        return
      }
      const u = await res.json()
      onSaved(u)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "white", borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw" }}>
        <h2 style={{ margin: 0, marginBottom: 20, fontSize: 18, fontWeight: 700 }}>
          {mode === "create" ? "Novo usuário" : "Editar usuário"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Nome</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 text-sm border border-[#E0E0E0] rounded-md outline-none focus:border-[#F5C400]" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Email</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={mode === "edit"}
              className="w-full px-3 py-2 text-sm border border-[#E0E0E0] rounded-md outline-none focus:border-[#F5C400] disabled:bg-[#fafafa] disabled:text-[#888]"
            />
            {mode === "edit" && <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Email não pode ser alterado</p>}
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
              Senha {mode === "edit" && <span style={{ color: "#888", fontWeight: 400 }}>(deixe em branco pra não mudar)</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === "edit" ? "Nova senha (opcional)" : "Mínimo 8 caracteres"}
              className="w-full px-3 py-2 text-sm border border-[#E0E0E0] rounded-md outline-none focus:border-[#F5C400]"
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-3 py-2 text-sm border border-[#E0E0E0] rounded-md outline-none focus:border-[#F5C400]">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {error && <div style={{ background: "#fee2e2", color: "#dc2626", padding: 10, borderRadius: 6, fontSize: 12 }}>{error}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-xs font-semibold border border-[#E0E0E0] rounded-md bg-white hover:bg-[#fafafa] cursor-pointer">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-md bg-[#F5C400] text-black hover:bg-[#E5B400] cursor-pointer disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  )
}
