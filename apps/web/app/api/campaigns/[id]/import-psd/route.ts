import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"

type Ctx = { params: Promise<{ id: string }> }

export const maxDuration = 60

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await ctx.params

    const formData = await req.formData()
    const psdFile = formData.get("psd") as File
    const assetsJson = formData.get("assets") as string
    const canvasWidth = Number(formData.get("canvasWidth"))
    const canvasHeight = Number(formData.get("canvasHeight"))
    const bgColor = (formData.get("bgColor") as string) ?? "#ffffff"
    const images = formData.getAll("images") as File[]
    // Smart objects: arquivos linkados originais + metadados (mesmo index)
    const linkedFilesUploaded = formData.getAll("linked") as File[]
    const linkedMetaJson = formData.get("linkedMeta") as string | null
    // Flag pra pular salvar o PSD master (quando PSD eh muito grande pra
    // vir no mesmo FormData; upload chunked acontecera em seguida).
    const skipMaster = formData.get("skipMaster") === "1"
    const psdNameOnly = formData.get("psdName") as string | null

    if (!assetsJson) {
      return NextResponse.json({ error: "Assets sao obrigatorios" }, { status: 400 })
    }
    if (!skipMaster && !psdFile) {
      return NextResponse.json({ error: "PSD eh obrigatorio (ou envie skipMaster=1)" }, { status: 400 })
    }

    const assets = JSON.parse(assetsJson) as Array<{
      label: string
      type: "TEXT" | "IMAGE"
      content?: any
      imageIndex?: number
      linkedIndex?: number
      posX: number
      posY: number
      width: number
      height: number
      zIndex: number
      lastOverride?: any
      mask?: any
      hidden?: boolean
      locked?: boolean
      opacity?: number
      blendMode?: string
      effects?: any
    }>

    const linkedMeta = linkedMetaJson ? JSON.parse(linkedMetaJson) as Array<{
      guid: string; mime: string; originalName: string; sizeBytes: number; width?: number; height?: number
    }> : []

    // Pasta de uploads desta campanha
    const uploadDir = path.join(process.cwd(), "public", "uploads", "campaigns", id)
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }

    // Salvar PSD original (se enviado inline). Se skipMaster, psdUrl fica null
    // e sera preenchido depois via upload chunked.
    console.log("[import-psd] iniciando upload, images:", images.length, "assets:", assets.length, "skipMaster:", skipMaster)
    let psdUrl: string | null = null
    if (!skipMaster && psdFile) {
      const psdBuffer = Buffer.from(await psdFile.arrayBuffer())
      const psdFilename = `master-${randomUUID()}.psd`
      const psdPath = path.join(uploadDir, psdFilename)
      await writeFile(psdPath, psdBuffer)
      psdUrl = `/uploads/campaigns/${id}/${psdFilename}`
    }

    // Salvar imagens dos layers
    const imageUrls: string[] = []
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const buf = Buffer.from(await img.arrayBuffer())
      const imgFilename = `layer-${randomUUID()}.png`
      const imgPath = path.join(uploadDir, imgFilename)
      await writeFile(imgPath, buf)
      imageUrls.push(`/uploads/campaigns/${id}/${imgFilename}`)
    }

    // Apagar assets antigos. SmartObjectFiles NAO sao apagados em cascata aqui
    // (FK eh SetNull). Vamos limpar manualmente as antigas pra nao acumular orfaos
    // ao reimportar PSD na mesma campanha.
    await prisma.campaignAsset.deleteMany({ where: { campaignId: id } })
    await prisma.smartObjectFile.deleteMany({ where: { campaignId: id } })

    // Salvar smart objects (linkedFiles do PSD) — preserva bytes originais
    // pra round-trip ZZOSY -> Photoshop -> ZZOSY sem perda. Subdir /smart pra
    // separar dos previews PNG e do PSD master.
    const smartDir = path.join(uploadDir, "smart")
    if (!existsSync(smartDir)) await mkdir(smartDir, { recursive: true })
    // index do FormData -> id do SmartObjectFile criado
    const smartObjectIds: (string | null)[] = []
    for (let i = 0; i < linkedFilesUploaded.length; i++) {
      const f = linkedFilesUploaded[i]
      const meta = linkedMeta[i]
      if (!meta) { smartObjectIds.push(null); continue }
      try {
        const buf = Buffer.from(await f.arrayBuffer())
        // Extensao a partir do mime
        const ext =
          meta.mime === "image/svg+xml" ? "svg" :
          meta.mime === "application/pdf" ? "pdf" :
          meta.mime === "application/postscript" ? "ai" :
          meta.mime === "image/vnd.adobe.photoshop" ? "psd" :
          meta.mime === "image/png" ? "png" :
          meta.mime === "image/jpeg" ? "jpg" :
          "bin"
        const filename = `${meta.guid}.${ext}`
        const fullPath = path.join(smartDir, filename)
        await writeFile(fullPath, buf)
        const filePath = `/uploads/campaigns/${id}/smart/${filename}`
        const so = await prisma.smartObjectFile.create({
          data: {
            campaignId: id,
            guid: meta.guid,
            filePath,
            mime: meta.mime,
            originalName: meta.originalName,
            sizeBytes: meta.sizeBytes,
            width: meta.width ?? null,
            height: meta.height ?? null,
          }
        })
        smartObjectIds.push(so.id)
      } catch (e) {
        console.warn("[import-psd] falha salvando smart object", meta.guid, e)
        smartObjectIds.push(null)
      }
    }

    // Criar assets
    const created = []
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]
      const imageUrl = asset.type === "IMAGE" && asset.imageIndex !== undefined
        ? imageUrls[asset.imageIndex] ?? null
        : null
      const smartObjectId = asset.type === "IMAGE" && asset.linkedIndex !== undefined
        ? smartObjectIds[asset.linkedIndex] ?? null
        : null

      const record = await prisma.campaignAsset.create({
        data: {
          campaignId: id,
          label: asset.label,
          type: asset.type,
          content: asset.content ? JSON.stringify(asset.content) : null,
          imageUrl,
          smartObjectId,
          order: i,
          posX: asset.posX,
          posY: asset.posY,
          width: asset.width || 400,
          visible: true,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          // BOX (width/height) + CHARACTER overrides extraidos do PSD.
          // Permite que swap e re-add do asset preservem a config original do PSD.
          lastOverride: asset.lastOverride ?? null,
        }
      })
      created.push(record)
    }

    // Layers para a Matriz
    const layers = created.map((a, i) => ({
      assetId: a.id,
      posX: assets[i].posX,
      posY: assets[i].posY,
      width: assets[i].width || 400,
      height: assets[i].height || 100,
      scaleX: 1, scaleY: 1, rotation: 0,
      zIndex: assets[i].zIndex,
      // Mask extraida do PSD: raster (canvas grayscale), vector (path) ou clipping.
      // Vai no override do layer pra que cada peca possa ter mascara diferente
      // (na importacao inicial todos os layers da matriz herdam a do PSD).
      ...(assets[i].mask ? { mask: assets[i].mask } : {}),
      // Estados de visibilidade e lock do Photoshop preservados pra round-trip.
      ...(assets[i].hidden === true ? { hidden: true } : {}),
      ...(assets[i].locked === true ? { locked: true } : {}),
      // Opacity (0..1) e blendMode (canvas globalCompositeOperation) extraídos
      // do PSD. Defaults (1 e "source-over") são omitidos pra não inflar JSON.
      ...(typeof assets[i].opacity === "number" && assets[i].opacity < 1 ? { opacity: assets[i].opacity } : {}),
      ...(assets[i].blendMode && assets[i].blendMode !== "source-over" ? { blendMode: assets[i].blendMode } : {}),
      // Layer effects (drop shadow, stroke, outer glow) extraídos do PSD.
      ...(assets[i].effects && Object.keys(assets[i].effects).length > 0 ? { effects: assets[i].effects } : {}),
    }))

    // KeyVision (Matriz)
    await prisma.keyVision.upsert({
      where: { campaignId: id },
      create: {
        campaignId: id,
        data: "{}",
        bgColor,
        layers: JSON.stringify(layers),
        width: canvasWidth,
        height: canvasHeight,
      },
      update: {
        bgColor,
        layers: JSON.stringify(layers),
        width: canvasWidth,
        height: canvasHeight,
      },
    })

    // Atualizar Campaign com PSD master (se foi salvo).
    // psdName preservado mesmo sem psdUrl (pra UI mostrar o nome do arquivo
    // original ate o chunked upload terminar).
    const campaignUpdate: any = { psdName: psdFile?.name ?? psdNameOnly ?? null }
    if (psdUrl) campaignUpdate.psdUrl = psdUrl
    await prisma.campaign.update({
      where: { id },
      data: campaignUpdate,
    })

    console.log("[import-psd] concluido, assets criados:", created.length, "imageUrls:", imageUrls)
    return NextResponse.json({
      ok: true,
      assetsCreated: created.length,
      smartObjectsCreated: smartObjectIds.filter(Boolean).length,
      psdUrl,
      masterPending: skipMaster, // sinaliza pro cliente que precisa fazer upload chunked
    })
  } catch (err: any) {
    console.error("import-psd error:", err)
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 })
  }
}
