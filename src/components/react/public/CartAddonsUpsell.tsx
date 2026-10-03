import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/pricing';
import type { SaucePricingConfig } from '@/lib/cart-math';

interface SauceSize {
  variantId: string;
  sizeLabel: string;
  priceCents: number;
}

interface SauceAddon {
  id: string;
  name: string;
  sizes: SauceSize[];
}

interface CartAddonsUpsellProps {
  sauceConfig?: SaucePricingConfig;
}

export default function CartAddonsUpsell({ sauceConfig }: CartAddonsUpsellProps) {
  const [sauces, setSauces] = useState<SauceAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const addAddonItem = useCartStore((state) => state.addAddonItem);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSauces() {
      const [{ data: ings, error: e1 }, { data: vars, error: e2 }] = await Promise.all([
        supabase
          .from('ingredients')
          .select('id, name')
          .eq('type', 'sauce')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),
        supabase
          .from('ingredient_variants')
          .select('id, ingredient_id, size_label, price_cents')
          .order('display_order', { ascending: true }),
      ]);

      if (!e1 && !e2 && ings && vars) {
        setSauces(
          ings
            .map((ing) => ({
              id: ing.id,
              name: ing.name,
              sizes: vars
                .filter((v) => v.ingredient_id === ing.id)
                .map((v) => ({ variantId: v.id, sizeLabel: v.size_label, priceCents: v.price_cents })),
            }))
            // A sauce with no priced size can't be ordered as an extra.
            .filter((sauce) => sauce.sizes.length > 0),
        );
      }
      setLoading(false);
    }
    fetchSauces();
  }, []);

  if (loading || sauces.length === 0) return null;

  const promoMode = sauceConfig?.pricing_mode !== 'individual';

  const handleAdd = (sauce: SauceAddon, size: SauceSize) => {
    addAddonItem({
      id: sauce.id,
      name: sauce.name,
      priceCents: size.priceCents,
      variantId: size.variantId,
      sizeLabel: sauce.sizes.length > 1 ? size.sizeLabel : undefined,
    });
    setAddedKey(size.variantId);
    setTimeout(() => setAddedKey(null), 1000);
  };

  // In promo mode every sauce is charged the promo single price, so show that.
  const displayPrice = (size: SauceSize) =>
    promoMode && sauceConfig ? Math.min(size.priceCents, sauceConfig.single_price_cents) : size.priceCents;

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-surface-sunken)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-[var(--color-fg)]">Add some extras?</h3>
      </div>
      {sauceConfig && (
        <div className="mb-3 px-3 py-2 bg-emerald-50 rounded-[var(--radius-base)] border border-emerald-100">
          <p className="text-[12px] font-medium text-emerald-800">
            {promoMode
              ? `Promo: 2 for ${formatPrice(sauceConfig.pair_price_cents)} or FREE with a ${formatPrice(sauceConfig.free_threshold_cents)} order.`
              : `Promo: 1 FREE sauce (${sauceConfig.free_sauce_pick === 'most_expensive' ? 'highest priced' : 'lowest priced'}) with a ${formatPrice(sauceConfig.free_threshold_cents)} order.`}
          </p>
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x hide-scrollbar">
        {sauces.map((sauce) => (
          <div key={sauce.id} className="min-w-[120px] snap-start bg-[var(--color-surface-base)] rounded-[var(--radius-card)] p-3 shadow-sm border border-[var(--color-surface-sunken)] flex flex-col justify-between">
            <p className="font-semibold text-[13px] text-[var(--color-fg)] leading-tight">{sauce.name}</p>
            {sauce.sizes.length === 1 && (
              <p className="text-[12px] text-[var(--color-brand)] mt-1">{formatPrice(displayPrice(sauce.sizes[0]))}</p>
            )}
            <div className="mt-3 flex flex-col gap-1.5">
              {sauce.sizes.map((size) => (
                <button
                  key={size.variantId}
                  type="button"
                  onClick={() => handleAdd(sauce, size)}
                  className="w-full text-[12px] font-medium py-1.5 px-2 rounded-[var(--radius-pill)] border border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white transition-colors whitespace-nowrap"
                >
                  {addedKey === size.variantId
                    ? 'Added!'
                    : sauce.sizes.length > 1
                      ? `${size.sizeLabel} · ${formatPrice(displayPrice(size))}`
                      : 'Add'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
