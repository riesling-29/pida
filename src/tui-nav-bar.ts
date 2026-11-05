import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type NavBarStage = 1 | 2 | 3;

export type NavBarItem = { label: string; action: () => void; selected?: boolean };

function segment(label: string, stage: NavBarStage): string {
  if (stage === 3) {
    const match = /^F(\d+)/.exec(label);
    return match ? `F${match[1]}` : label;
  }
  if (stage === 2) return `${label}│`;
  return ` ${label} │`;
}

function barWidth(items: { label: string }[], stage: NavBarStage): number {
  if (stage === 3) {
    let used = 0;
    for (let i = 0; i < items.length; i++) {
      if (i > 0) used += 1;
      used += visibleWidth(segment(items[i]!.label, stage));
    }
    return used;
  }
  let used = stage === 1 ? 1 : 0;
  for (const item of items) used += visibleWidth(segment(item.label, stage));
  return used;
}

export function chooseNavBarStage(items: { label: string }[], width: number): NavBarStage {
  if (barWidth(items, 1) <= width) return 1;
  if (barWidth(items, 2) <= width) return 2;
  return 3;
}

export function renderNavBar(
  items: NavBarItem[],
  width: number,
  stage: NavBarStage,
  paint: (text: string, selected?: boolean) => string,
): { line: string; regions: { from: number; to: number; action: () => void }[] } {
  let text = stage === 2 ? "" : stage === 1 ? " " : "";
  const regions: { from: number; to: number; action: () => void }[] = [];
  if (stage === 3) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const key = segment(item.label, stage);
      const prefix = i === 0 ? "" : " ";
      const start = visibleWidth(text);
      const painted = paint(prefix + key, item.selected);
      text += painted;
      regions.push({ from: start, to: visibleWidth(text), action: item.action });
    }
    if (visibleWidth(text) > width) {
      const suffix = " …F1";
      text = truncateToWidth(text, Math.max(0, width - visibleWidth(suffix)), "", true) + suffix;
    }
  } else {
    for (const item of items) {
      const start = visibleWidth(text);
      const piece = segment(item.label, stage);
      if (start + visibleWidth(piece) > width) break;
      text += paint(piece, item.selected);
      regions.push({ from: start, to: visibleWidth(text), action: item.action });
    }
  }
  return { line: truncateToWidth(text, width, "", true), regions };
}
