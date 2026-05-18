import { NextResponse } from "next/server";

// Modelo `matrix` foi substituido por KeyVision no schema atual. Endpoint
// mantido como stub pra responder 410 Gone caso algum cliente legado ainda
// chame (em vez de 500). Nada no codebase atual aponta pra ele.
export async function GET() {
  return NextResponse.json({ error: "Endpoint deprecado — use /api/campaigns/[id]/key-vision" }, { status: 410 });
}
export async function POST() {
  return NextResponse.json({ error: "Endpoint deprecado — use /api/campaigns/[id]/key-vision" }, { status: 410 });
}
