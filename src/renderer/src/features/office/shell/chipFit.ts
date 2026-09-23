/**
 * How many chips fit on one line of `available` pixels. When they don't all fit, room is kept for
 * a "More" button of `moreWidth`, and the chips after the ones that fit go into its menu.
 */
export function fitChips(
  widths: readonly number[],
  available: number,
  moreWidth: number,
  gap: number
): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > available) break;
    used += gap + width;
    count++;
  }
  return count;
}
