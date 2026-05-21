"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

function Logo() {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:"1px",fontFamily:"'DM Sans',sans-serif",fontWeight:900,fontSize:"2rem",letterSpacing:"-0.04em",color:"#111" }}>
      ZZ
      <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:"2rem",height:"2rem",border:"3px solid #111",borderRadius:"50%",margin:"0 1px" }}>
        <span style={{ display:"flex",gap:"2px" }}>
          {["#F5C400","#34A853","#4285F4"].map(c=><span key={c} style={{ width:"5px",height:"5px",borderRadius:"50%",background:c }} />)}
        </span>
      </span>
      SY
    </div>
  );
}

export default function WelcomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const name = session?.user?.name?.split(" ")[0] ?? "por aí";

  return (
    <div style={{ minHeight:"100vh",background:"#FFF",fontFamily:"'DM Sans',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px" }}>
      <div style={{ maxWidth:"560px",width:"100%",textAlign:"center" }}>
        <div style={{ display:"flex",justifyContent:"center",marginBottom:"48px" }}>
          <Logo />
        </div>

        <div style={{ fontSize:"3rem",marginBottom:"16px" }}>👋</div>
        <h1 style={{ fontSize:"2rem",fontWeight:900,color:"#111",letterSpacing:"-0.03em",margin:"0 0 12px" }}>
          Bem-vindo, {name}!
        </h1>
        <p style={{ fontSize:"1rem",color:"#888",lineHeight:1.6,margin:"0 0 48px" }}>
          Sua conta foi criada com sucesso. Agora escolha o plano ideal para sua agência e comece a automatizar seus layouts.
        </p>

        <div style={{ display:"flex",flexDirection:"column",gap:"12px",marginBottom:"32px" }}>
          <Button variant="dark" size="lg" onClick={()=>router.push("/plans")} style={{ width:"100%" }}>
            Ver planos e preços →
          </Button>
          <Button variant="secondary" size="lg" onClick={()=>router.push("/dashboard")} style={{ width:"100%" }}>
            Continuar com plano gratuito
          </Button>
        </div>

        <div style={{ display:"flex",justifyContent:"center",gap:"32px",padding:"24px",background:"#F7F7F7",borderRadius:"12px" }}>
          {["Editor visual","Múltiplos formatos","Exportação em escala"].map(label=>(
            <div key={label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:"0.78rem",fontWeight:600,color:"#666" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
