/**
 * GUIDEBOOK ZZOSY — fonte unica de conhecimento do sistema.
 *
 * Estrutura: cada secao tem id, titulo, categoria, e content (JSX ou markdown
 * inline). Sumario lateral derivado automaticamente.
 *
 * Categorias:
 *   - sitemap: rotas e fluxos de navegacao
 *   - conceitos: matriz, peca, asset, step, layer, override
 *   - logica: regras de negocio (per-char, BG, render, broadcast)
 *   - integracao: PSD round-trip, library, design tokens
 *   - tutoriais: passo-a-passo user-facing (placeholder, expandir)
 */
import React from "react"

export type GuidebookCategory = "sitemap" | "conceitos" | "logica" | "integracao" | "tutoriais"

export interface GuidebookSection {
  id: string
  title: string
  category: GuidebookCategory
  summary: string
  content: React.ReactNode
}

const CODE_STYLE: React.CSSProperties = {
  background: "#f4f4f4", padding: "1px 6px", borderRadius: 4,
  fontFamily: "ui-monospace,SFMono-Regular,monospace", fontSize: 12,
}
const PRE_STYLE: React.CSSProperties = {
  background: "#1a1a1a", color: "#e8e8e8", padding: 16, borderRadius: 8,
  overflow: "auto", fontSize: 12, lineHeight: 1.5,
  fontFamily: "ui-monospace,SFMono-Regular,monospace",
}
const TABLE_STYLE: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", marginTop: 8, marginBottom: 16,
  fontSize: 13,
}
const TH_STYLE: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", background: "#fafafa",
  borderBottom: "2px solid #e0e0e0", fontWeight: 700,
}
const TD_STYLE: React.CSSProperties = {
  padding: "8px 12px", borderBottom: "1px solid #f0f0f0",
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={CODE_STYLE}>{children}</code>
}

function Note({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "warning" | "tip" }) {
  const colors = {
    info: { bg: "#eff6ff", border: "#3b82f6", label: "💡 INFO" },
    warning: { bg: "#fffbeb", border: "#f59e0b", label: "⚠ ATENÇÃO" },
    tip: { bg: "#f0fdf4", border: "#22c55e", label: "✓ DICA" },
  }
  const c = colors[kind]
  return (
    <div style={{ background: c.bg, borderLeft: `4px solid ${c.border}`, padding: "10px 14px", borderRadius: 4, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: c.border }}>{c.label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}

export const GUIDEBOOK_SECTIONS: GuidebookSection[] = [
  // ============================================================
  // SITEMAP
  // ============================================================
  {
    id: "sitemap",
    title: "Sitemap completo",
    category: "sitemap",
    summary: "Todas as rotas do sistema e o que cada uma faz",
    content: (
      <>
        <p>Estrutura completa das rotas user-facing. Rotas <Code>/api/*</Code> servem o frontend e não aparecem aqui.</p>
        <table style={TABLE_STYLE}>
          <thead><tr><th style={TH_STYLE}>Rota</th><th style={TH_STYLE}>O que faz</th></tr></thead>
          <tbody>
            <tr><td style={TD_STYLE}><Code>/</Code></td><td style={TD_STYLE}>Landing/login redirect</td></tr>
            <tr><td style={TD_STYLE}><Code>/login</Code></td><td style={TD_STYLE}>Login com email/senha (NextAuth)</td></tr>
            <tr><td style={TD_STYLE}><Code>/register</Code></td><td style={TD_STYLE}>Signup novo tenant + admin user</td></tr>
            <tr><td style={TD_STYLE}><Code>/welcome</Code></td><td style={TD_STYLE}>Onboarding pós-signup</td></tr>
            <tr><td style={TD_STYLE}><Code>/dashboard</Code></td><td style={TD_STYLE}>Hub principal — atalhos pra campanhas/clients/etc</td></tr>
            <tr><td style={TD_STYLE}><Code>/dashboard/billing</Code></td><td style={TD_STYLE}>Stripe billing (plano, faturas)</td></tr>
            <tr><td style={TD_STYLE}><Code>/clients</Code></td><td style={TD_STYLE}>Lista de clientes do tenant</td></tr>
            <tr><td style={TD_STYLE}><Code>/clients/[id]</Code></td><td style={TD_STYLE}>Detalhes do cliente (brand colors, fontes, etc)</td></tr>
            <tr><td style={TD_STYLE}><Code>/clients/[id]/edit</Code></td><td style={TD_STYLE}>Editar brand identity</td></tr>
            <tr><td style={TD_STYLE}><Code>/clients/[id]/library</Code></td><td style={TD_STYLE}>Biblioteca de assets reutilizáveis do cliente</td></tr>
            <tr><td style={TD_STYLE}><Code>/clients/[id]/design-system</Code></td><td style={TD_STYLE}>Design system do cliente (cores, tokens)</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns</Code></td><td style={TD_STYLE}>Lista de campanhas (todas dos clientes do tenant)</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns/[id]</Code></td><td style={TD_STYLE}>Overview da campanha + lista de peças</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns/[id]/assets</Code></td><td style={TD_STYLE}>Lista/edit dos assets (TEXT/IMAGE/SHAPE)</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns/[id]/cartridges</Code></td><td style={TD_STYLE}>Cartuchos (formatos)</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns/[id]/pieces</Code></td><td style={TD_STYLE}>Grid expandido de peças</td></tr>
            <tr><td style={TD_STYLE}><Code>/campaigns/[id]/presentation</Code></td><td style={TD_STYLE}>Apresentação slide-style das peças (PPT-like)</td></tr>
            <tr><td style={TD_STYLE}><Code>/editor</Code></td><td style={TD_STYLE}>Editor Fabric.js — abre matriz ou peça (<Code>?campaignId=X&pieceId=Y</Code>)</td></tr>
            <tr><td style={TD_STYLE}><Code>/pieces</Code></td><td style={TD_STYLE}>Lista global de peças do tenant</td></tr>
            <tr><td style={TD_STYLE}><Code>/pieces/[id]</Code></td><td style={TD_STYLE}>Detalhe da peça (copy, legenda, export)</td></tr>
            <tr><td style={TD_STYLE}><Code>/medias</Code></td><td style={TD_STYLE}>Mídias do tenant</td></tr>
            <tr><td style={TD_STYLE}><Code>/deliveries</Code></td><td style={TD_STYLE}>Pacotes de entrega (zip pra cliente)</td></tr>
            <tr><td style={TD_STYLE}><Code>/approvals</Code></td><td style={TD_STYLE}>Fluxo de aprovação</td></tr>
            <tr><td style={TD_STYLE}><Code>/plans</Code></td><td style={TD_STYLE}>Planos comerciais (público)</td></tr>
            <tr><td style={TD_STYLE}><Code>/admin</Code></td><td style={TD_STYLE}>Admin do produto (overview, métricas)</td></tr>
            <tr><td style={TD_STYLE}><Code>/admin/users</Code></td><td style={TD_STYLE}>Usuários do tenant</td></tr>
            <tr><td style={TD_STYLE}><Code>/admin/settings/design-tokens</Code></td><td style={TD_STYLE}>Editor visual de design tokens (live preview)</td></tr>
            <tr><td style={TD_STYLE}><Code>/admin/guidebook</Code></td><td style={TD_STYLE}>Este guidebook (você está aqui)</td></tr>
          </tbody>
        </table>
      </>
    ),
  },

  // ============================================================
  // CONCEITOS
  // ============================================================
  {
    id: "conceitos-hierarquia",
    title: "Hierarquia: Tenant → Cliente → Campanha → Peça",
    category: "conceitos",
    summary: "Modelo de dados de cima pra baixo",
    content: (
      <>
        <p>O ZZOSY é multi-tenant. Estrutura hierárquica:</p>
        <pre style={PRE_STYLE}>{`Tenant (empresa que assinou ZZOSY)
  └─ User (admin/editor do tenant)
  └─ Client (marca/cliente do tenant — ex: "Sicredi")
      └─ BrandColors, brandFont, logoUrl
      └─ ClientLibraryAsset (assets reutilizáveis Figma-style)
      └─ Campaign
          └─ KeyVision (matriz)
              └─ Layer[] (refs pra CampaignAsset)
          └─ CampaignAsset (TEXT, IMAGE, SHAPE, SMART_OBJECT)
              └─ content (texto canônico + per-char styles)
              └─ lastOverride (template visual)
          └─ Piece (peça gerada da matriz)
              └─ data.layers (snapshot independente, redimensionado)
              └─ data.steps (multi-step opcional, carrossel)
              └─ data.bgLayers (BG canônico, novo schema)`}</pre>
        <Note kind="info">
          <strong>Matriz</strong> é o template. <strong>Peça</strong> é o snapshot dimensionado pra um formato específico (Banner Mobile, Stories, etc).
        </Note>
      </>
    ),
  },
  {
    id: "conceitos-matriz-peca",
    title: "Matriz vs Peça (propagação de overrides)",
    category: "conceitos",
    summary: "Quando edit na matriz afeta peças geradas",
    content: (
      <>
        <p>A propagação é assimétrica e depende do tipo de edit:</p>
        <table style={TABLE_STYLE}>
          <thead><tr><th style={TH_STYLE}>Ação na matriz</th><th style={TH_STYLE}>Propaga pra peças?</th></tr></thead>
          <tbody>
            <tr><td style={TD_STYLE}>Edit override (fill, fontSize, charFills por letra)</td><td style={TD_STYLE}>❌ <strong>NÃO</strong> — só base pra novas peças geradas depois</td></tr>
            <tr><td style={TD_STYLE}>Adicionar layer novo (drag asset pro canvas)</td><td style={TD_STYLE}>✅ Sim — peças ganham layer com overrides vazios</td></tr>
            <tr><td style={TD_STYLE}>Remover layer</td><td style={TD_STYLE}>✅ Sim — apaga em todas peças (mesmo se peça tinha overrides)</td></tr>
            <tr><td style={TD_STYLE}>Edit <Code>asset.content</Code> (texto)</td><td style={TD_STYLE}>✅ Sim — TODAS peças via <Code>migrateStyles</Code> (Myers LCS)</td></tr>
            <tr><td style={TD_STYLE}>Edit override per-char numa peça</td><td style={TD_STYLE}>❌ Só essa peça (peça é independente)</td></tr>
          </tbody>
        </table>
        <Note kind="tip">
          Pra "atualizar todas as peças" com mudança visual da matriz: regere as peças via <Code>/campaigns/[id] → Gerar Peças</Code>.
        </Note>
      </>
    ),
  },
  {
    id: "conceitos-asset-types",
    title: "Tipos de Asset (TEXT, IMAGE, SHAPE, SMART_OBJECT)",
    category: "conceitos",
    summary: "Como cada tipo é armazenado e renderizado",
    content: (
      <>
        <table style={TABLE_STYLE}>
          <thead><tr><th style={TH_STYLE}>Tipo</th><th style={TH_STYLE}>content (DB)</th><th style={TH_STYLE}>Renderização Fabric</th></tr></thead>
          <tbody>
            <tr><td style={TD_STYLE}><strong>TEXT</strong></td><td style={TD_STYLE}>Array TextSpan[] canônico (sentinela + per-char)</td><td style={TD_STYLE}>Textbox com styles map</td></tr>
            <tr><td style={TD_STYLE}><strong>IMAGE</strong></td><td style={TD_STYLE}>imageUrl</td><td style={TD_STYLE}>FabricImage</td></tr>
            <tr><td style={TD_STYLE}><strong>SHAPE</strong></td><td style={TD_STYLE}>JSON {`{ path, pathBbox, fill, stroke, kind?, cornerRadius? }`}</td><td style={TD_STYLE}>Fabric.Path com fill/stroke editáveis</td></tr>
            <tr><td style={TD_STYLE}><strong>SMART_OBJECT</strong></td><td style={TD_STYLE}>PSD embarcado (linked file)</td><td style={TD_STYLE}>FabricImage (raster cache)</td></tr>
          </tbody>
        </table>
      </>
    ),
  },

  // ============================================================
  // LÓGICA
  // ============================================================
  {
    id: "logica-per-char",
    title: "Lógica per-char (cor por letra)",
    category: "logica",
    summary: "Como cores per-char migram entre edições e peças",
    content: (
      <>
        <p>Per-char colors vivem em 3 camadas com precedência clara:</p>
        <pre style={PRE_STYLE}>{`Render =
  layer.overrides.styles[i]      ← override per-instância (peça/matriz)
  ?? asset.lastOverride.styles[i] ← template do asset (pra novas peças)
  ?? asset.content[span].style    ← canônico per-char (sentinela)
  ?? defaultStyle                 ← fallback`}</pre>

        <h4 style={{ fontSize: 14, marginTop: 16 }}>Sentinela em asset.content</h4>
        <p>O primeiro span é vazio (<Code>{`{ text: "", style: defaultStyle }`}</Code>). Sem ele, o primeiro char colorido virava o defaultStyle do textbox (bug).</p>
        <pre style={PRE_STYLE}>{`[
  { "text": "", "style": { "color":"#111111" } },     ← SENTINELA
  { "text": "G", "style": { "color":"#00FF00" } },     ← G verde
  { "text": "I", "style": { "color":"#111111" } },     ← I default
  { "text": "O", "style": { "color":"#FF0000" } }      ← O vermelho
]`}</pre>

        <h4 style={{ fontSize: 14, marginTop: 16 }}>Migração ao editar texto</h4>
        <p>Quando o texto muda, <Code>migrateStyles</Code> (Myers LCS) preserva cores:</p>
        <table style={TABLE_STYLE}>
          <thead><tr><th style={TH_STYLE}>Operação</th><th style={TH_STYLE}>Comportamento</th></tr></thead>
          <tbody>
            <tr><td style={TD_STYLE}><strong>equal</strong> (char igual)</td><td style={TD_STYLE}>Mantém cor do char antigo</td></tr>
            <tr><td style={TD_STYLE}><strong>replace</strong> (substituição)</td><td style={TD_STYLE}>Char novo herda do char antigo NA MESMA POSIÇÃO (bloco 1:1)</td></tr>
            <tr><td style={TD_STYLE}><strong>insert</strong> (char novo)</td><td style={TD_STYLE}>Herda do vizinho esquerdo (Adobe/Figma)</td></tr>
            <tr><td style={TD_STYLE}><strong>delete</strong></td><td style={TD_STYLE}>Cor some</td></tr>
          </tbody>
        </table>

        <h4 style={{ fontSize: 14, marginTop: 16 }}>Heurística "texto novo"</h4>
        <Note kind="warning">
          Quando o user apaga TUDO e escreve texto MUITO maior (sem common prefix/suffix E newText {">"} oldText × 2), o sistema considera reset e zera per-char. Evita o caso "123456 vira Carlos Antonio com cores embaralhadas".
        </Note>

        <h4 style={{ fontSize: 14, marginTop: 16 }}>Espaço (" ")</h4>
        <p>É um char regular — recebe override per-char como qualquer letra. A cor "anda" com o texto via posição (line, col). <Code>\n</Code> NÃO recebe override (só estrutura).</p>
      </>
    ),
  },
  {
    id: "logica-bg",
    title: "BG (background): bgLayers vs bgColor legacy",
    category: "logica",
    summary: "Schema unificado pra suportar solid/gradient/image",
    content: (
      <>
        <p>BG tem 2 esquemas que coexistem:</p>
        <ul>
          <li><Code>bgColor</Code> + <Code>bgOpacity</Code> — legacy escalar (back-compat)</li>
          <li><Code>bgLayers[]</Code> — novo schema (array de layers: solid/gradient/image)</li>
        </ul>
        <Note kind="info">
          <strong>bgLayers é fonte canônica.</strong> bgColor legacy é DERIVADO no save (helper <Code>bgLegacyFields</Code>) pra renderers antigos que ainda leem o campo escalar.
        </Note>
        <p>Helper central: <Code>lib/bgLayers.ts</Code> exporta <Code>bgFromAny(source)</Code> (lê preferindo bgLayers, fallback bgColor) e <Code>packBgForSave(layers)</Code> (empacota com derivados).</p>

        <h4 style={{ fontSize: 14, marginTop: 16 }}>Steps com BG isolado</h4>
        <p>Cada step da peça tem seu próprio <Code>bgLayers</Code>. Deep-clone forçado em <Code>snapshotStep</Code> evita que mutate em step ativo vaze pra inativos.</p>
      </>
    ),
  },
  {
    id: "logica-render",
    title: "Pipeline de renderização (canvas, thumb, export)",
    category: "logica",
    summary: "Quem renderiza o quê e como ficam consistentes",
    content: (
      <>
        <p>O ZZOSY tem 4 lugares onde uma peça é renderizada:</p>
        <table style={TABLE_STYLE}>
          <thead><tr><th style={TH_STYLE}>Onde</th><th style={TH_STYLE}>Função</th><th style={TH_STYLE}>Quando</th></tr></thead>
          <tbody>
            <tr><td style={TD_STYLE}>Editor canvas</td><td style={TD_STYLE}><Code>addAssetToCanvas</Code></td><td style={TD_STYLE}>User abre /editor</td></tr>
            <tr><td style={TD_STYLE}>Thumb client</td><td style={TD_STYLE}><Code>buildThumbnailFromPieceData</Code></td><td style={TD_STYLE}>Save piece, edit asset, regen</td></tr>
            <tr><td style={TD_STYLE}>Thumb server (fallback)</td><td style={TD_STYLE}><Code>serverThumbRender</Code></td><td style={TD_STYLE}>SSR/cron sem browser</td></tr>
            <tr><td style={TD_STYLE}>Export PSD/PNG/JPG</td><td style={TD_STYLE}><Code>buildPieceCanvas</Code></td><td style={TD_STYLE}>User clica Export</td></tr>
          </tbody>
        </table>
        <Note kind="tip">
          Thumb client e export usam <strong>o mesmo</strong> <Code>buildPieceCanvas</Code> (consolidado em 2026-05-28). Sem divergência entre o que aparece no card e o que exporta.
        </Note>
      </>
    ),
  },
  {
    id: "logica-broadcast",
    title: "Broadcast cross-tab (preview realtime)",
    category: "logica",
    summary: "Como mudanças em uma aba refletem em outras",
    content: (
      <>
        <p>Dois canais BroadcastChannel:</p>
        <ul>
          <li><Code>zzosy:pieces</Code> → evento <Code>piece-updated</Code> (pieceId, campaignId)</li>
          <li><Code>zzosy:campaigns</Code> → evento <Code>kv-updated</Code> ou <Code>campaign-updated</Code></li>
        </ul>
        <p>Listeners em: <Code>/pieces</Code>, <Code>/campaigns/[id]</Code>, <Code>/campaigns/[id]/presentation</Code>, <Code>/clients/[id]/library</Code>.</p>
        <Note kind="info">
          Edição em uma aba dispara broadcast → outras abas fazem refetch + regen thumb. Stale state = bug.
        </Note>
      </>
    ),
  },

  // ============================================================
  // INTEGRAÇÃO
  // ============================================================
  {
    id: "integracao-psd",
    title: "PSD round-trip (import → edit → export)",
    category: "integracao",
    summary: "Cadeia completa pra preservar fidelidade Photoshop",
    content: (
      <>
        <p>Toda prop editável precisa passar por 6 steps (ag-psd ↔ canonical model ↔ Fabric):</p>
        <pre style={PRE_STYLE}>{`1. Reader     (lib/psd/reader.ts)      — extrai do PSD
2. toCampaign (lib/psd/toCampaign.ts)  — emite asset+layer
3. Persist    (/api/.../import-psd)    — grava DB
4. Editor     (addAssetToCanvas)       — renderiza Fabric
5. Export     (lib/exportPiece.ts)     — Fabric → ag-psd
6. Writer     (lib/psd/writer.ts)      — grava PSD`}</pre>
        <Note kind="warning">
          Esquecer 1 step = drift/perda. Todo fix de import requer revisar export equivalente.
        </Note>
        <h4 style={{ fontSize: 14, marginTop: 16 }}>Texto PSD</h4>
        <ul>
          <li>Per-char styles via <Code>obj.styles[line][col]</Code> (formato Fabric)</li>
          <li>Conversão array⇄object via <Code>util.stylesFromArray</Code> (Fabric v7 array vs runtime object)</li>
          <li>fontWeight encoded no font.name no PSD (ex: "Exo 2 Black" = 900)</li>
          <li><Code>charSpacing</Code> per-char não suportado em Fabric v6.9.1 (monkey-patch em <Code>fabricCharSpacingPatch</Code>)</li>
        </ul>
        <h4 style={{ fontSize: 14, marginTop: 16 }}>Shape PSD</h4>
        <ul>
          <li>PSD shape vetorial → asset.type=SHAPE</li>
          <li>Editor renderiza como Fabric.Path com fill/stroke editáveis</li>
          <li>Export volta como shape vetorial (vectorMask preservado)</li>
          <li><strong>Nunca rasterizar shape silenciosamente</strong></li>
        </ul>
      </>
    ),
  },
  {
    id: "integracao-library",
    title: "Client Library (assets reutilizáveis)",
    category: "integracao",
    summary: "Modelo Figma main ↔ instance",
    content: (
      <>
        <p>O cliente tem uma library de assets (logo, ilustrações, blocos de texto). Cada CampaignAsset pode ser uma INSTANCE de um ClientLibraryAsset (linked).</p>
        <ul>
          <li><Code>libraryAssetId</Code> — referência ao main asset</li>
          <li><Code>libraryAssetVersion</Code> — versão sincronizada</li>
          <li><Code>libraryAssetDetached</Code> — flag de override local (instance modificada)</li>
        </ul>
        <p>Salvar uma campanha asset no library cria o main + linka a instance. <Code>/clients/[id]/library</Code> lista todos os mains.</p>
      </>
    ),
  },
  {
    id: "integracao-design-tokens",
    title: "Design tokens (CSS vars editáveis)",
    category: "integracao",
    summary: "Customizar paddings, cores, fonts via slider",
    content: (
      <>
        <p>Sistema de tokens CSS persistidos em localStorage. <Code>/admin/settings/design-tokens</Code> tem editor com preview ao vivo.</p>
        <p>Grupos:</p>
        <ul>
          <li><strong>Cor</strong>: brand primary, text, semantic (danger/info/etc)</li>
          <li><strong>Borda / Raio / Traço</strong>: bordas e espessuras</li>
          <li><strong>Tipografia</strong>: font-family, font sizes XS..display</li>
          <li><strong>Linhas</strong>: padding/gap de table rows e list items</li>
          <li><strong>Botões</strong>: padding/font/gap de botões compactos (row de 4)</li>
          <li><strong>Cards</strong>: grid min, gap, padding interno</li>
        </ul>
        <Note kind="info">
          <Code>DesignTokensInjector</Code> (em providers.tsx) lê localStorage no boot e injeta no <Code>{`<html>`}</Code>. Todo componente que usa <Code>{`var(--zz-*)`}</Code> reage live.
        </Note>
      </>
    ),
  },

  // ============================================================
  // TUTORIAIS (placeholder — expandir conforme produto evolui)
  // ============================================================
  {
    id: "tutorial-primeira-campanha",
    title: "Criar sua primeira campanha",
    category: "tutoriais",
    summary: "Passo-a-passo do zero ao primeiro export",
    content: (
      <>
        <Note kind="info">Conteúdo em construção. Estrutura sugerida abaixo.</Note>
        <ol style={{ fontSize: 14, lineHeight: 1.7 }}>
          <li>Criar cliente em <Code>/clients</Code> (definir brand colors, fonte)</li>
          <li>Criar campanha em <Code>/campaigns</Code> linkada ao cliente</li>
          <li>Importar PSD ou criar matriz do zero no editor</li>
          <li>Definir assets (TEXT/SHAPE/IMAGE) e seus per-char</li>
          <li>Gerar peças nos formatos desejados (Banner Mobile, Stories, etc)</li>
          <li>Revisar peças em <Code>/campaigns/[id]</Code> e exportar PSD/PNG</li>
        </ol>
      </>
    ),
  },
  {
    id: "tutorial-per-char",
    title: "Per-char coloring (cor por letra)",
    category: "tutoriais",
    summary: "Pintar letras individuais com cores diferentes",
    content: (
      <>
        <Note kind="info">Conteúdo em construção.</Note>
        <ol style={{ fontSize: 14, lineHeight: 1.7 }}>
          <li>Abra a peça/matriz no editor</li>
          <li>Duplo-clique no textbox pra entrar em edição</li>
          <li>Selecione um ou mais chars (drag ou shift+arrow)</li>
          <li>No painel direito, clique no swatch de cor — aplica só nos selecionados</li>
          <li>Repita pra cada cor desejada</li>
          <li>Salva automaticamente após sair da edição (debounce 400ms)</li>
        </ol>
        <Note kind="tip">
          Pinte espaços também! Senão eles ficam com default e podem destoar quando o texto for editado depois.
        </Note>
      </>
    ),
  },
  {
    id: "tutorial-import-psd",
    title: "Importar PSD do Photoshop",
    category: "tutoriais",
    summary: "Como trazer um design completo do PS",
    content: (
      <>
        <Note kind="info">Conteúdo em construção.</Note>
        <ol style={{ fontSize: 14, lineHeight: 1.7 }}>
          <li>Abra a matriz da campanha no editor</li>
          <li>Clique em "Import PSD" no topo</li>
          <li>Selecione o arquivo .psd</li>
          <li>Aguarde o import (text layers, shapes, masks, effects preservados)</li>
          <li>Valide layers nomeados — eles viram CampaignAssets</li>
          <li>Edite o que precisar e gere as peças</li>
        </ol>
      </>
    ),
  },
]
