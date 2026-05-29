"use client"
import { signOut, useSession } from "next-auth/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useActiveClient } from "@/lib/activeClientContext"

// Formatos = catalogo GLOBAL de formatos de midia (dimensoes/veiculos) do
// tenant. Tambem acessivel via /clients/[id]/edit > card "Formatos de midia".
// Fluxo: Clientes → Campanhas → Peças → Formatos → Entregas.
// Aprovação escondido temporariamente 2026-05-28 — pagina /approvals continua
// existindo, so saiu da nav.
const links = [
  { href: "/dashboard", label: "Clientes" },
  { href: "/campaigns", label: "Campanhas" },
  { href: "/pieces", label: "Peças" },
  { href: "/medias", label: "Formatos" },
  { href: "/deliveries", label: "Entregas" },
]

export default function TopNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const activeClient = useActiveClient()

  // Logo do cliente ativo substitui o "ZZOSY". Se cliente nao tem logo,
  // nao mostra NADA (regra user 2026-05-24). Sem cliente ativo (paginas
  // globais como /dashboard, /campaigns lista), tambem fica vazio.
  const showClientLogo = !!activeClient?.brandLogoUrl
  const logoSlot = showClientLogo ? (
    <img
      src={activeClient!.brandLogoUrl!}
      alt={activeClient!.name}
      title={activeClient!.name}
      style={{ height: 28, maxWidth: 120, objectFit: "contain", marginRight: 8 }}
    />
  ) : null

  return (
    <nav style={{height:52,background:"#111111",display:"flex",alignItems:"center",padding:"0 24px",gap:28,flexShrink:0,zIndex:50,fontFamily:"inherit"}}>
      {logoSlot}
      {links.map(link => {
        const active = pathname?.startsWith(link.href)
        return (
          <Link key={link.href} href={link.href} style={{
            color: active ? "#ffffff" : "#bbbbbb",
            textDecoration:"none",
            fontSize:14,
            fontWeight: active ? 600 : 400,
            paddingBottom:2,
            borderBottom: active ? "2px solid #F5C400" : "2px solid transparent",
          }}>
            {link.label}
          </Link>
        )
      })}
      <div style={{flex:1}} />
      {(session?.user as any)?.role === "SUPER_ADMIN" && (
        <Link href="/admin/users" style={{
          color: pathname?.startsWith("/admin") ? "#ffffff" : "#bbbbbb",
          textDecoration:"none",
          fontSize:14,
          fontWeight: pathname?.startsWith("/admin") ? 600 : 400,
          paddingBottom:2,
          borderBottom: pathname?.startsWith("/admin") ? "2px solid #F5C400" : "2px solid transparent",
        }}>
          Admin
        </Link>
      )}
      <Link href="/account" style={{
        color: pathname?.startsWith("/account") ? "#ffffff" : "#bbbbbb",
        textDecoration:"none",
        fontSize:14,
        fontWeight:400,
      }}>
        Account
      </Link>
      <div
        onClick={() => signOut({ callbackUrl: "/login" })}
        style={{width:30,height:30,borderRadius:"50%",background:"#F5C400",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#111111",cursor:"pointer",marginLeft:8}}
      >
        {session?.user?.name?.[0]?.toUpperCase() ?? "G"}
      </div>
    </nav>
  )
}
