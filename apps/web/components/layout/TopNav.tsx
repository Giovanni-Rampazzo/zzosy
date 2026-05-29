"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { useBrand } from "@/lib/useBrand"

// Mídias = catalogo GLOBAL de formatos (dimensoes/veiculos) do tenant.
// Tambem acessivel via /clients/[id]/edit > card "Formatos de midia".
// Aprovação escondido temporariamente 2026-05-28 — pagina continua acessivel
// via URL direta, so saiu da nav.
const navLinks = [
  { href: "/dashboard", label: "Clientes" },
  { href: "/campaigns", label: "Campanhas" },
  { href: "/pieces", label: "Peças" },
  { href: "/medias", label: "Formatos" },
  { href: "/deliveries", label: "Entregas" },
]

export function TopNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const brand = useBrand()
  const accent = brand.primaryColor

  return (
    <nav style={{height:52,background:"#111111",display:"flex",alignItems:"center",padding:"0 24px",gap:28,flexShrink:0,zIndex:50}}>
      {/* Brand: logo customizado (se houver) OU nome em texto. */}
      <Link href="/dashboard" style={{display:"flex",alignItems:"center",gap:8,textDecoration:"none",marginRight:8}}>
        {brand.hasCustomLogo ? (
          <img src={brand.logoUrl} alt={brand.name} style={{height:24,width:"auto",objectFit:"contain"}} />
        ) : (
          <span style={{color:accent,fontWeight:700,fontSize:15,letterSpacing:2}}>{brand.name}</span>
        )}
      </Link>
      {navLinks.map(link => (
        <Link
          key={link.href}
          href={link.href}
          style={{
            color: pathname?.startsWith(link.href) ? "#ffffff" : "#B0B0B0",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            paddingBottom: 2,
            borderBottom: pathname?.startsWith(link.href) ? `2px solid ${accent}` : "2px solid transparent",
            transition: "color 0.15s ease",
          }}
          onMouseEnter={e => { if (!pathname?.startsWith(link.href)) e.currentTarget.style.color = "#ffffff" }}
          onMouseLeave={e => { if (!pathname?.startsWith(link.href)) e.currentTarget.style.color = "#B0B0B0" }}
        >
          {link.label}
        </Link>
      ))}
      <div style={{flex:1}} />
      {(session?.user as any)?.role === "SUPER_ADMIN" && (
        <Link
          href="/admin"
          style={{
            color: pathname?.startsWith("/admin") ? "#ffffff" : "#B0B0B0",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={e => { if (!pathname?.startsWith("/admin")) e.currentTarget.style.color = "#ffffff" }}
          onMouseLeave={e => { if (!pathname?.startsWith("/admin")) e.currentTarget.style.color = "#B0B0B0" }}
        >
          Admin
        </Link>
      )}
      <Link
        href="/account"
        style={{
          color: pathname?.startsWith("/account") ? "#ffffff" : "#B0B0B0",
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 600,
          transition: "color 0.15s ease",
        }}
        onMouseEnter={e => { if (!pathname?.startsWith("/account")) e.currentTarget.style.color = "#ffffff" }}
        onMouseLeave={e => { if (!pathname?.startsWith("/account")) e.currentTarget.style.color = "#B0B0B0" }}
      >
        Account
      </Link>
      <div
        onClick={() => signOut({ callbackUrl: "/login" })}
        style={{width:28,height:28,borderRadius:"50%",background:accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#111111",cursor:"pointer"}}
      >
        {session?.user?.name?.[0]?.toUpperCase() ?? "G"}
      </div>
    </nav>
  )
}
