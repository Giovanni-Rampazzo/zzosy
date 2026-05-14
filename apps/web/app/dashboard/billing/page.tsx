"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { plans } from "@/lib/plans-config";
type BillingInfo = { plan: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; currentPeriodEnd?: string; cancelAtPeriodEnd?: boolean; };
export default function BillingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  useEffect(() => { fetch("/api/billing").then(r => r.json()).then(data => { setBilling(data); setLoading(false); }); }, []);
  const currentPlan = plans.find(p => p.id === billing?.plan?.toLowerCase()) ?? plans[0];
  const isFree = !billing?.stripeSubscriptionId;
  const handleCancel = async () => {
    if (!confirm("Tem certeza?")) return;
    setCanceling(true);
    await fetch("/api/billing/cancel", { method: "POST" });
    location.reload();
  };
  if (loading) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans,sans-serif"}}><div style={{color:"#999"}}>Carregando...</div></div>;
  return (
    <div style={{minHeight:"100vh",background:"#FAFAFA",fontFamily:"DM Sans,sans-serif",padding:"40px 24px"}}>
      <div style={{maxWidth:"680px",margin:"0 auto"}}>
        <div style={{marginBottom:"32px"}}>
          <button onClick={() => router.push("/dashboard")} style={{background:"none",border:"none",cursor:"pointer",color:"#999",fontSize:"0.85rem",padding:0,marginBottom:"16px",fontFamily:"DM Sans,sans-serif"}}>← Voltar ao dashboard</button>
          <h1 style={{fontSize:"1.8rem",fontWeight:800,color:"#111",margin:0,letterSpacing:"-0.03em"}}>Assinatura</h1>
          <p style={{color:"#888",marginTop:"6px",fontSize:"0.9rem"}}>Gerencie seu plano e pagamentos</p>
        </div>
        <div style={{background:"#111",borderRadius:"20px",padding:"32px",marginBottom:"16px",color:"#FFF"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"16px"}}>
            <div>
              <div style={{fontSize:"0.75rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",opacity:0.5,marginBottom:"8px"}}>Plano atual</div>
              <div style={{fontSize:"2rem",fontWeight:800,letterSpacing:"-0.03em"}}>{currentPlan.name}</div>
              <div style={{fontSize:"0.9rem",opacity:0.6,marginTop:"4px"}}>{currentPlan.priceLabel}{currentPlan.period ? ` / ${currentPlan.period}` : ""}</div>
            </div>
            <div style={{background:isFree?"rgba(255,255,255,0.1)":"#F5C400",borderRadius:"10px",padding:"8px 16px"}}>
              <span style={{fontSize:"0.8rem",fontWeight:700,color:isFree?"#FFF":"#111"}}>{isFree?"Gratuito":"Ativo"}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:"24px",marginTop:"28px",flexWrap:"wrap"}}>
            {[{label:"Usuários",value:currentPlan.users},{label:"Campanhas",value:currentPlan.campaigns??"Ilimitadas"},{label:"Peças/mês",value:currentPlan.pieces?Number(currentPlan.pieces).toLocaleString("pt-BR"):"Ilimitadas"}].map(({label,value}) => (
              <div key={label}><div style={{fontSize:"0.72rem",opacity:0.5,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"4px"}}>{label}</div><div style={{fontSize:"1.1rem",fontWeight:700}}>{value}</div></div>
            ))}
          </div>
          {billing?.currentPeriodEnd && <div style={{marginTop:"24px",paddingTop:"20px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:"0.85rem",opacity:0.6}}>{billing.cancelAtPeriodEnd?`⚠️ Cancelamento agendado para ${new Date(billing.currentPeriodEnd).toLocaleDateString("pt-BR")}`:`Renova em ${new Date(billing.currentPeriodEnd).toLocaleDateString("pt-BR")}`}</div>}
        </div>
        <div style={{display:"flex",gap:"12px",flexWrap:"wrap",marginBottom:"32px"}}>
          {isFree?<button onClick={()=>router.push("/plans")} style={{padding:"12px 24px",background:"#111",color:"#FFF",border:"none",borderRadius:"10px",fontSize:"0.88rem",fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif"}}>Fazer upgrade →</button>:<><button onClick={()=>router.push("/plans")} style={{padding:"12px 24px",background:"#111",color:"#FFF",border:"none",borderRadius:"10px",fontSize:"0.88rem",fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif"}}>Mudar plano</button>{!billing?.cancelAtPeriodEnd&&<button onClick={handleCancel} disabled={canceling} style={{padding:"12px 24px",background:"transparent",color:"#E53935",border:"1.5px solid #E53935",borderRadius:"10px",fontSize:"0.88rem",fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif",opacity:canceling?0.6:1}}>{canceling?"Cancelando...":"Cancelar assinatura"}</button>}</>}
        </div>
        <div style={{background:"#FFF",border:"1.5px solid #E5E5E5",borderRadius:"16px",padding:"24px"}}>
          <div style={{fontSize:"0.8rem",fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"16px"}}>Incluído no seu plano</div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>{currentPlan.features.map((f:string)=><div key={f} style={{display:"flex",alignItems:"center",gap:"10px",fontSize:"0.88rem",color:"#333"}}><span style={{color:"#34A853",fontWeight:700}}>✓</span>{f}</div>)}</div>
        </div>
      </div>
    </div>
  );
}
