import { NextResponse } from "next/server";

// Subscription removida do schema Prisma. Endpoint stub pra UI nao 500.
export async function POST() {
  return NextResponse.json({ error: "Billing temporariamente indisponivel" }, { status: 503 });
}
