const theme = {
  colors: {
    background:  "#FFFFFF",
    surface:     "#F7F7F7",
    border:      "#E5E5E5",
    text:        "#111111",
    textMuted:   "#888888",
    yellow:      "#F5C400",
    green:       "#34A853",
    blue:        "#4285F4",
    primary:     "#111111",
    primaryText: "#FFFFFF",
    error:       "#E53935",
    success:     "#34A853",
    warning:     "#F5C400",
  },
  typography: {
    fontDisplay: "\'DM Sans\', sans-serif",
    fontBody:    "\'DM Sans\', sans-serif",
    size: {
      xs:   "0.75rem",
      sm:   "0.875rem",
      base: "1rem",
      lg:   "1.125rem",
      xl:   "1.25rem",
      xl2:  "1.5rem",
      xl3:  "1.875rem",
      xl4:  "2.25rem",
    },
    weight: { normal:400, medium:500, bold:700, black:900 },
  },
  spacing: {
    xs:"4px", sm:"8px", md:"16px", lg:"24px",
    xl:"32px", xl2:"48px", xl3:"64px",
  },
  borderRadius: {
    sm:"4px", md:"8px", lg:"12px", xl:"16px", full:"9999px",
  },
  shadows: {
    sm:"0 1px 3px rgba(0,0,0,0.08)",
    md:"0 4px 12px rgba(0,0,0,0.08)",
    lg:"0 8px 24px rgba(0,0,0,0.10)",
  },
  logo: {
    text: "ZZOSY",
    dots: ["#F5C400","#34A853","#4285F4"],
  },
} as const;

export default theme;
export const { colors, typography, spacing, borderRadius, shadows } = theme;
