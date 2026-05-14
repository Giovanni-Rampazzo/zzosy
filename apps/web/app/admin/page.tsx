"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PLANS = ["FREE","STARTER","PRO","AGENCY","ENTERPRISE"];
const planColors: Record<string,string> = { FREE:"#E5E5E5", STARTER:"#4285F4", PRO:"#F5C400", AGENCY:"#34A853", ENTERPRISE:"#111" };

type User = { id:string; name:string|null; email:string; plan:string; blocked:boolean; createdAt:string; tenant:{name:string;slug:string}; _count:{sessions:number} };
type Metrics = { totalUsers:number; totalCampaigns:number; totalPieces:number; mrr:number; paying:number; usersByPlan:{plan:string;count:number}[]; recentUsers:User[] };

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"overview"|"users"|"email">("overview");
  const [metrics, setMetrics] = useState<Metrics|null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [emailTo, setEmailTo] = useState("all");
  const [emailPlan, setEmailPlan] = useState("FREE");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<string|null>(null);

  useEffect(() => {
    fetch('/api/admin/metrics', {credentials:'include'}).then(r=>r.ok?r.json():Promise.resolve(null)).then(d=>{if(d)setMetrics(d)});
  }, []);

  useEffect(() => {
    if (tab !== "users") return;
    setLoadingUsers(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (planFilter) params.set("plan", planFilter);
    fetch(`/api/admin/users?${params}`, {credentials:"include"}).then(r=>r.json()).then(data=>{ setUsers(data); setLoadingUsers(false); });
  }, [tab, search, planFilter]);

  const updateUser = async (id: string, data: any) => {
    await fetch("/api/admin/users", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id,...data}) });
    setUsers(users.map(u => u.id===id ? {...u,...data} : u));
  };

  const sendEmail = async () => {
    setEmailSending(true); setEmailResult(null);
    const res = await fetch("/api/admin/email", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ to:emailTo, plan:emailPlan, subject:emailSubject, message:emailMessage }) });
    const data = await res.json();
    setEmailResult(`✅ E-mail enviado para ${data.sent} usuário(s)`);
    setEmailSending(false);
  };

  const exportCSV = () => {
    const rows = [["ID","Nome","Email","Plano","Bloqueado","Criado em"],...users.map(u=>[u.id,u.name??"",u.email,u.plan,u.blocked?"Sim":"Não",new Date(u.createdAt).toLocaleDateString("pt-BR")])];
    const csv = rows.map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="usuarios.csv"; a.click();
  };

  const s = { fontFamily:"'DM Sans',sans-serif" };

  return (
    <div style={{ ...s, minHeight:"100vh", background:"#FAFAFA", color:"#111" }}>
      {/* Header */}
      <div style={{ background:"#111", color:"#FFF", padding:"0 40px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"56px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"24px" }}>
          <span style={{ fontWeight:900, fontSize:"1.1rem", letterSpacing:"-0.03em" }}>ZZYSY Admin</span>
          {(["overview","users","email"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ background:"none", border:"none", color:tab===t?"#F5C400":"rgba(255,255,255,0.5)", fontWeight:tab===t?700:400, fontSize:"0.875rem", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", padding:"4px 0", borderBottom:tab===t?"2px solid #F5C400":"2px solid transparent" }}>
              {t==="overview"?"Visão Geral":t==="users"?"Usuários":"E-mail"}
            </button>
          ))}
        </div>
        <button onClick={()=>router.push("/dashboard")} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#FFF", padding:"6px 14px", borderRadius:"6px", fontSize:"0.8rem", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>← Dashboard</button>
      </div>

      <div style={{ padding:"32px 40px" }}>

        {/* OVERVIEW */}
        {tab==="overview" && metrics && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"16px", marginBottom:"32px" }}>
              {[
                { label:"Total de Usuários", value:metrics.totalUsers, accent:"#4285F4" },
                { label:"Usuários Pagantes", value:metrics.paying, accent:"#34A853" },
                { label:"MRR", value:`R$ ${metrics.mrr.toLocaleString("pt-BR")}`, accent:"#F5C400" },
                { label:"Campanhas", value:metrics.totalCampaigns, accent:"#111" },
                { label:"Peças", value:metrics.totalPieces, accent:"#888" },
              ].map(({label,value,accent})=>(
                <div key={label} style={{ background:"#FFF", border:"1px solid #E5E5E5", borderRadius:"12px", padding:"20px" }}>
                  <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:accent, marginBottom:"12px" }} />
                  <div style={{ fontSize:"1.8rem", fontWeight:900, letterSpacing:"-0.03em" }}>{value}</div>
                  <div style={{ fontSize:"0.78rem", color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginTop:"4px" }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px" }}>
              <div style={{ background:"#FFF", border:"1px solid #E5E5E5", borderRadius:"12px", padding:"24px" }}>
                <div style={{ fontSize:"0.8rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"16px" }}>Usuários por Plano</div>
                {metrics.usersByPlan.map(({plan,count})=>(
                  <div key={plan} style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
                    <span style={{ background:planColors[plan], color:plan==="FREE"?"#111":"#FFF", fontSize:"0.72rem", fontWeight:700, padding:"2px 8px", borderRadius:"99px", minWidth:"72px", textAlign:"center" }}>{plan}</span>
                    <div style={{ flex:1, height:"6px", background:"#F0F0F0", borderRadius:"99px", overflow:"hidden" }}>
                      <div style={{ width:`${metrics.totalUsers>0?(count/metrics.totalUsers)*100:0}%`, height:"100%", background:planColors[plan], borderRadius:"99px" }} />
                    </div>
                    <span style={{ fontSize:"0.875rem", fontWeight:700, minWidth:"24px", textAlign:"right" }}>{count}</span>
                  </div>
                ))}
              </div>

              <div style={{ background:"#FFF", border:"1px solid #E5E5E5", borderRadius:"12px", padding:"24px" }}>
                <div style={{ fontSize:"0.8rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"16px" }}>Cadastros Recentes</div>
                {metrics.recentUsers.map(u=>(
                  <div key={u.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #F5F5F5" }}>
                    <div>
                      <div style={{ fontSize:"0.875rem", fontWeight:600 }}>{u.name??u.email}</div>
                      <div style={{ fontSize:"0.75rem", color:"#AAA" }}>{u.email}</div>
                    </div>
                    <span style={{ background:planColors[u.plan], color:u.plan==="FREE"?"#111":"#FFF", fontSize:"0.7rem", fontWeight:700, padding:"2px 8px", borderRadius:"99px" }}>{u.plan}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* USERS */}
        {tab==="users" && (
          <div>
            <div style={{ display:"flex", gap:"12px", marginBottom:"20px", flexWrap:"wrap" }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar por nome ou e-mail"
                style={{ flex:1, minWidth:"200px", padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none" }}
                onFocus={e=>e.target.style.borderColor="#111"} onBlur={e=>e.target.style.borderColor="#E5E5E5"} />
              <select value={planFilter} onChange={e=>setPlanFilter(e.target.value)} style={{ padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none", background:"#FFF", cursor:"pointer" }}>
                <option value="">Todos os planos</option>
                {PLANS.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={exportCSV} style={{ padding:"10px 18px", background:"#111", color:"#FFF", border:"none", borderRadius:"8px", fontSize:"0.875rem", fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>↓ Exportar CSV</button>
            </div>

            {loadingUsers ? <div style={{ color:"#999" }}>Carregando...</div> : (
              <div style={{ background:"#FFF", border:"1px solid #E5E5E5", borderRadius:"12px", overflow:"hidden" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.875rem" }}>
                  <thead>
                    <tr style={{ borderBottom:"1px solid #E5E5E5", background:"#FAFAFA" }}>
                      {["Usuário","Agência","Plano","Status","Criado em","Ações"].map(h=>(
                        <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:"0.75rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u=>(
                      <tr key={u.id} style={{ borderBottom:"1px solid #F5F5F5" }}>
                        <td style={{ padding:"12px 16px" }}>
                          <div style={{ fontWeight:600 }}>{u.name??"-"}</div>
                          <div style={{ fontSize:"0.78rem", color:"#AAA" }}>{u.email}</div>
                        </td>
                        <td style={{ padding:"12px 16px", color:"#666" }}>{u.tenant?.name??"-"}</td>
                        <td style={{ padding:"12px 16px" }}>
                          <select value={u.plan} onChange={e=>updateUser(u.id,{plan:e.target.value})}
                            style={{ padding:"4px 8px", border:"1px solid #E5E5E5", borderRadius:"6px", fontSize:"0.8rem", fontFamily:"'DM Sans',sans-serif", cursor:"pointer", background:planColors[u.plan], color:u.plan==="FREE"?"#111":"#FFF", fontWeight:700 }}>
                            {PLANS.map(p=><option key={p} value={p} style={{ background:"#FFF", color:"#111" }}>{p}</option>)}
                          </select>
                        </td>
                        <td style={{ padding:"12px 16px" }}>
                          <span style={{ background:u.blocked?"#FEE2E2":"#DCFCE7", color:u.blocked?"#E53935":"#16A34A", fontSize:"0.75rem", fontWeight:700, padding:"3px 10px", borderRadius:"99px" }}>{u.blocked?"Bloqueado":"Ativo"}</span>
                        </td>
                        <td style={{ padding:"12px 16px", color:"#888", fontSize:"0.8rem" }}>{new Date(u.createdAt).toLocaleDateString("pt-BR")}</td>
                        <td style={{ padding:"12px 16px" }}>
                          <button onClick={()=>updateUser(u.id,{blocked:!u.blocked})}
                            style={{ padding:"5px 12px", border:`1px solid ${u.blocked?"#34A853":"#E53935"}`, borderRadius:"6px", background:"transparent", color:u.blocked?"#34A853":"#E53935", fontSize:"0.78rem", fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                            {u.blocked?"Desbloquear":"Bloquear"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length===0&&<div style={{ padding:"40px", textAlign:"center", color:"#AAA" }}>Nenhum usuário encontrado.</div>}
              </div>
            )}
          </div>
        )}

        {/* EMAIL */}
        {tab==="email" && (
          <div style={{ maxWidth:"600px" }}>
            <div style={{ background:"#FFF", border:"1px solid #E5E5E5", borderRadius:"12px", padding:"28px", display:"flex", flexDirection:"column", gap:"18px" }}>
              <div>
                <label style={{ display:"block", fontSize:"0.78rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"6px" }}>Destinatário</label>
                <select value={emailTo} onChange={e=>setEmailTo(e.target.value)} style={{ width:"100%", padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none", background:"#FFF" }}>
                  <option value="all">Todos os usuários</option>
                  <option value="plan">Por plano</option>
                </select>
              </div>
              {emailTo==="plan"&&(
                <div>
                  <label style={{ display:"block", fontSize:"0.78rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"6px" }}>Plano</label>
                  <select value={emailPlan} onChange={e=>setEmailPlan(e.target.value)} style={{ width:"100%", padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none", background:"#FFF" }}>
                    {PLANS.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display:"block", fontSize:"0.78rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"6px" }}>Assunto</label>
                <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="Ex: Novidade na plataforma!"
                  style={{ width:"100%", padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none", boxSizing:"border-box" }}
                  onFocus={e=>e.target.style.borderColor="#111"} onBlur={e=>e.target.style.borderColor="#E5E5E5"} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:"0.78rem", fontWeight:700, color:"#888", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"6px" }}>Mensagem</label>
                <textarea value={emailMessage} onChange={e=>setEmailMessage(e.target.value)} rows={6} placeholder="Escreva sua mensagem..."
                  style={{ width:"100%", padding:"10px 14px", border:"1.5px solid #E5E5E5", borderRadius:"8px", fontSize:"0.875rem", fontFamily:"'DM Sans',sans-serif", outline:"none", resize:"vertical", boxSizing:"border-box" }}
                  onFocus={e=>e.target.style.borderColor="#111"} onBlur={e=>e.target.style.borderColor="#E5E5E5"} />
              </div>
              {emailResult&&<div style={{ background:"#DCFCE7", color:"#16A34A", padding:"10px 14px", borderRadius:"8px", fontSize:"0.875rem", fontWeight:600 }}>{emailResult}</div>}
              <button onClick={sendEmail} disabled={emailSending||!emailSubject||!emailMessage}
                style={{ padding:"12px", background:emailSubject&&emailMessage?"#111":"#CCC", color:"#FFF", border:"none", borderRadius:"8px", fontSize:"0.875rem", fontWeight:700, cursor:emailSubject&&emailMessage?"pointer":"not-allowed", fontFamily:"'DM Sans',sans-serif" }}>
                {emailSending?"Enviando...":"Enviar e-mail"}
              </button>
            </div>
            <p style={{ fontSize:"0.78rem", color:"#AAA", marginTop:"12px" }}>⚠️ Integração com Resend/SendGrid pendente. Por enquanto registra no console.</p>
          </div>
        )}
      </div>
    </div>
  );
}
