/* eslint-disable no-console */
// Sync local -> prod (Railway).
// Uso: npm run sync:prod  [-- --db-only | --uploads-only]
//
// Reads ADMIN_SYNC_TOKEN + PROD_URL from .env. Dumps local MySQL, tars
// /uploads (excluindo /uploads-orphans), faz POST multipart pra
// /api/admin/sync em prod. Idempotente (DROP TABLE no dump).
import { spawnSync, spawn } from "child_process"
import { statSync, createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const args = process.argv.slice(2)
const dbOnly = args.includes("--db-only")
const uploadsOnly = args.includes("--uploads-only")

const envPath = path.resolve(__dirname, "../.env")
if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8")
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const PROD_URL = process.env.PROD_URL ?? "https://web-production-c159d.up.railway.app"
const TOKEN = process.env.ADMIN_SYNC_TOKEN
if (!TOKEN) {
  console.error("ADMIN_SYNC_TOKEN nao setado no .env local")
  process.exit(1)
}

const LOCAL_DB_URL = process.env.DATABASE_URL
if (!LOCAL_DB_URL) {
  console.error("DATABASE_URL nao setado no .env local")
  process.exit(1)
}

const url = new URL(LOCAL_DB_URL)
const dbHost = url.hostname
const dbPort = url.port || "3306"
const dbUser = url.username
const dbPass = decodeURIComponent(url.password)
const dbName = url.pathname.slice(1)

const tmp = tmpdir()
const sqlPath = path.join(tmp, "sync-db.sql")
const tarPath = path.join(tmp, "sync-uploads.tar.gz")
const uploadsDir = path.resolve(__dirname, "../public/uploads")

async function main() {
  const form = new FormData()

  if (!uploadsOnly) {
    console.log("[1/3] Dump DB local...")
    const dump = spawnSync(
      "/usr/local/mysql/bin/mysqldump",
      [
        `-h${dbHost}`, `-P${dbPort}`, `-u${dbUser}`, `-p${dbPass}`,
        "--single-transaction", "--no-tablespaces", "--routines", "--triggers",
        "--set-gtid-purged=OFF", "--add-drop-table", dbName,
      ],
      { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 },
    )
    if (dump.status !== 0) {
      console.error("mysqldump falhou:", dump.stderr.toString())
      process.exit(1)
    }
    writeFileSync(sqlPath, dump.stdout)
    console.log(`  ${(statSync(sqlPath).size / 1024).toFixed(1)} KB`)
    form.append("db", new Blob([dump.stdout], { type: "application/sql" }), "db.sql")
  }

  if (!dbOnly) {
    console.log("[2/3] Tar /uploads (sem orphans)...")
    const tarT0 = Date.now()
    const tarTick = setInterval(() => {
      const elapsed = ((Date.now() - tarT0) / 1000).toFixed(0)
      const sz = existsSync(tarPath) ? (statSync(tarPath).size / 1024 / 1024).toFixed(1) : "0.0"
      process.stdout.write(`\r  tar... ${elapsed}s  (${sz} MB)`)
    }, 500)
    const tarExitCode: number = await new Promise((resolve) => {
      const proc = spawn(
        "tar",
        ["czf", tarPath, "-C", uploadsDir, "campaigns", "clients", "deliveries", "step-thumbs"],
        { stdio: ["ignore", "ignore", "inherit"] },
      )
      proc.on("close", (code) => resolve(code ?? -1))
    })
    clearInterval(tarTick)
    process.stdout.write("\r")
    if (tarExitCode !== 0) {
      console.error(`\ntar falhou (exit ${tarExitCode})`)
      process.exit(1)
    }
    const sz = statSync(tarPath).size
    console.log(`  ${(sz / 1024 / 1024).toFixed(1)} MB em ${((Date.now() - tarT0) / 1000).toFixed(1)}s`)
    const tarBuf = readFileSync(tarPath)
    form.append("uploads", new Blob([tarBuf], { type: "application/gzip" }), "uploads.tar.gz")
  }

  const totalSizeMB = (
    (uploadsOnly ? 0 : statSync(sqlPath).size) +
    (dbOnly ? 0 : statSync(tarPath).size)
  ) / 1024 / 1024
  console.log(`[3/3] POST /api/admin/sync (${totalSizeMB.toFixed(1)} MB upload + processamento server)...`)
  const t0 = Date.now()
  const tick = setInterval(() => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    process.stdout.write(`\r  esperando resposta... ${elapsed}s`)
  }, 1000)
  let res: Response
  try {
    res = await fetch(`${PROD_URL}/api/admin/sync`, {
      method: "POST",
      headers: { "x-sync-token": TOKEN! },
      body: form,
    })
  } finally {
    clearInterval(tick)
    process.stdout.write("\r")
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const body = await res.text()
  console.log(`  HTTP ${res.status}  ${elapsed}s total`)
  console.log(body)

  if (!uploadsOnly && existsSync(sqlPath)) unlinkSync(sqlPath)
  if (!dbOnly && existsSync(tarPath)) unlinkSync(tarPath)

  return res.ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(e); process.exit(1) })
