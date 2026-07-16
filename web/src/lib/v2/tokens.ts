/**
 * v2 palette. Deliberately small: ink + a neutral ramp carry the UI, the two
 * team colours are reserved for lane data, and one signal red is spent only on
 * the LIVE indicator.
 *
 * Note the deviation from the design file: it shipped SUI red (#cf2e3a) and a
 * live red (#d0342c) one percent apart, so the sweeping match clock read as a
 * Switzerland element. Here the clock is ink and red stays a team colour plus
 * the LIVE dot.
 */
export const C = {
  ink: "#16181d",
  ink2: "#3f4650",
  muted: "#8a919c",
  faint: "#b6bcc6",
  hair: "#d9dde3",
  line: "#e8eaee",
  line2: "#f1f2f5",
  surface: "#f6f7f9",
  white: "#ffffff",

  /** Lane data colours — never used for chrome, buttons, or borders. */
  home: "#2458c5",
  away: "#cf2e3a",

  /** The only signal colour. LIVE dot only. */
  live: "#d0342c",

  /** Backdrop. */
  night: "#0a0e2c",
} as const;

export const MONO = "var(--v2-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/** Every numeric readout in the app gets these. */
export const num = {
  fontFamily: MONO,
  fontVariantNumeric: "tabular-nums",
} as const;
