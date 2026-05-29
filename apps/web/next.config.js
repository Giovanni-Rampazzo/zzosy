/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  // @napi-rs/canvas tem native binding (.node) que Turbopack nao consegue
  // empacotar — marcar como external faz Node usar require() padrao.
  serverExternalPackages: ["@napi-rs/canvas", "ag-psd", "pdfjs-dist"],
  // Sem header X-Powered-By: Next.js (info-leak desnecessario + 1 header a menos).
  poweredByHeader: false,
  // Remove console.* (exceto error/warn) em production builds — reduz bundle
  // e silencia logs ruidosos do editor. Dev mantem tudo.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // Tree-shake per-named-import dessas libs grandes — sem isso, importar
    // 1 export de uma lib mega traz a lib inteira no client bundle.
    optimizePackageImports: [
      "@sentry/nextjs",
      "@upstash/redis",
      "@upstash/ratelimit",
      "zod",
    ],
  },
  // NOTE: Next 16 usa Turbopack por default e nao aceita webpack config.
  // O loop infinito de watcher (public/uploads → Fast Refresh → regen) ja
  // foi mitigado pelo rollback do regen agressivo (apenas regen pieces sem
  // imageUrl). Se voltar a aparecer, evoluir pra mover thumbs pra fora de
  // public/ (storage externo ou serve via API route).
  // Cache: thumbs em /uploads/ podem mudar a qualquer momento (re-upload).
  // Headers no-cache forcam o navegador a sempre revalidar com o servidor.
  // Sem isso, mesmo com ?v=updatedAt as imagens podiam vir do cache local.
  async headers() {
    return [
      {
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ]
  },
  // beforeFiles: roda ANTES do matcher de static /public files. Sem isso,
  // Next.js prod cacheia 404 da primeira tentativa pra qualquer /uploads/X
  // que nao existia no boot — e mesmo apos escrever o arquivo via storage.put
  // em runtime, o 404 cacheado persiste pra sempre (x-nextjs-prerender:1).
  // Forcando /uploads/* a passar por route handler dinamico (force-dynamic),
  // file system eh consultado a cada request.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/uploads/:path*", destination: "/api/uploads/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

// Bundle analyzer opt-in: `npm run build:analyze` abre relatorio HTML
// com tree-map dos chunks. Sem ANALYZE=true, no-op (cfg passa direto).
const withBundleAnalyzer = process.env.ANALYZE === "true"
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (cfg) => cfg

module.exports = withBundleAnalyzer(nextConfig)
