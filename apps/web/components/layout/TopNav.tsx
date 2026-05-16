"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { useBrand } from "@/lib/useBrand"

const navLinks = [
  { href: "/dashboard", label: "Clientes" },
  { href: "/campaigns", label: "Campanhas" },
  { href: "/pieces", label: "Peças" },
  { href: "/medias", label: "Mídias" },
  { href: "/approvals", label: "Aprovação" },
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
            color: pathname?.startsWith(link.href) ? "#ffffff" : "#777777",
            textDecoration: "none",
            fontSize: 12,
            fontWeight: 500,
            paddingBottom: 2,
            borderBottom: pathname?.startsWith(link.href) ? `2px solid ${accent}` : "2px solid transparent",
          }}
        >
          {link.label}
        </Link>
      ))}
      {(session?.user as any)?.role === "SUPER_ADMIN" && (
        <Link
          href="/admin/users"
          style={{
            color: pathname?.startsWith("/admin") ? "#ffffff" : "#777777",
            textDecoration: "none",
            fontSize: 12,
            fontWeight: 500,
            paddingBottom: 2,
            borderBottom: pathname?.startsWith("/admin") ? `2px solid ${accent}` : "2px solid transparent",
          }}
        >
          Admin
        </Link>
      )}
      <div style={{flex:1}} />
      <Link href="/account" style={{color: pathname?.startsWith("/account") ? "#ffffff" : "#777777", textDecoration:"none", fontSize:12, fontWeight:500}}>
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
