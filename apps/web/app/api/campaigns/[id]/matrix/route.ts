import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  console.log("GET matrix - session:", session?.user?.email, "id:", id);
  const matrix = await prisma.matrix.findUnique({ where: { campaignId: id } });
  return NextResponse.json({ data: matrix?.data ?? null });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  console.log("POST matrix - session:", session?.user?.email, "id:", id);
  const { data } = await req.json();
  await prisma.matrix.upsert({
    where: { campaignId: id },
    update: { data },
    create: { campaignId: id, data },
  });
  return NextResponse.json({ ok: true });
}
