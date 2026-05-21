import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic"

async function checkSuperAdmin(email: string) {
  const me = await prisma.user.findUnique({ where: { email } });
  return me?.role === "SUPER_ADMIN" ? me : null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const users = await prisma.user.findMany({
    where: search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {},
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true, tenant: { select: { id: true, name: true, slug: true } } },
  });
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { name, email, password, role, tenantId } = await req.json();
    if (!email || !password) return NextResponse.json({ error: "email e password obrigatorios" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Senha minima 8 caracteres" }, { status: 400 });
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: "Email ja cadastrado" }, { status: 400 });
    const hashed = await bcrypt.hash(password, 10);
    // tenantId default = mesmo tenant do admin que esta criando
    const finalTenantId = tenantId || me.tenantId;
    const user = await prisma.user.create({
      data: {
        name: name || null,
        email,
        password: hashed,
        role: role || "ADMIN",
        tenantId: finalTenantId,
      },
      select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true, tenant: { select: { id: true, name: true, slug: true } } },
    });
    return NextResponse.json(user);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Erro ao criar usuario" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, role, blocked, password, name } = await req.json();
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
  // Nao deixa o admin alterar a propria conta por aqui (evita auto-bloqueio/auto-rebaixamento)
  if (id === me.id && (blocked === true || (role && role !== me.role))) {
    return NextResponse.json({ error: "Nao pode alterar role/blocked da propria conta" }, { status: 400 });
  }
  const data: any = {};
  if (role !== undefined) data.role = role;
  if (blocked !== undefined) data.blocked = blocked;
  if (name !== undefined) data.name = name;
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Senha minima 8 caracteres" }, { status: 400 });
    }
    data.password = await bcrypt.hash(password, 10);
  }
  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true, tenant: { select: { id: true, name: true, slug: true } } },
  });
  return NextResponse.json(user);
}
