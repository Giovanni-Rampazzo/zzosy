import type { Metadata, Viewport } from "next"
import { DM_Sans } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/shared/providers"

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "ZZOSY System",
  description: "Automação de layouts e campanhas",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Editor desktop-only; outras pags responsivas. Sem maximumScale=1 pra
  // nao bloquear pinch-zoom (a11y).
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={dmSans.variable}>
      <body className={dmSans.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
