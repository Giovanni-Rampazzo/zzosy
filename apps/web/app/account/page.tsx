"use client"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useRef, useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { plans } from "@/lib/plans-config"

interface Brand {
  brandName?: string | null
  brandLogoUrl?: string | null
  brandSecondaryLogoUrl?: string | null
  whiteLabelAccentColor?: string | null
  brandFooterText?: string | null
}

const DEFAULT_COLOR = "#F5C400"

const CHECKER: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  backgroundImage:
    "linear-gradient(45deg, #C8C8C8 25%, transparent 25%)," +
    "linear-gradient(-45deg, #C8C8C8 25%, transparent 25%)," +
    "linear-gradient(45deg, transparent 75%, #C8C8C8 75%)," +
    "linear-gradient(-45deg, transparent 75%, #C8C8C8 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
}

export default function AccountPage() {
  const { data: session } = useSession()
  const [name, setName] = useState(session?.user?.name ?? "")
  const [brand, setBrand] = useState<Brand>({})
  const [savingBrand, setSavingBrand] = useState(false)
  const [savedBrand, setSavedBrand] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const secondaryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/account/brand").then(r => r.json()).then(d => setBrand(d ?? {}))
  }, [])

  const inp = {width:"100%",padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"} as React.CSSProperties

  async function readFileAsDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(new Error("FileReader failed"))
      fr.readAsDataURL(file)
    })
  }

  async function pickLogo(field: "brandLogoUrl" | "brandSecondaryLogoUrl", file: File | null) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { alert("Logo maior que 5MB — comprime antes."); return }
    const dataUrl = await readFileAsDataUrl(file)
    setBrand(b => ({ ...b, [field]: dataUrl }))
  }

  async function saveBrand() {
    setSavingBrand(true)
    setSavedBrand(false)
    try {
      const r = await fetch("/api/account/brand", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brand),
      })
      if (r.ok) {
        const updated = await r.json()
        setBrand(updated)
        setSavedBrand(true)
        setTimeout(() => setSavedBrand(false), 2500)
        // Sinaliza pra outros components (TopNav etc) recarregarem.
        window.dispatchEvent(new CustomEvent("zzosy:brand-updated"))
      }
    } catch (e) {
      console.warn("[brand save] fail:", e)
    } finally {
      setSavingBrand(false)
    }
  }

  return (
    <PageShell>
      <div style={{padding:32,maxWidth:760}}>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:32}}>Conta</h1>

        {(() => {
          // TODO: ler plano real do user/tenant; por ora hardcoded "pro".
          // Source of truth para precos: lib/plans-config (era hardcoded R$ 299 aqui).
          const currentPlan = plans.find(p => p.id === "pro") ?? plans[0]
          return (
            <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#888",marginBottom:16}}>Minha Assinatura</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:18,fontWeight:700}}>Plano {currentPlan.name}</div>
                  <div style={{fontSize:12,color:"#888",marginTop:4}}>{currentPlan.priceLabel}/mês</div>
                </div>
                <span style={{fontSize:11,fontWeight:600,padding:"4px 12px",borderRadius:20,background:"#dcfce7",color:"#16a34a"}}>Ativo</span>
              </div>
            </div>
          )
        })()}

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

        {/* WHITE LABEL / MARCA */}
        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.8px",color:"#888"}}>Marca / White Label</div>
            {savedBrand && <span style={{fontSize:11,color:"#16a34a"}}>✓ Salvo</span>}
          </div>
          <p style={{fontSize:12,color:"#888",marginBottom:18,marginTop:0}}>
            Substitui o branding padrão (ZZOSY, amarelo, logos) na navegação, apresentações e PPTX exportado. Deixa vazio pra usar o default.
          </p>

          {/* Nome da marca */}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Nome da marca</label>
            <input
              value={brand.brandName ?? ""}
              onChange={e => setBrand(b => ({...b, brandName: e.target.value}))}
              placeholder="ZZOSY"
              style={inp}
            />
            <span style={{fontSize:10,color:"#aaa"}}>Aparece no topo da página (navegação).</span>
          </div>

          {/* Cor primária */}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Cor primária</label>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <input
                type="color"
                value={brand.whiteLabelAccentColor ?? DEFAULT_COLOR}
                onChange={e => setBrand(b => ({...b, whiteLabelAccentColor: e.target.value}))}
                style={{width:44,height:36,padding:0,border:"1px solid #E0E0E0",borderRadius:6,cursor:"pointer",background:"none"}}
              />
              <input
                value={brand.whiteLabelAccentColor ?? ""}
                onChange={e => setBrand(b => ({...b, whiteLabelAccentColor: e.target.value}))}
                placeholder={DEFAULT_COLOR}
                style={{...inp,flex:1,fontFamily:"ui-monospace, monospace"}}
              />
            </div>
            <span style={{fontSize:10,color:"#aaa"}}>Usada como accent na navegação e nos slides da apresentação.</span>
          </div>

          {/* Logo principal */}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Logo principal</label>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{width:120,height:60,...CHECKER,borderRadius:6,border:"1px solid #E0E0E0",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                {brand.brandLogoUrl ? (
                  <img src={brand.brandLogoUrl} alt="Logo principal" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} />
                ) : (
                  <span style={{fontSize:10,color:"#aaa"}}>(sem logo)</span>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>Escolher arquivo</Button>
                {brand.brandLogoUrl && (
                  <Button variant="link" size="sm" onClick={() => setBrand(b => ({...b, brandLogoUrl: null}))} style={{color:"#dc2626",padding:0,height:"auto"}}>Remover</Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style={{display:"none"}}
                onChange={e => pickLogo("brandLogoUrl", e.target.files?.[0] ?? null)}
              />
            </div>
            <span style={{fontSize:10,color:"#aaa"}}>PNG/SVG transparente fica melhor. Se o xadrez some atrás do logo, o arquivo tem fundo branco — exporta com transparência. Aparece no topo da navegação e nos slides da apresentação. Max 5MB.</span>
          </div>

          {/* Logo secundário grande */}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Logo grande (capa)</label>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{width:240,height:50,...CHECKER,borderRadius:6,border:"1px solid #E0E0E0",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                {brand.brandSecondaryLogoUrl ? (
                  <img src={brand.brandSecondaryLogoUrl} alt="Logo grande" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} />
                ) : (
                  <span style={{fontSize:10,color:"#aaa"}}>(sem logo)</span>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <Button variant="secondary" onClick={() => secondaryInputRef.current?.click()}>Escolher arquivo</Button>
                {brand.brandSecondaryLogoUrl && (
                  <Button variant="link" size="sm" onClick={() => setBrand(b => ({...b, brandSecondaryLogoUrl: null}))} style={{color:"#dc2626",padding:0,height:"auto"}}>Remover</Button>
                )}
              </div>
              <input
                ref={secondaryInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style={{display:"none"}}
                onChange={e => pickLogo("brandSecondaryLogoUrl", e.target.files?.[0] ?? null)}
              />
            </div>
            <span style={{fontSize:10,color:"#aaa"}}>Logo horizontal grande, aparece na capa da apresentação. Mesma regra: se o xadrez some, fundo não está transparente. Max 5MB.</span>
          </div>

          {/* Footer text */}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Texto do rodapé</label>
            <input
              value={brand.brandFooterText ?? ""}
              onChange={e => setBrand(b => ({...b, brandFooterText: e.target.value}))}
              placeholder="Classificação da informação: Uso Interno"
              style={inp}
            />
            <span style={{fontSize:10,color:"#aaa"}}>Aparece no rodapé de todos os slides da apresentação.</span>
          </div>

          <Button onClick={saveBrand} loading={savingBrand}>Salvar marca</Button>
        </div>

        <div style={{textAlign:"right"}}>
          <Button variant="danger" onClick={() => signOut({ callbackUrl: "/login" })}>Sair da conta</Button>
        </div>
      </div>
    </PageShell>
  )
}
