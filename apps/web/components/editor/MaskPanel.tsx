"use client"

// Painel "Máscara" do painel direito do editor. Replica os controles do
// Photoshop pra mascaras de layer: criar (raster nao implementado aqui ainda),
// vetor retangular/elipse (Reveal All / Hide All), clipping mask.
// Mostra controles secundarios quando ja existe mascara: Toggle Enabled,
// Invert, Delete.

import React from "react"

type Props = {
  selected: any
  onAddClipping: () => void
  onAddRectVector: (revealAll: boolean) => void
  onAddEllipseVector: (revealAll: boolean) => void
  onToggleEnabled: () => void
  onToggleInverted: () => void
  onRemove: () => void
  secS: React.CSSProperties
}

const btnS: React.CSSProperties = {
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  color: "#bbb",
  textAlign: "left",
  display: "flex",
  alignItems: "center",
  gap: 8,
}

const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = "#222"
  e.currentTarget.style.color = "#fff"
  e.currentTarget.style.borderColor = "#333"
}
const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = "#1a1a1a"
  e.currentTarget.style.color = "#bbb"
  e.currentTarget.style.borderColor = "#2a2a2a"
}

export function MaskPanel({
  selected,
  onAddClipping,
  onAddRectVector,
  onAddEllipseVector,
  onToggleEnabled,
  onToggleInverted,
  onRemove,
  secS,
}: Props) {
  const mask = (selected as any)?.__maskData ?? null

  return (
    <div style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid #2a2a2a" }}>
      <div style={secS}>Mask</div>

      {!mask && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            type="button"
            onClick={() => onAddRectVector(true)}
            onMouseEnter={btnHover}
            onMouseLeave={btnLeave}
            style={btnS}
            title="Creates a rectangular vector mask covering the entire layer"
          >
            <span style={{ width: 16, fontWeight: 700 }}>▭</span>
            Vector Mask – Reveal All
          </button>
          <button
            type="button"
            onClick={() => onAddRectVector(false)}
            onMouseEnter={btnHover}
            onMouseLeave={btnLeave}
            style={btnS}
            title="Creates an inverted vector mask (hides everything)"
          >
            <span style={{ width: 16, fontWeight: 700 }}>▮</span>
            Vector Mask – Hide All
          </button>
          <button
            type="button"
            onClick={() => onAddEllipseVector(true)}
            onMouseEnter={btnHover}
            onMouseLeave={btnLeave}
            style={btnS}
            title="Creates an elliptical vector mask"
          >
            <span style={{ width: 16, fontWeight: 700 }}>○</span>
            Ellipse Vector Mask
          </button>
          <button
            type="button"
            onClick={onAddClipping}
            onMouseEnter={btnHover}
            onMouseLeave={btnLeave}
            style={btnS}
            title="Clips this layer to the outline of the layer below (Cmd+Opt+G)"
          >
            <span style={{ width: 16, fontWeight: 700 }}>⌐</span>
            Clip to Layer Below
            <span style={{ marginLeft: "auto", color: "#555", fontSize: 10 }}>⌘⌥G</span>
          </button>
        </div>
      )}

      {mask && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              padding: "8px 10px",
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              fontSize: 11,
              color: "#888",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 3,
                background: mask.enabled ? "#222" : "#1a1a1a",
                border: mask.enabled ? "1px solid #F5C400" : "1px solid #444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                color: mask.enabled ? "#F5C400" : "#444",
              }}
              title={`${mask.type} mask`}
            >
              {mask.type === "raster" ? "▦" : mask.type === "vector" ? "▭" : "⌐"}
            </div>
            <div style={{ flex: 1, lineHeight: 1.3 }}>
              <div style={{ color: "#ccc", fontWeight: 600, textTransform: "capitalize" }}>
                {mask.type === "clipping" ? "Clipping" : mask.type} Mask
              </div>
              <div style={{ fontSize: 10, color: "#555" }}>
                {!mask.enabled && "Disabled · "}
                {mask.inverted && "Inverted"}
                {!mask.inverted && mask.enabled && "Active"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              type="button"
              onClick={onToggleEnabled}
              onMouseEnter={btnHover}
              onMouseLeave={btnLeave}
              style={btnS}
              title="Enable or disable the mask (Shift+click on thumb)"
            >
              <span style={{ width: 16 }}>{mask.enabled ? "✓" : "○"}</span>
              {mask.enabled ? "Disable Mask" : "Enable Mask"}
            </button>
            {mask.type !== "clipping" && (
              <button
                type="button"
                onClick={onToggleInverted}
                onMouseEnter={btnHover}
                onMouseLeave={btnLeave}
                style={btnS}
                title="Inverts black/white of the mask"
              >
                <span style={{ width: 16 }}>↔</span>
                Invert Mask
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              onMouseEnter={btnHover}
              onMouseLeave={btnLeave}
              style={{ ...btnS, color: "#d33" }}
              title="Removes the mask"
            >
              <span style={{ width: 16 }}>×</span>
              Delete Mask
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
