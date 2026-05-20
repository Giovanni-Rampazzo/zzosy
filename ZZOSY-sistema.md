# ZZOSY — Documentação do Sistema

## Sobre
Sistema SaaS de automação de layout para campanhas publicitárias.
Arquitetura multitenancy — cada agência tem seu próprio espaço isolado.

---

## Stack Técnico

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router) |
| Monorepo | Turborepo |
| Autenticação | NextAuth.js |
| ORM | Prisma |
| Banco de dados | MySQL |
| Hospedagem DB | Railway |
| Hospedagem App | Vercel (futuro) |
| Estilização | Tailwind CSS + inline styles |
| Linguagem | TypeScript |

---

## Estrutura de Pastas

```
zzosy/
├── apps/
│   └── web/                        # App Next.js principal
│       ├── app/
│       │   ├── (auth)/
│       │   │   ├── login/page.tsx
│       │   │   └── register/page.tsx
│       │   ├── api/
│       │   │   ├── auth/[...nextauth]/route.ts
│       │   │   ├── register/route.ts
│       │   │   └── webhooks/
│       │   ├── admin/
│       │   ├── dashboard/
│       │   ├── editor/
│       │   ├── pieces/
│       │   ├── plans/
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── components/
│       ├── lib/
│       │   ├── auth.ts             # Configuração NextAuth
│       │   ├── prisma.ts           # Cliente Prisma
│       │   └── theme.js            # Tema visual do sistema
│       └── prisma/
│           └── schema.prisma       # Schema do banco
└── packages/
```

---

## Banco de Dados — Railway MySQL

| | |
|---|---|
| **Host público** | tramway.proxy.rlwy.net |
| **Porta** | 27292 |
| **Usuário** | root |
| **Senha** | YwkxxacsibywDQoOlJJdXhnmniUQKgTO |
| **Database** | railway |
| **URL pública** | `mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@tramway.proxy.rlwy.net:27292/railway` |
| **URL interna** | `mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@mysql.railway.internal:3306/railway` |

> URL interna: usar quando o app estiver hospedado no Railway.
> URL pública: usar em desenvolvimento local.

---

## Variáveis de Ambiente (apps/web/.env)

```env
DATABASE_URL="mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@tramway.proxy.rlwy.net:27292/railway"
NEXTAUTH_SECRET="5w00QFuAKAmWIZVI5reDuXld3jBUqeSChj1+uGFpqa8="
NEXTAUTH_URL="http://localhost:3000"
```

> Em produção, trocar NEXTAUTH_URL para o domínio real.

---

## Modelos do Banco (Prisma)

- **Tenant** — Agência/empresa (multitenancy)
- **User** — Usuário vinculado a um tenant (roles: SUPER_ADMIN, ADMIN, USER)
- **Account / Session / VerificationToken** — NextAuth
- **Plan** — Planos de assinatura (Starter, Pro, Agency)
- **Subscription** — Assinatura de um tenant
- **Campaign** — Campanha publicitária
- **Matrix** — Editor principal da campanha
- **Piece** — Peças/desdobramentos da campanha

---

## URLs Locais

| Página | URL |
|---|---|
| Home | http://localhost:3000 |
| Login | http://localhost:3000/login |
| Cadastro | http://localhost:3000/register |
| Dashboard | http://localhost:3000/dashboard |
| Editor | http://localhost:3000/editor |
| Peças | http://localhost:3000/pieces |
| Planos | http://localhost:3000/plans |
| Admin | http://localhost:3000/admin |

---

## Conta de Teste Criada

| | |
|---|---|
| **Nome** | Giovanni |
| **Agência** | GIOBA |
| **Slug** | gioba |
| **E-mail** | teste@teste.com |
| **Senha** | 12345678 |
| **Role** | ADMIN |

---

## Comandos Úteis

```bash
# Entrar na pasta do projeto
cd "/Users/democrart/Library/CloudStorage/GoogleDrive-zzocreativee@gmail.com/My Drive/ZZOSY/BACKEND/zzysy"

# Rodar em desenvolvimento
npm run dev

# Sincronizar schema com banco
cd apps/web && npx prisma db push

# Visualizar banco de dados
cd apps/web && npx prisma studio
```

---

## Identidade Visual

- **Cores:** Preto `#111111`, Branco `#FFFFFF`, Amarelo `#F5C400`, Verde `#34A853`, Azul `#4285F4`
- **Fonte:** DM Sans
- **Estilo:** Minimalista / clean
- **Theme file:** `apps/web/lib/theme.js`

---

## Status Atual

- [x] Estrutura do projeto (Turborepo + Next.js)
- [x] Banco de dados MySQL no Railway
- [x] Schema Prisma com multitenancy
- [x] Autenticação (NextAuth + bcrypt)
- [x] Tela de login
- [x] Tela de cadastro
- [x] API de registro (cria tenant + admin)
- [x] Dashboard (placeholder)
- [ ] Dashboard completo
- [ ] Editor de matriz
- [ ] Tela de peças
- [ ] Planos e assinatura
- [ ] Painel admin
- [ ] Landing page
- [ ] Deploy (Vercel + Railway)
