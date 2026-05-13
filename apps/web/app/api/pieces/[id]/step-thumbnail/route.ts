import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

/**
 * Upload de thumbnail de um STEP especifico da peca.
 *
 * Salva o arquivo em /public/uploads/step-thumbs/{pieceId}_step{N}_{ts}.png
 * e injeta o caminho no piece.data.steps[index].imageUrl (e thumbnailUrl).
 *
 * Index 0-based: ?index=0 = step 1, ?index=1 = step 2, etc.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const indexStr = searchParams.get("index")
  const index = indexStr ? parseInt(indexStr, 10) : NaN
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "index obrigatorio (numero >= 0)" }, { status: 400 })
  }
  const tenantId = (session.user as any).tenantId
  const piece = await prisma.piece.findFirst({
    where: { id, campaign: { client: { tenantId } } },
  })
  if (!piece) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Recebe o arquivo via FormData (campo "thumbnail")
  const formData = await req.formData()
  const file = formData.get("thumbnail") as File | null
  if (!file) return NextResponse.json({ error: "Sem arquivo" }, { status: 400 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "step-thumbs")
  await mkdir(uploadsDir, { recursive: true })
  const ts = Date.now()
  const filename = `${id}_step${index}_${ts}.png`
  const filePath = path.join(uploadsDir, filename)
  await writeFile(filePath, bytes)
  const publicUrl = `/uploads/step-thumbs/${filename}`

  // Atualiza piece.data.steps[index].imageUrl + thumbnailUrl.
  // CRITICO: re-le piece JUSTAMENTE antes do update pra pegar a versao mais
  // recente do banco. Sem isso, outro save concorrente (ex: editor salvando
  // data.steps inteiro) poderia sobrescrever as edicoes do user com um
  // snapshot velho. Aqui queremos apenas adicionar imageUrl/thumbnailUrl
  // ao step especifico, NAO sobrescrever layers/bgColor.
  const fresh = await prisma.piece.findUnique({ where: { id } })
  if (!fresh) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const data: any = fresh.data ? JSON.parse(fresh.data) : {}
  if (!Array.isArray(data.steps)) data.steps = []
  while (data.steps.length <= index) data.steps.push({ layers: [], bgColor: data.bgColor ?? "#ffffff" })
  data.steps[index] = {
    ...data.steps[index],
    imageUrl: publicUrl,
    thumbnailUrl: publicUrl,
  }

  await prisma.piece.update({
    where: { id },
    data: { data: JSON.stringify(data) },
  })

  return NextResponse.json({ imageUrl: publicUrl, index })
}
