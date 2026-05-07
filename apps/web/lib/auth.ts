import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { tenant: true },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        if (user.blocked) throw new Error("BLOCKED");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          tenantSlug: user.tenant.slug,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Login inicial: copia os dados do user pro token
        token.id = user.id;
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.tenantSlug = (user as any).tenantSlug;
        return token;
      }
      // Em chamadas seguintes, revalida que o user/tenant ainda existem.
      // Se o banco foi resetado, a sessao antiga eh invalidada (token vira nulo).
      if (token.id) {
        try {
          const stillExists = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { id: true, tenantId: true, role: true },
          });
          if (!stillExists) {
            // User deletado/banco resetado — invalida o token forcando logout
            return null as any;
          }
          // Sincroniza tenantId e role caso tenham mudado no banco
          token.tenantId = stillExists.tenantId;
          token.role = stillExists.role;
        } catch (e) {
          // Em caso de DB indisponivel, mantem o token (nao bloqueia o user)
          console.warn("[auth] falha ao revalidar user:", e);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).tenantSlug = token.tenantSlug;
      }
      return session;
    },
  },
};
