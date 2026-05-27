import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

// MUTEX 2026-05-27: serializa updates de piece.data por pieceId pra evitar
// race condition. Multiple step-thumbnail uploads em paralelo (step 0,1,2)
// liam mesmo snapshot, cada um modificava SEU step, ultimo write sobrescrevia
// os outros — "previews misturados" reportado pelo user.
//
// Strategy: cada call espera a promise anterior do mesmo pieceId. Promise
// resolve quando update terminou (sucesso OU erro — catch impede stuck).
const __pieceUpdateLocks = new Map<string, Promise<unknown>>()

async function withPieceLock<T>(pieceId: string, work: () => Promise<T>): Promise<T> {
  const prev = __pieceUpdateLocks.get(pieceId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(work)
  __pieceUpdateLocks.set(pieceId, next.catch(() => {}))
  return next
}

/**
 * Upload de thumbnail de um STEP especifico da peca.
 *
 * Persiste via storage adapter (LocalFile: /uploads/step-thumbs/, S3: prefixo
 * step-thumbs/). Injeta URL retornado em piece.data.steps[index].imageUrl
 * (e thumbnailUrl).
 *
 * Index 0-based: ?index=0 = step 1, ?index=1 = step 2, etc.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // ERROR LOGGING 2026-05-27: user reportou 500 nos /thumbnail e /step-thumbnail.
  // Antes nao havia try/catch — erros viravam Next 500 sem detalhe no log.
  // Agora retorna stack + step + key + piece id pra debug.
  let stage = "init"
  let stageData: any = {}
  try {
    stage = "auth"
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()

    stage = "parse-params"
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const indexStr = searchParams.get("index")
    const index = indexStr ? parseInt(indexStr, 10) : NaN
    stageData = { id, index, indexStr }
    if (!Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: "index obrigatorio (numero >= 0)", stageData }, { status: 400 })
    }

    stage = "lookup-piece"
    const tenantId = (session.user as any).tenantId
    stageData.tenantId = tenantId
    const piece = await prisma.piece.findFirst({
      where: { id, campaign: { client: { tenantId } } },
    })
    if (!piece) return apiErrors.notFound()

    stage = "parse-formdata"
    const formData = await req.formData()
    const file = formData.get("thumbnail") as File | null
    if (!file) return NextResponse.json({ error: "Sem arquivo", stageData }, { status: 400 })
    stageData.fileSize = file.size
    stageData.fileType = file.type

    stage = "storage-put"
    const bytes = Buffer.from(await file.arrayBuffer())
    const ts = Date.now()
    const key = `step-thumbs/${id}_step${index}_${ts}.png`
    stageData.key = key
    const { url: publicUrl } = await getStorage().put(key, bytes, "image/png")
    stageData.publicUrl = publicUrl

    // SERIALIZADO 2026-05-27: read+modify+write protegido pelo mutex.
    // Multiplos uploads paralelos (step 0,1,2) liam snapshot identico e
    // ultimo write sobrescrevia os anteriores — 'previews misturados'.
    await withPieceLock(id, async () => {
      stage = "re-read-piece"
      const fresh = await prisma.piece.findUnique({ where: { id } })
      if (!fresh) throw new Error("piece desapareceu durante upload")

      stage = "parse-data"
      let data: any = {}
      if (fresh.data) {
        try {
          data = JSON.parse(fresh.data)
        } catch (e: any) {
          console.error("[step-thumbnail] piece.data JSON malformado:", id, e?.message)
          data = {}
        }
      }
      if (!Array.isArray(data.steps)) data.steps = []
      while (data.steps.length <= index) data.steps.push({ layers: [], bgColor: data.bgColor ?? "#ffffff" })
      data.steps[index] = {
        ...data.steps[index],
        imageUrl: publicUrl,
        thumbnailUrl: publicUrl,
      }

      stage = "prisma-update"
      await prisma.piece.update({
        where: { id },
        data: { data: JSON.stringify(data) },
      })
    })

    return NextResponse.json({ imageUrl: publicUrl, index })
  } catch (err: any) {
    console.error(`[step-thumbnail] ERROR stage=${stage}:`, err?.message, err?.stack?.split("\n").slice(0, 4).join(" | "))
    return NextResponse.json({
      error: err?.message ?? "Erro",
      stage,
      stageData,
      stack: err?.stack?.split("\n").slice(0, 6).join("\n"),
    }, { status: 500 })
  }
}
