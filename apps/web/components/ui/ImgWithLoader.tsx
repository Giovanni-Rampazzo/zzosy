"use client"
import { useState, useEffect } from "react"

interface Props {
  src: string
  alt?: string
  style?: React.CSSProperties
  /** Mostrado se 404/erro. Default: "—" cinza claro */
  errorFallback?: React.ReactNode
  className?: string
}

/**
 * <img> com skeleton pulse enquanto carrega + fallback em erro.
 * Drop-in replacement pra qualquer <img> que carrega asset/upload.
 * Pulse cinza claro, transição opacity 0.2s pra revelar a imagem suavemente.
 */
export function ImgWithLoader({ src, alt, style, errorFallback, className }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => { setLoaded(false); setErrored(false) }, [src])

  if (errored) {
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 11 }}>
        {errorFallback ?? "—"}
      </div>
    )
  }

  return (
    <div style={{ position: "relative", display: "inline-block", ...style }} aria-busy={!loaded}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          animation: "img-loader-pulse 1.2s ease-in-out infinite",
          background: "linear-gradient(90deg, #EDEDED 0%, #F5F5F5 50%, #EDEDED 100%)",
          backgroundSize: "200% 100%",
        }} />
      )}
      <img
        src={src}
        alt={alt ?? ""}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={className}
        style={{ width: "100%", height: "100%", objectFit: "contain", opacity: loaded ? 1 : 0, transition: "opacity 0.2s", display: "block" }}
      />
      <style>{`@keyframes img-loader-pulse { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  )
}
