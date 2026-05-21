import { NextResponse, type NextRequest } from "next/server"
import { withAuth } from "next-auth/middleware"

// Gateway antes do NextAuth: bloqueia /api/debug/* em producao (audit P1.7).
// Esses endpoints sao ferramentas internas (db introspection, fix-* helpers,
// load-trace) que nunca deveriam ter sido acessiveis em prod.
function debugGate(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/debug/") && process.env.NODE_ENV === "production") {
    return new NextResponse(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } })
  }
  return null
}

const authMiddleware = withAuth({
  pages: { signIn: "/login" },
})

export default function middleware(req: NextRequest, ev: any) {
  const gated = debugGate(req)
  if (gated) return gated
  // Para rotas que casam o matcher abaixo, delega pro withAuth.
  return (authMiddleware as any)(req, ev)
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/clients/:path*",
    "/campaigns/:path*",
    "/editor/:path*",
    "/pieces/:path*",
    "/medias/:path*",
    "/approvals/:path*",
    "/deliveries/:path*",
    "/account/:path*",
    "/api/debug/:path*",
  ],
}
