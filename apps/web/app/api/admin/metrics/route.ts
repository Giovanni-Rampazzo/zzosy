import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const me = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!me || me.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const [totalUsers, totalCampaigns, totalPieces, recentUsers] = await Promise.all([
      prisma.user.count(),
      prisma.campaign.count(),
      prisma.piece.count(),
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id:true, name:true, email:true, createdAt:true } }),
    ]);

    return NextResponse.json({ totalUsers, totalCampaigns, totalPieces, mrr: 0, paying: 0, usersByPlan: [], recentUsers });
  } catch(e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
