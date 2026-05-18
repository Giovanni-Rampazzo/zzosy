import { NextResponse } from "next/server";

// Stripe + modelos Subscription/Plan removidos do schema atual. Webhook
// retorna 200 silencioso pra nao causar retry tempestuoso no Stripe caso
// algum endpoint legado ainda esteja apontado pra este URL. Quando billing
// voltar, restaurar a logica de prisma.subscription.upsert.
export async function POST() {
  return NextResponse.json({ received: true, note: "billing temporariamente desativado" });
}
