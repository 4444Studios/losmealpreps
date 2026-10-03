import { formatPrice } from './pricing';
import type { CartItem, CustomBuildSummary } from '@/stores/cartStore';

/** Official Instagram DM per-message ceiling. */
export const INSTAGRAM_DM_CHAR_LIMIT = 1000;

/** Soft budget used when building/splitting paste parts (buffer for paste quirks). */
export const INSTAGRAM_DM_SOFT_LIMIT = 980;

export function formatBundleOrder(
  bundleName: string,
  slotCount: number,
  proteinSizeLabel: string,
  priceCents: number,
  selections: { name: string }[],
): string {
  const mealCounts = selections.reduce((acc, meal) => {
    acc[meal.name] = (acc[meal.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  let message = `Hey Los Meal Preps! Order: ${bundleName} (${slotCount} meals, ${proteinSizeLabel}).\n\n`;
  Object.entries(mealCounts).forEach(([name, count]) => {
    message += `- ${count}x ${name}\n`;
  });
  message += `\nTotal: ${formatPrice(priceCents)}\nThanks!`;

  return message;
}

export interface CustomOrderDetails {
  proteinName: string;
  proteinSize: string;
  proteinPriceCents: number;
  carbName: string | null;
  carbUpchargeCents: number;
  veggieNames: string[];
  sauceNames: string[];
  flavorName: string | null;
  sideSauceName: string | null;
  sideSauceSize: string | null;
  sideSaucePriceCents: number;
  totalCents: number;
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
}

function formatCompactMacros(macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }): string {
  return `${macros.calories}cal ${macros.protein_g}P/${macros.carbs_g}C/${macros.fat_g}F`;
}

function customBuildFingerprint(build: CustomBuildSummary): string {
  return [
    build.proteinName,
    build.proteinSize,
    build.carbName ?? '',
    build.veggieNames.slice().sort().join(','),
    build.flavorName ?? '',
    build.sideSauceName ?? '',
    build.sideSauceSize ?? '',
    String(build.totalCents),
    formatCompactMacros(build.macros),
  ].join('|');
}

function formatCustomBuildLine(build: CustomBuildSummary, count: number): string {
  const qty = count > 1 ? `${count}x ` : '';
  let line = `${qty}${build.proteinName}${build.proteinSize ? ` (${build.proteinSize})` : ''} ${formatPrice(build.totalCents)}`;
  const bits: string[] = [];
  if (build.carbName) bits.push(build.carbName);
  if (build.veggieNames.length) bits.push(build.veggieNames.join(', '));
  if (build.flavorName) bits.push(build.flavorName);
  if (build.sideSauceName && build.sideSauceSize) {
    bits.push(`sauce ${build.sideSauceName} ${build.sideSauceSize}`);
  }
  if (bits.length) line += `\n  ${bits.join(' · ')}`;
  line += `\n  ${formatCompactMacros(build.macros)}`;
  return line;
}

export function formatCustomOrder(d: CustomOrderDetails): string {
  let msg = `Hey Los Meal Preps! Custom meal order:\n\n`;
  msg += `${d.proteinName}${d.proteinSize ? ` (${d.proteinSize})` : ''} ${formatPrice(d.totalCents)}\n`;
  const bits: string[] = [];
  if (d.carbName) bits.push(d.carbName);
  if (d.veggieNames.length) bits.push(d.veggieNames.join(', '));
  if (d.flavorName) bits.push(d.flavorName);
  if (d.sideSauceName && d.sideSauceSize) bits.push(`sauce ${d.sideSauceName} ${d.sideSauceSize}`);
  if (bits.length) msg += `${bits.join(' · ')}\n`;
  if (d.macros) msg += `${formatCompactMacros(d.macros)}\n`;
  msg += `\nThanks!`;
  return msg;
}

/**
 * Compact kitchen-readable cart message for Instagram DMs.
 */
export function formatFullOrder(items: CartItem[], discountCents: number = 0, finalTotalCents: number = 0): string {
  const mealSummary = new Map<string, { count: number; unitPriceCents: number }>();
  let msg = `Hey Los Meal Preps! Order:\n\n`;
  let subtotalCents = 0;

  const customItems = items.filter((item) => item.kind === 'custom');
  const bundleItems = items.filter((item) => item.kind === 'bundle');
  const addonItems = items.filter((item) => item.kind === 'addon');

  items.forEach((item) => {
    if (item.kind === 'meal') {
      const current = mealSummary.get(item.meal.name);
      mealSummary.set(item.meal.name, {
        count: (current?.count ?? 0) + 1,
        unitPriceCents: item.meal.base_price_cents,
      });
      subtotalCents += item.meal.base_price_cents;
      return;
    }
    if (item.kind === 'bundle') {
      subtotalCents += item.bundle.totalCents;
      return;
    }
    if (item.kind === 'addon') {
      subtotalCents += item.addon.priceCents;
      return;
    }
    subtotalCents += item.build.totalCents;
  });

  if (mealSummary.size > 0) {
    msg += `Signature:\n`;
    for (const [name, details] of mealSummary.entries()) {
      const lineTotal = details.count * details.unitPriceCents;
      msg += `- ${details.count}x ${name} ${formatPrice(lineTotal)}\n`;
    }
    msg += '\n';
  }

  if (customItems.length > 0) {
    msg += `Custom:\n`;
    const grouped = new Map<string, { build: CustomBuildSummary; count: number }>();
    customItems.forEach((item) => {
      const key = customBuildFingerprint(item.build);
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { build: item.build, count: 1 });
      }
    });
    let index = 1;
    for (const { build, count } of grouped.values()) {
      msg += `${index}) ${formatCustomBuildLine(build, count)}\n`;
      index += 1;
    }
    msg += '\n';
  }

  if (bundleItems.length > 0) {
    msg += `Bundles:\n`;
    bundleItems.forEach((item, index) => {
      const bundle = item.bundle;
      msg += `${index + 1}) ${bundle.bundleName} · ${bundle.slotCount} meals · ${bundle.proteinSizeLabel} ${formatPrice(bundle.totalCents)}\n`;
      const bundleMealCounts = bundle.mealNames.reduce((acc, name) => {
        acc[name] = (acc[name] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      Object.entries(bundleMealCounts).forEach(([name, count]) => {
        msg += `  - ${count}x ${name}\n`;
      });
    });
    msg += '\n';
  }

  if (addonItems.length > 0) {
    msg += `Add-ons:\n`;
    addonItems.forEach((item) => {
      const size = item.addon.sizeLabel ? ` (${item.addon.sizeLabel})` : '';
      msg += `- ${item.addon.name}${size} ${formatPrice(item.addon.priceCents)}\n`;
    });
    msg += '\n';
  }

  if (discountCents > 0) {
    msg += `Subtotal: ${formatPrice(subtotalCents)}\n`;
    msg += `Sauce promo: -${formatPrice(discountCents)}\n`;
  }

  const displayTotal = finalTotalCents || subtotalCents;
  msg += `Total: ${formatPrice(displayTotal)}\nThanks!`;
  return msg;
}

function partHeader(index: number, total: number): string {
  return `Part ${index}/${total}\n`;
}

/**
 * Split a message into Instagram-safe paste parts on line boundaries.
 * Each part is at most `softLimit` characters including the Part i/n header.
 */
export function splitOrderForInstagram(
  text: string,
  softLimit: number = INSTAGRAM_DM_SOFT_LIMIT,
): string[] {
  if (text.length <= softLimit) return [text];

  // Estimate part count, then refine so headers fit.
  let partCount = Math.ceil(text.length / (softLimit - 16));
  let parts: string[] = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const maxBody = softLimit - partHeader(partCount, partCount).length;
    parts = [];
    const lines = text.split('\n');
    let current = '';

    for (const line of lines) {
      const candidate = current.length === 0 ? line : `${current}\n${line}`;
      if (candidate.length <= maxBody) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        parts.push(current);
        current = '';
      }

      if (line.length <= maxBody) {
        current = line;
        continue;
      }

      // Hard-split an oversized single line.
      let remaining = line;
      while (remaining.length > maxBody) {
        parts.push(remaining.slice(0, maxBody));
        remaining = remaining.slice(maxBody);
      }
      current = remaining;
    }

    if (current.length > 0) parts.push(current);

    if (parts.length === partCount) break;
    partCount = Math.max(parts.length, partCount + 1);
  }

  if (parts.length === 1) return parts;

  return parts.map((body, i) => `${partHeader(i + 1, parts.length)}${body}`);
}

export function buildInstagramOrderParts(
  items: CartItem[],
  discountCents: number = 0,
  finalTotalCents: number = 0,
  softLimit: number = INSTAGRAM_DM_SOFT_LIMIT,
): string[] {
  return splitOrderForInstagram(formatFullOrder(items, discountCents, finalTotalCents), softLimit);
}

export function getOrderCharCount(
  items: CartItem[],
  discountCents: number = 0,
  finalTotalCents: number = 0,
): number {
  return formatFullOrder(items, discountCents, finalTotalCents).length;
}
