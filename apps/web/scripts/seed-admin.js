/* eslint-disable */
/**
 * Cria Tenant 'Default' + User SUPER_ADMIN apos migrate reset.
 *
 * Uso:
 *   cd ~/Desktop/BACKEND/zzosy/apps/web
 *   node scripts/seed-admin.js EMAIL SENHA "NOME"
 *
 * Exemplo:
 *   node scripts/seed-admin.js giovanni@suno.com.br SenhaForte123 "Giovanni"
 */
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

async function main() {
  const [email, password, name] = process.argv.slice(2)
  if (!email || !password) {
    console.error('Uso: node scripts/seed-admin.js EMAIL SENHA "NOME"')
    process.exit(1)
  }

  let tenant = await prisma.tenant.findUnique({ where: { slug: "default" } })
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: "Default", slug: "default" } })
    console.log("[seed] tenant criado:", tenant.id)
  } else {
    console.log("[seed] tenant ja existe:", tenant.id)
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { password: passwordHash, role: "SUPER_ADMIN", blocked: false, tenantId: tenant.id, name: name ?? existing.name },
    })
    console.log("[seed] usuario atualizado:", email)
  } else {
    await prisma.user.create({
      data: { email, password: passwordHash, name: name ?? "Admin", role: "SUPER_ADMIN", tenantId: tenant.id },
    })
    console.log("[seed] usuario criado:", email)
  }
  console.log("[seed] pronto. Faça login em http://localhost:3000")
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
