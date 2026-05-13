/* eslint-disable */
/**
 * Test e2e do fluxo de Steps em pecas.
 *
 * 1. Cria 1 client, 1 campaign, 1 asset
 * 2. Cria 1 peca com 3 steps via piece.data direto no banco
 * 3. Confirma que o GET /api/pieces?campaignId=X retorna steps[] populados
 * 4. Lista path dos arquivos /public/uploads/step-thumbs/ pra ver se existem
 *
 * Uso:
 *   cd ~/Desktop/BACKEND/zzysy/apps/web && node scripts/test-steps-flow.js
 */
const { PrismaClient } = require("@prisma/client")
const fs = require("fs")
const path = require("path")

const prisma = new PrismaClient()

async function main() {
  console.log("=== TESTE E2E STEPS FLOW ===\n")

  // Pega o primeiro tenant (assumindo que ja tem user seedado)
  const tenant = await prisma.tenant.findFirst()
  if (!tenant) { console.error("Sem tenant. Roda seed-admin.js primeiro."); process.exit(1) }
  console.log("Tenant:", tenant.id, tenant.name)

  // 1. Cria cliente de teste
  const client = await prisma.client.create({
    data: { tenantId: tenant.id, name: "TEST CLIENT " + Date.now() },
  })
  console.log("Cliente criado:", client.id)

  // 2. Cria campanha
  const campaign = await prisma.campaign.create({
    data: { clientId: client.id, name: "TEST CAMPAIGN" },
  })
  console.log("Campanha criada:", campaign.id)

  // 3. Cria asset TEXT
  const asset = await prisma.campaignAsset.create({
    data: {
      campaignId: campaign.id,
      type: "TEXT",
      label: "Titulo Teste",
      content: JSON.stringify([{ text: "Hello World", style: { fontSize: 80, color: "#111111" } }]),
      order: 0,
    },
  })
  console.log("Asset criado:", asset.id)

  // 4. Cria peca com 3 steps no piece.data
  const pieceData = {
    width: 1080, height: 1080, bgColor: "#ffffff",
    layers: [
      { assetId: asset.id, posX: 100, posY: 100, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 0, width: 800, height: 200, overrides: {} },
    ],
    steps: [
      {
        layers: [{ assetId: asset.id, posX: 100, posY: 100, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 0, width: 800, height: 200, overrides: {} }],
        bgColor: "#ffffff",
      },
      {
        layers: [{ assetId: asset.id, posX: 200, posY: 200, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 0, width: 800, height: 200, overrides: {} }],
        bgColor: "#f5f5f5",
      },
      {
        layers: [{ assetId: asset.id, posX: 300, posY: 300, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 0, width: 800, height: 200, overrides: {} }],
        bgColor: "#e0e0e0",
      },
    ],
    activeStepIndex: 0,
  }
  const piece = await prisma.piece.create({
    data: {
      campaignId: campaign.id,
      name: "TEST PIECE - 3 STEPS",
      data: JSON.stringify(pieceData),
    },
  })
  console.log("Peca criada:", piece.id, "com", pieceData.steps.length, "steps")

  // 5. Re-le do banco e valida
  const fresh = await prisma.piece.findUnique({ where: { id: piece.id } })
  const data = JSON.parse(fresh.data)
  console.log("\n=== VALIDACAO DO QUE FOI GRAVADO ===")
  console.log("data.steps existe?", Array.isArray(data.steps))
  console.log("data.steps.length:", data.steps?.length)
  console.log("data.activeStepIndex:", data.activeStepIndex)
  console.log("data.steps[0].layers.length:", data.steps?.[0]?.layers?.length)
  console.log("data.steps[0].imageUrl:", data.steps?.[0]?.imageUrl ?? "null (esperado — autoGen nao rodou)")

  // 6. Verifica diretorio de uploads
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "step-thumbs")
  console.log("\n=== PASTA step-thumbs ===")
  console.log("Caminho:", uploadsDir)
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir)
    console.log("Arquivos:", files.length)
    files.slice(0, 5).forEach(f => console.log("  -", f))
  } else {
    console.log("PASTA NAO EXISTE — sera criada quando o primeiro thumb for gerado.")
  }

  console.log("\n=== INSTRUCOES PRA TESTAR NA UI ===")
  console.log("1. Abre http://localhost:3000/campaigns/" + campaign.id)
  console.log("2. Clica na peca 'TEST PIECE - 3 STEPS' → editor")
  console.log("3. Espera 2 segundos (autoGen offscreen)")
  console.log("4. Volta pra apresentacao: http://localhost:3000/campaigns/" + campaign.id + "/presentation")
  console.log("5. Os 3 steps devem aparecer lado a lado com preview")
  console.log("\nPra ver estado do banco em qualquer momento:")
  console.log("curl -s 'http://localhost:3000/api/debug/fix-steps?pieceId=" + piece.id + "' | python3 -m json.tool")
}

main()
  .catch(e => { console.error("ERRO:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
