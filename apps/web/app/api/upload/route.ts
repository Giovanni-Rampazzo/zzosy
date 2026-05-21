import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

  // Converter para base64 data URL (temporário até ter R2)
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const base64 = buffer.toString("base64")

  // Detecta mime correto pra fonts (browser as vezes manda application/octet-stream).
  // A extensao no nome do arquivo e fonte mais confiavel que o file.type.
  let mimeType = file.type || "image/jpeg"
  const fname = (file.name || "").toLowerCase()
  if (fname.endsWith(".ttf")) mimeType = "font/ttf"
  else if (fname.endsWith(".otf")) mimeType = "font/otf"
  else if (fname.endsWith(".woff2")) mimeType = "font/woff2"
  else if (fname.endsWith(".woff")) mimeType = "font/woff"

  const dataUrl = `data:${mimeType};base64,${base64}`

  return NextResponse.json({ url: dataUrl })
}
