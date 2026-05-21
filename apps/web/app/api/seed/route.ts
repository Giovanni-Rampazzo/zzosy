import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const DEFAULT_FORMATS = [
  // Digital
  { vehicle: "Instagram", media: "Feed", format: "Post Quadrado", width: 1080, height: 1080, dpi: 72, category: "DIGITAL" },
  { vehicle: "Instagram", media: "Feed", format: "Post Retrato", width: 1080, height: 1350, dpi: 72, category: "DIGITAL" },
  { vehicle: "Instagram", media: "Stories/Reels", format: "Vertical", width: 1080, height: 1920, dpi: 72, category: "DIGITAL" },
  { vehicle: "Facebook", media: "Feed", format: "Post", width: 1200, height: 628, dpi: 72, category: "DIGITAL" },
  { vehicle: "Facebook", media: "Stories", format: "Vertical", width: 1080, height: 1920, dpi: 72, category: "DIGITAL" },
  { vehicle: "LinkedIn", media: "Feed", format: "Post", width: 1200, height: 628, dpi: 72, category: "DIGITAL" },
  { vehicle: "LinkedIn", media: "Capa", format: "Banner", width: 1584, height: 396, dpi: 72, category: "DIGITAL" },
  { vehicle: "WhatsApp", media: "Status", format: "Vertical", width: 1080, height: 1920, dpi: 72, category: "DIGITAL" },
  { vehicle: "TikTok", media: "Vídeo/Post", format: "Vertical", width: 1080, height: 1920, dpi: 72, category: "DIGITAL" },
  { vehicle: "YouTube", media: "Thumbnail", format: "16:9", width: 1280, height: 720, dpi: 72, category: "DIGITAL" },
  { vehicle: "Google", media: "Display", format: "Retângulo", width: 300, height: 250, dpi: 72, category: "DIGITAL" },
  { vehicle: "Google", media: "Display", format: "Leaderboard", width: 728, height: 90, dpi: 72, category: "DIGITAL" },
  { vehicle: "Google", media: "Display", format: "Half Page", width: 300, height: 600, dpi: 72, category: "DIGITAL" },
  // Offline
  { vehicle: "Outdoor", media: "OOH", format: "Padrão 3:1", width: 9000, height: 3000, dpi: 150, category: "OFFLINE" },
  { vehicle: "Busdoor", media: "OOH", format: "Traseiro", width: 1400, height: 600, dpi: 150, category: "OFFLINE" },
  { vehicle: "Revista", media: "Impresso", format: "Página Simples", width: 2100, height: 2800, dpi: 300, category: "OFFLINE" },
  { vehicle: "Revista", media: "Impresso", format: "Dupla Página", width: 4200, height: 2800, dpi: 300, category: "OFFLINE" },
  { vehicle: "Jornal", media: "Impresso", format: "Página Simples", width: 3200, height: 4500, dpi: 300, category: "OFFLINE" },
  { vehicle: "Jornal", media: "Impresso", format: "Meia Página", width: 3200, height: 2250, dpi: 300, category: "OFFLINE" },
  { vehicle: "Flyer", media: "Impresso", format: "A4", width: 2480, height: 3508, dpi: 300, category: "OFFLINE" },
  { vehicle: "Flyer", media: "Impresso", format: "A5", width: 1748, height: 2480, dpi: 300, category: "OFFLINE" },
]

export async function POST() {
  // Audit P1.8: agora exige SUPER_ADMIN. Antes era aberto — qualquer um podia
  // re-popular media formats globais.
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const existing = await prisma.mediaFormat.count({ where: { isDefault: true } })
  if (existing > 0) return NextResponse.json({ message: "Já populado", count: existing })

  await prisma.mediaFormat.createMany({
    data: DEFAULT_FORMATS.map(f => ({ ...f, isDefault: true, category: f.category as any }))
  })

  return NextResponse.json({ ok: true, count: DEFAULT_FORMATS.length })
}
