// Reference categorical palette from the dataviz skill (references/palette.md).
// Fixed slot order is the CVD-safety mechanism — never reorder or cycle it.
// Slots 1-4 are the only ones validated for all-pairs comparison (scatter/
// bubble contexts), which is what the competitive-landscape chart uses.
export const CATEGORICAL = {
  light: ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#008300", "#d55181", "#c98500", "#199e70", "#d95926", "#9085e9", "#e66767"],
} as const;

export const CHROME = {
  light: {
    surface: "#fcfcfb",
    textPrimary: "#0b0b0b",
    textSecondary: "#52514e",
    muted: "#898781",
    gridline: "#e1e0d9",
    baseline: "#c3c2b7",
  },
  dark: {
    surface: "#1a1a19",
    textPrimary: "#ffffff",
    textSecondary: "#c3c2b7",
    muted: "#898781",
    gridline: "#2c2c2a",
    baseline: "#383835",
  },
} as const;

// Content category -> categorical slot index, matching the Python
// prototype's CATEGORY_COLORS assignment exactly (same hexes, same order).
// "other" deliberately has no slot — it renders in the muted chrome gray,
// same as the prototype, rather than consuming a categorical hue.
export const CATEGORY_SLOT: Record<string, number> = {
  collaboration: 0, // blue
  educational: 2, // magenta
  paid_promotion: 3, // yellow
  campaign: 4, // aqua
  product: 6, // violet
  testimonial: 7, // red
};

export function categoricalColor(index: number, scheme: "light" | "dark"): string {
  return CATEGORICAL[scheme][index % CATEGORICAL[scheme].length];
}

export function categoryColor(category: string, scheme: "light" | "dark"): string {
  const slot = CATEGORY_SLOT[category];
  return slot != null ? CATEGORICAL[scheme][slot] : CHROME[scheme].muted;
}
