/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
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
