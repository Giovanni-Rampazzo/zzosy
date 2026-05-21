import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

const PRICE_IDS: Record<string, string> = {
  starter: "price_1T9VgHAjOlUQNOYmVgRvGVJU",
  pro:     "price_1T9VhZAjOlUQNOYmD6RrR1SS",
  agency:  "price_1T9Vj8AjOlUQNOYm5AGhG2OB",
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { planId } = await req.json();
    const priceId = PRICE_IDS[planId];
    if (!priceId) {
      return NextResponse.json({ error: "Plano inválido" }, { status: 400 });
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: session.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL}/dashboard?upgraded=true`,
      cancel_url:  `${process.env.NEXTAUTH_URL}/plans`,
      metadata: { planId, userEmail: session.user.email },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    console.error("Stripe error:", err);
    return NextResponse.json({ error: err.message ?? "Erro interno" }, { status: 500 });
  }
}
