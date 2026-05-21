import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (me?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { to, subject, message, plan } = await req.json();

  let recipients: string[] = [];
  if (to === "all") {
    const users = await prisma.user.findMany({ select: { email: true } });
    recipients = users.map((u: {email: string}) => u.email);
  } else if (to === "plan" && plan) {
    const users = await prisma.user.findMany({ select: { email: true } });
    recipients = users.map((u: {email: string}) => u.email);
  } else if (to) {
    recipients = [to];
  }

  // TODO: integrar com Resend/SendGrid
  // Nao logar payload (subject/message + emails) — PII.
  console.log("📧 Email queued:", { count: recipients.length, hasSubject: !!subject });

  return NextResponse.json({ success: true, sent: recipients.length });
}
