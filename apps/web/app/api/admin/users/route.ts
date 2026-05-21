import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { apiErrors } from "@/lib/apiError";

export const dynamic = "force-dynamic"

async function checkSuperAdmin(email: string) {
  const me = await prisma.user.findUnique({ where: { email } });
  return me?.role === "SUPER_ADMIN" ? me : null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return apiErrors.unauthorized();
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return apiErrors.forbidden();
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
  if (!session?.user?.email) return apiErrors.unauthorized();
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return apiErrors.forbidden();
  try {
    const { name, email, password, role, tenantId } = await req.json();
    if (!email || !password) return apiErrors.badRequest("email e password obrigatórios");
    if (password.length < 8) return apiErrors.badRequest("Senha mínima 8 caracteres");
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return apiErrors.badRequest("E-mail já cadastrado");
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
    // Nao retorna e.message ao client — pode vazar info interna.
    console.error("[admin/users POST] failed:", e?.message ?? e);
    return apiErrors.badRequest("Erro ao criar usuário");
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return apiErrors.unauthorized();
  const me = await checkSuperAdmin(session.user.email);
  if (!me) return apiErrors.forbidden();
  const { id, role, blocked, password, name } = await req.json();
  if (!id) return apiErrors.badRequest("id obrigatório");
  // Nao deixa o admin alterar a propria conta por aqui (evita auto-bloqueio/auto-rebaixamento)
  if (id === me.id && (blocked === true || (role && role !== me.role))) {
    return apiErrors.badRequest("Não pode alterar role/blocked da própria conta");
  }
  const data: any = {};
  if (role !== undefined) data.role = role;
  if (blocked !== undefined) data.blocked = blocked;
  if (name !== undefined) data.name = name;
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      return apiErrors.badRequest("Senha mínima 8 caracteres");
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
