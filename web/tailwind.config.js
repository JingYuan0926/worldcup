/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // White stadium-paper theme. Semantic names keep every screen aligned.
        bg: "#F7F9F7",
        panel: "#FFFFFF",
        "panel-2": "#F0F4F1",
        ink: "#17211B",
        muted: "#66736B",
        pitch: "#147A46",
        money: "#9A5B00",
        home: "#1D5FBF",
        away: "#AD2448",
        line: "#D9E1DC",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontVariantNumeric: ["tabular-nums"],
      boxShadow: {
        glow: "0 10px 28px -14px rgba(20,122,70,0.45)",
        card: "0 1px 2px rgba(23,33,27,0.04), 0 12px 32px -22px rgba(23,33,27,0.28)",
      },
      keyframes: {
        sweep: { "0%": { left: "0%" }, "100%": { left: "100%" } },
        pulseglow: {
          "0%,100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        sweep: "sweep 90s linear",
        pulseglow: "pulseglow 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
