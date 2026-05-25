/**
 * Smoke tests — sanidade basica que NAO precisa de DB/auth.
 *
 * Pra rodar: precisa do dev server up. Roda:
 *   npm run test:e2e
 *
 * Expansao futura: testes com auth (signup -> login -> dashboard) precisam
 * de DB seeded + cleanup. Setup proximo passo PROD-21 full.
 */
import { test, expect } from "@playwright/test"

test("api/health responde 200 + status healthy", async ({ request }) => {
  const res = await request.get("/api/health")
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe("healthy")
  expect(body.checks?.db?.ok).toBe(true)
  expect(body.checks?.storage?.ok).toBe(true)
})

test("/login renderiza form de credenciais", async ({ page }) => {
  await page.goto("/login")
  await expect(page.locator("input[type='email']")).toBeVisible()
  await expect(page.locator("input[type='password']")).toBeVisible()
  await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible()
})

test("/legal/terms renderiza Termos de Uso", async ({ page }) => {
  await page.goto("/legal/terms")
  await expect(page.getByRole("heading", { name: /Termos de Uso/i })).toBeVisible()
})

test("/legal/privacy renderiza Politica de Privacidade", async ({ page }) => {
  await page.goto("/legal/privacy")
  await expect(page.getByRole("heading", { name: /Pol[íi]tica de Privacidade/i })).toBeVisible()
})

test("/forgot-password renderiza form de email", async ({ page }) => {
  await page.goto("/forgot-password")
  await expect(page.locator("input[type='email']")).toBeVisible()
})
