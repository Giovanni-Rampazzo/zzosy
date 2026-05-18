import { NextResponse } from "next/server";

// Modelos Subscription/Plan foram removidos do schema Prisma. Endpoint mantido
// pra nao quebrar /dashboard/billing — devolve placeholder "FREE" pra UI
// renderizar normalmente. Quando billing voltar, restaurar a versao
// que consulta Prisma.subscription.
export async function GET() {
  return NextResponse.json({
    plan: "FREE",
    status: "inactive",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });
}

