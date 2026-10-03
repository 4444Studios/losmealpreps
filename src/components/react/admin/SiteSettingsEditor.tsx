import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/pricing';
import { DEFAULT_SAUCE_CONFIG, parseSauceConfig } from '@/lib/cart-math';
import type { FreeSaucePick, SaucePricingConfig, SaucePricingMode } from '@/lib/cart-math';

type SauceConfig = SaucePricingConfig;
type CentsKey = 'single_price_cents' | 'pair_price_cents' | 'free_threshold_cents';

const PRICING_MODES: { value: SaucePricingMode; label: string; hint: string }[] = [
  {
    value: 'promo',
    label: 'Promo price for every sauce',
    hint: 'Every sauce is charged the single / pair price below, no matter its own price.',
  },
  {
    value: 'individual',
    label: "Each sauce's own price",
    hint: 'Sauces are charged the size price set in Ingredients. No pair deal.',
  },
];

const FREE_SAUCE_PICKS: { value: FreeSaucePick; label: string }[] = [
  { value: 'cheapest', label: 'Lowest priced sauce in the cart' },
  { value: 'most_expensive', label: 'Highest priced sauce in the cart' },
];

export default function SiteSettingsEditor() {
  const [config, setConfig] = useState<SauceConfig>(DEFAULT_SAUCE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadConfig() {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'sauce_pricing_config')
        .single();

      if (!error && data?.value) {
        setConfig(parseSauceConfig(data.value));
      }
      setLoading(false);
    }
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    const { error } = await supabase
      .from('site_settings')
      .upsert({
        key: 'sauce_pricing_config',
        value: JSON.stringify(config),
      }, { onConflict: 'key' });

    setSaving(false);
    if (error) {
      setMessage('Failed to save configuration.');
      console.error(error);
    } else {
      setMessage('Configuration saved successfully.');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleCentsChange = (key: CentsKey, valueStr: string) => {
    const val = parseFloat(valueStr);
    if (!isNaN(val)) {
      setConfig((prev) => ({ ...prev, [key]: Math.round(val * 100) }));
    } else {
      setConfig((prev) => ({ ...prev, [key]: 0 }));
    }
  };

  if (loading) return <div className="p-8 text-center text-[var(--color-fg-muted)]">Loading settings...</div>;

  return (
    <div className="bg-[var(--color-surface-elevated)] rounded-[var(--radius-card)] p-6 shadow-[var(--shadow-card)]">
      <h2 className="font-[family-name:var(--font-display)] text-[24px] font-bold text-[var(--color-fg)] mb-6">Promotions &amp; Settings</h2>

      <form onSubmit={handleSave} className="space-y-6 max-w-md">
        <div className="space-y-4 border border-[var(--color-surface-sunken)] p-4 rounded-[var(--radius-card)]">
          <h3 className="font-bold text-[16px] text-[var(--color-fg)]">Sauce Tiered Pricing</h3>

          <fieldset>
            <legend className="block text-[14px] font-medium text-[var(--color-fg-muted)] mb-2">
              How sauces are priced
            </legend>
            <div className="space-y-2">
              {PRICING_MODES.map((mode) => (
                <label key={mode.value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pricing_mode"
                    value={mode.value}
                    checked={config.pricing_mode === mode.value}
                    onChange={() => setConfig((prev) => ({ ...prev, pricing_mode: mode.value }))}
                    className="mt-1 accent-[var(--color-brand)]"
                  />
                  <span>
                    <span className="block text-[14px] text-[var(--color-fg)]">{mode.label}</span>
                    <span className="block text-[12px] text-[var(--color-fg-subtle)]">{mode.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {config.pricing_mode === 'promo' && (
            <>
              <div>
                <label className="block text-[14px] font-medium text-[var(--color-fg-muted)] mb-1">
                  Single Sauce Price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={(config.single_price_cents / 100).toFixed(2)}
                  onChange={(e) => handleCentsChange('single_price_cents', e.target.value)}
                  className="w-full bg-[var(--color-surface-base)] border border-[var(--color-surface-sunken)] rounded-[var(--radius-base)] px-3 py-2 text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[var(--color-fg-muted)] mb-1">
                  Pair of Sauces Price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={(config.pair_price_cents / 100).toFixed(2)}
                  onChange={(e) => handleCentsChange('pair_price_cents', e.target.value)}
                  className="w-full bg-[var(--color-surface-base)] border border-[var(--color-surface-sunken)] rounded-[var(--radius-base)] px-3 py-2 text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-brand)]"
                />
                <p className="text-[12px] text-[var(--color-fg-subtle)] mt-1">If a user buys 2 sauces, they will be charged this price instead of 2x the single price.</p>
                {config.pair_price_cents >= config.single_price_cents * 2 && (
                  <p className="text-[12px] text-rose-600 mt-1">
                    This isn't a deal — 2 sauces at the single price cost {formatPrice(config.single_price_cents * 2)}.
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-[14px] font-medium text-[var(--color-fg-muted)] mb-1">
              Free Sauce Cart Threshold ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={(config.free_threshold_cents / 100).toFixed(2)}
              onChange={(e) => handleCentsChange('free_threshold_cents', e.target.value)}
              className="w-full bg-[var(--color-surface-base)] border border-[var(--color-surface-sunken)] rounded-[var(--radius-base)] px-3 py-2 text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-brand)]"
            />
            <p className="text-[12px] text-[var(--color-fg-subtle)] mt-1">Cart subtotal (excluding sauces) must reach this to unlock 1 free sauce.</p>
          </div>

          {config.pricing_mode === 'individual' && (
            <div>
              <label htmlFor="free_sauce_pick" className="block text-[14px] font-medium text-[var(--color-fg-muted)] mb-1">
                Which sauce is free
              </label>
              <select
                id="free_sauce_pick"
                value={config.free_sauce_pick}
                onChange={(e) => setConfig((prev) => ({ ...prev, free_sauce_pick: e.target.value as FreeSaucePick }))}
                className="w-full bg-[var(--color-surface-base)] border border-[var(--color-surface-sunken)] rounded-[var(--radius-base)] px-3 py-2 text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-brand)]"
              >
                {FREE_SAUCE_PICKS.map((pick) => (
                  <option key={pick.value} value={pick.value}>{pick.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-[var(--color-brand)] text-white px-6 py-2.5 rounded-[var(--radius-pill)] font-medium hover:bg-[var(--color-brand-hover)] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
          {message && (
            <span className={`text-[14px] ${message.includes('successfully') ? 'text-emerald-600' : 'text-rose-600'}`}>
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
