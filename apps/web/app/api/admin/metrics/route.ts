import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiErrors } from "@/lib/apiError";

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return apiErrors.unauthorized();
    const me = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!me || me.role !== "SUPER_ADMIN") return apiErrors.forbidden();

    const [totalUsers, totalCampaigns, totalPieces, recentUsers] = await Promise.all([
      prisma.user.count(),
      prisma.campaign.count(),
      prisma.piece.count(),
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id:true, name:true, email:true, createdAt:true } }),
    ]);

    return NextResponse.json({ totalUsers, totalCampaigns, totalPieces, mrr: 0, paying: 0, usersByPlan: [], recentUsers });
  } catch(e: any) {
    console.error("[admin/metrics] failed:", e?.message ?? e);
    return apiErrors.internal();
  }
}
