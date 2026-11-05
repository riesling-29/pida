import {
  backgroundAnsi, foregroundAnsi, getTerminalColorMode, parseColor, styleTextWithAnsi,
  truncateToWidth, type TerminalColorMode,
} from "@earendil-works/pi-tui";

// The approved black-green / cool-type workbench prototype, now used by the real TUI.
// Keep secondary text legible; ANSI "dim" would darken it again on many terminals.
const ink = {
  background: "#010201", panel: "#020503", selected: "#051009",
  text: "#bbc6c3", secondary: "#92a29a", strong: "#c6d1cc",
  accent: "#a4b99f", border: "#36523c", error: "#d59b91",
};

export function terminalPalette(color: boolean, mode: TerminalColorMode = getTerminalColorMode()) {
  const fg = (value: string) => foregroundAnsi(parseColor(value), mode);
  const bg = (value: string) => backgroundAnsi(parseColor(value), mode);
  const textColor = fg(ink.text), background = bg(ink.background);
  const text = (value: string, bold = false) => (s: string) => color ? styleTextWithAnsi(s, fg(value), undefined, { bold }) : s;
  const surface = (backgroundColor: string) => (s: string) => {
    if (!color) return s;
    const prefix = textColor + backgroundColor;
    // Pi closes composed spans with SGR 0/39/49. Restore application defaults
    // inside the line without changing explicit colors, cursor or mouse markers.
    const content = s.replace(/\x1b\[(0|39|49)?m/g, (_, code: string | undefined) =>
      code === "39" ? textColor : code === "49" ? backgroundColor : "\x1b[0m" + prefix);
    return prefix + content + "\x1b[0m";
  };
  const base = surface(background), panel = surface(bg(ink.panel)), selected = surface(bg(ink.selected));
  return {
    strong: text(ink.strong, true), dim: text(ink.secondary), accent: text(ink.accent),
    border: text(ink.border), bad: text(ink.error), good: text(ink.accent), panel,
    selected: (s: string) => selected(text(ink.strong, true)(s)),
    band: (s: string, width: number) => panel(truncateToWidth(s, width, "", true)),
    // Paint empty cells too. No OSC palette/font changes, so shell settings survive exit.
    frameLine: (s: string, width: number) => color ? base(truncateToWidth(s, width, "", true)) : s,
  };
}
