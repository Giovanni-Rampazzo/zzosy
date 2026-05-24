/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
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
}

module.exports = nextConfig
