// Cria SUPER_ADMIN inicial. Uso: `node scripts/create-super-admin.mjs <email> <senha> <nome>`
// Ex: node scripts/create-super-admin.mjs giovanni.rampazzo@gmail.com minhasenha123 "Giovanni Rampazzo"
//
// Cria um Tenant "Anthropic ZZOSY" se nao existir, e o user com role SUPER_ADMIN.
// Idempotente: se o email ja existe, atualiza role pra SUPER_ADMIN sem mexer na senha.

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const [, , email, password, name = "Admin"] = process.argv
  if (!email || !password) {
    console.error("Uso: node scripts/create-super-admin.mjs <email> <senha> [nome]")
    process.exit(1)
  }

  // Garante um tenant "system" pra o super admin pertencer
  let tenant = await prisma.tenant.findFirst({ where: { slug: "zzosy-system" } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: "ZZOSY System", slug: "zzosy-system" }
    })
    console.log(`✓ Tenant criado: ${tenant.id}`)
  } else {
    console.log(`✓ Tenant existente: ${tenant.id}`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    const updated = await prisma.user.update({
      where: { email },
      data: { role: "SUPER_ADMIN" }
    })
    console.log(`✓ User existente promovido a SUPER_ADMIN: ${updated.id}`)
    console.log(`  (senha NAO foi alterada)`)
  } else {
    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: "SUPER_ADMIN",
        tenantId: tenant.id,
      }
    })
    console.log(`✓ SUPER_ADMIN criado: ${user.id}`)
    console.log(`  email: ${email}`)
    console.log(`  senha: ${password}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
