# ZZOSY

Sistema de automação de layout para campanhas publicitárias.

## Stack
- **Frontend/Backend**: Next.js 14 (App Router)
- **Banco**: PostgreSQL + Prisma ORM
- **Auth**: NextAuth.js
- **Pagamentos**: Stripe
- **Storage**: Cloudflare R2
- **Deploy**: Vercel (web) + Railway (banco)

## Estrutura
```
zzosy/
├── apps/
│   └── web/              → App Next.js principal
│       ├── app/          → Rotas e páginas
│       │   ├── (auth)/   → Login e cadastro
│       │   ├── dashboard/
│       │   ├── editor/   → Matriz (editor principal)
│       │   ├── pieces/   → Peças/desdobramentos
│       │   ├── plans/    → Planos e assinatura
│       │   ├── admin/    → Painel interno
│       │   └── api/      → API routes
│       ├── components/
│       ├── lib/          → prisma, auth, stripe
│       └── prisma/       → Schema do banco
└── packages/
```

## Setup local

1. Clone o repositório
```bash
git clone https://github.com/seu-usuario/zzysy.git
cd zzosy
```

2. Instale as dependências
```bash
npm install
```

3. Configure as variáveis de ambiente
```bash
cp apps/web/.env.example apps/web/.env.local
# Edite o arquivo com suas credenciais
```

4. Configure o banco de dados
```bash
cd apps/web
npx prisma db push
```

5. Rode o projeto
```bash
cd ../..
npm run dev
```

## Deploy

- **Frontend**: Push no GitHub → Vercel faz deploy automático
- **Banco**: Railway (PostgreSQL)
- Configure as env vars na Vercel e Railway

## Telas
| Rota | Descrição |
|------|-----------|
| `/` | Landing page |
| `/login` | Login |
| `/register` | Cadastro |
| `/dashboard` | Dashboard do usuário |
| `/editor` | Editor (Matriz) |
| `/pieces` | Peças/desdobramentos |
| `/plans` | Planos e assinatura |
| `/admin` | Painel interno (SUPER_ADMIN) |

<!-- deploy trigger -->
<!-- deploy -->
<!-- fix enum -->
