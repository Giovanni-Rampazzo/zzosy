"use client"
import { useSession, signOut } from "next-auth/react"
import { useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"

export default function AccountPage() {
  const { data: session } = useSession()
  const [name, setName] = useState(session?.user?.name ?? "")

  const inp = {width:"100%",padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"} as React.CSSProperties

  return (
    <PageShell>
      <div style={{padding:32,maxWidth:680}}>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:32}}>Account</h1>

        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#888",marginBottom:16}}>Minha Assinatura</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:18,fontWeight:700}}>Plano Pro</div>
              <div style={{fontSize:12,color:"#888",marginTop:4}}>R$ 299/mês</div>
            </div>
            <span style={{fontSize:11,fontWeight:600,padding:"4px 12px",borderRadius:20,background:"#dcfce7",color:"#16a34a"}}>Ativo</span>
          </div>
        </div>

        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#888",marginBottom:16}}>Meus Dados</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Nome</label>
              <input value={name} onChange={e => setName(e.target.value)} style={inp} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>E-mail</label>
              <input value={session?.user?.email ?? ""} disabled style={{...inp,background:"#F5F5F0",color:"#888"}} />
            </div>
          </div>
          <Button>Salvar alterações</Button>
        </div>

        <div style={{textAlign:"right"}}>
          <Button variant="danger" onClick={() => signOut({ callbackUrl: "/login" })}>Sair da conta</Button>
        </div>
      </div>
    </PageShell>
  )
}
