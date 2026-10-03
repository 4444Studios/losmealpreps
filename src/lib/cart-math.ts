import type { CartItem } from '@/stores/cartStore';

/**
 * - 'promo': every sauce is charged the promo prices below (single / pair), whatever its own price.
 * - 'individual': every sauce is charged its own size price; no pair deal.
 */
export type SaucePricingMode = 'promo' | 'individual';

/** Which sauce the free-sauce reward applies to (only matters in 'individual' mode). */
export type FreeSaucePick = 'cheapest' | 'most_expensive';

export interface SaucePricingConfig {
  pricing_mode: SaucePricingMode;
  free_sauce_pick: FreeSaucePick;
  single_price_cents: number;
  pair_price_cents: number;
  free_threshold_cents: number;
}

export const DEFAULT_SAUCE_CONFIG: SaucePricingConfig = {
  pricing_mode: 'promo',
  free_sauce_pick: 'cheapest',
  single_price_cents: 150,
  pair_price_cents: 250,
  free_threshold_cents: 6000,
};

export function parseSauceConfig(raw?: string | null): SaucePricingConfig {
  if (!raw) return DEFAULT_SAUCE_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    return {
      pricing_mode: parsed.pricing_mode === 'individual' ? 'individual' : 'promo',
      free_sauce_pick: parsed.free_sauce_pick === 'most_expensive' ? 'most_expensive' : 'cheapest',
      single_price_cents: typeof parsed.single_price_cents === 'number' ? parsed.single_price_cents : DEFAULT_SAUCE_CONFIG.single_price_cents,
      pair_price_cents: typeof parsed.pair_price_cents === 'number' ? parsed.pair_price_cents : DEFAULT_SAUCE_CONFIG.pair_price_cents,
      free_threshold_cents: typeof parsed.free_threshold_cents === 'number' ? parsed.free_threshold_cents : DEFAULT_SAUCE_CONFIG.free_threshold_cents,
    };
  } catch {
    return DEFAULT_SAUCE_CONFIG;
  }
}

export interface CartMathResult {
  subtotalCents: number;
  sauceCount: number;
  eligibleSpendCents: number;
  discountCents: number;
  totalCents: number;
}

export function calculateCartTotals(items: CartItem[], config: SaucePricingConfig): CartMathResult {
  let subtotalCents = 0;
  let eligibleSpendCents = 0;
  // What each sauce in the cart was charged at its own price (side sauces + add-ons).
  const saucePrices: number[] = [];

  // 1. Raw subtotal; sauces are excluded from the spend that unlocks the free sauce
  for (const item of items) {
    if (item.kind === 'meal') {
      subtotalCents += item.meal.base_price_cents;
      eligibleSpendCents += item.meal.base_price_cents;
    } else if (item.kind === 'bundle') {
      subtotalCents += item.bundle.totalCents;
      eligibleSpendCents += item.bundle.totalCents;
    } else if (item.kind === 'custom') {
      subtotalCents += item.build.totalCents;
      const sideSaucePrice = item.build.sideSaucePriceCents || 0;
      eligibleSpendCents += item.build.totalCents - sideSaucePrice;
      if (sideSaucePrice > 0) saucePrices.push(sideSaucePrice);
    } else if (item.kind === 'addon') {
      subtotalCents += item.addon.priceCents;
      saucePrices.push(item.addon.priceCents);
    }
  }

  const sauceCount = saucePrices.length;
  const actualSauceCost = saucePrices.reduce((sum, p) => sum + p, 0);
  const freeSauceUnlocked = sauceCount > 0 && eligibleSpendCents >= config.free_threshold_cents;

  // 2. What the sauces should cost under the configured rules
  let newSaucesCost: number;
  if (config.pricing_mode === 'promo') {
    // Every sauce costs the same promo price, so which one is free doesn't matter.
    const paidSauces = sauceCount - (freeSauceUnlocked ? 1 : 0);
    const pairs = Math.floor(paidSauces / 2);
    const singles = paidSauces % 2;
    newSaucesCost = pairs * config.pair_price_cents + singles * config.single_price_cents;
  } else {
    let freeSauceCents = 0;
    if (freeSauceUnlocked) {
      freeSauceCents = config.free_sauce_pick === 'most_expensive'
        ? Math.max(...saucePrices)
        : Math.min(...saucePrices);
    }
    newSaucesCost = actualSauceCost - freeSauceCents;
  }

  // Promo prices never charge more than the sauces' own prices.
  const discountCents = Math.max(0, actualSauceCost - newSaucesCost);

  return {
    subtotalCents,
    sauceCount,
    eligibleSpendCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}
