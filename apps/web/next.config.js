/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // CRITICO 2026-05-23: dev watcher detectava thumbnails escritas em
  // public/uploads/ → Fast Refresh rebuild → componente remount → useEffect
  // de regen dispara DE NOVO → LOOP INFINITO. Pagina ficava em
  // "Carregando..." eterno. Excluir uploads do watcher quebra o loop.
  // Producao nao afetada (static serving normal sem dev watch).
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
          "**/public/uploads/**",
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
        ],
      }
    }
    return config
  },
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
