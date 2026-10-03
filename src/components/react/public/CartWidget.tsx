import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/pricing';
import { buildInstagramOrderParts } from '@/lib/format-order';
import { repriceCartItems } from '@/lib/reprice-cart';
import { parseSauceConfig, calculateCartTotals } from '@/lib/cart-math';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/scroll-lock';
import CartAddonsUpsell from './CartAddonsUpsell';

interface Props {
  igHandle: string;
  saucePricingConfigRaw?: string | null;
}

interface ToastState {
  title: string;
  message: string;
  tone: 'success' | 'warning' | 'error';
}

interface HandoffState {
  parts: string[];
  partIndex: number;
  priceWasUpdated: boolean;
  priceRefreshFailed: boolean;
}

async function copyOrderText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand for stricter mobile browsers.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function navigateReservedWindow(igWindow: Window | null, igHandle: string): void {
  const igUrl = `https://ig.me/m/${igHandle}`;
  if (igWindow && !igWindow.closed) {
    igWindow.location.href = igUrl;
    return;
  }
  const opened = window.open(igUrl, '_blank');
  if (!opened) {
    window.location.assign(igUrl);
  }
}

export default function CartWidget({ igHandle, saucePricingConfigRaw }: Props) {
  const { items, removeItem, clearItems, replaceItems } = useCartStore();
  const [open, setOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [allowMobileStickyBar, setAllowMobileStickyBar] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [handoff, setHandoff] = useState<HandoffState | null>(null);

  const sauceConfig = useMemo(() => parseSauceConfig(saucePricingConfigRaw), [saucePricingConfigRaw]);

  const { totalCents, discountCents, subtotalCents, eligibleSpendCents } = useMemo(
    () => calculateCartTotals(items, sauceConfig),
    [items, sauceConfig]
  );

  const itemCount = items.length;
  const showStickyBar = isMounted && !open && itemCount > 0 && allowMobileStickyBar && !handoff;

  const partCount = useMemo(
    () => (items.length === 0 ? 0 : buildInstagramOrderParts(items, discountCents, totalCents).length),
    [items, discountCents, totalCents],
  );

  useEffect(() => {
    // Avoid portal usage before mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    const path = window.location.pathname;
    setAllowMobileStickyBar(path !== '/build' && path !== '/admin' && path !== '/customize');
  }, []);

  useEffect(() => {
    if (!open && !handoff) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (handoff) return;
        setOpen(false);
      }
    };
    lockBodyScroll();
    window.addEventListener('keydown', onKeyDown);

    return () => {
      unlockBodyScroll();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handoff]);

  useEffect(() => {
    const closeForMenuOpen = () => {
      if (!handoff) setOpen(false);
    };
    const openCart = () => setOpen(true);
    window.addEventListener('mobile-menu:open', closeForMenuOpen);
    window.addEventListener('cart:open:request', openCart);
    return () => {
      window.removeEventListener('mobile-menu:open', closeForMenuOpen);
      window.removeEventListener('cart:open:request', openCart);
    };
  }, [handoff]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('cart:open'));
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showStickyBar) {
      document.documentElement.style.removeProperty('--mobile-cart-bar-offset');
      document.documentElement.classList.remove('has-mobile-cart-bar');
      return;
    }
    document.documentElement.style.setProperty(
      '--mobile-cart-bar-offset',
      'calc(4.5rem + env(safe-area-inset-bottom, 0px))',
    );
    document.documentElement.classList.add('has-mobile-cart-bar');
    return () => {
      document.documentElement.style.removeProperty('--mobile-cart-bar-offset');
      document.documentElement.classList.remove('has-mobile-cart-bar');
    };
  }, [showStickyBar]);

  const finishHandoff = () => {
    clearItems();
    setHandoff(null);
    setOpen(false);
    setRedirecting(false);
  };

  const handleSendOrder = async () => {
    if (items.length === 0 || redirecting || handoff) return;

    setRedirecting(true);

    let workingItems = items;
    let workingDiscount = discountCents;
    let workingTotal = totalCents;
    let priceWasUpdated = false;
    let priceRefreshFailed = false;

    try {
      const repriced = await repriceCartItems(items);
      if (repriced.hadPriceChanges) {
        replaceItems(repriced.items);
        workingItems = repriced.items;
        priceWasUpdated = true;
        const updatedTotals = calculateCartTotals(repriced.items, sauceConfig);
        workingDiscount = updatedTotals.discountCents;
        workingTotal = updatedTotals.totalCents;
      }
    } catch {
      priceRefreshFailed = true;
    }

    const parts = buildInstagramOrderParts(workingItems, workingDiscount, workingTotal);
    setHandoff({
      parts,
      partIndex: 0,
      priceWasUpdated,
      priceRefreshFailed,
    });
    setRedirecting(false);
  };

  const handleCopyHandoffPart = async () => {
    if (!handoff) return;
    const { parts, partIndex } = handoff;
    if (partIndex >= parts.length) return;

    const part = parts[partIndex];
    // Reserve IG tab on the first part tap before awaiting clipboard.
    const igWindow = partIndex === 0 ? window.open('about:blank', '_blank') : null;

    const copied = await copyOrderText(part);
    if (!copied) {
      igWindow?.close();
      setToast({
        title: 'Clipboard blocked',
        message: 'Could not copy automatically. Long-press the order text above to select and copy, then paste in Instagram.',
        tone: 'error',
      });
      return;
    }

    const nextIndex = partIndex + 1;
    const isLastPart = nextIndex >= parts.length;
    const isMultipart = parts.length > 1;

    if (partIndex === 0) {
      navigateReservedWindow(igWindow, igHandle);
    }

    setToast({
      title: isMultipart
        ? isLastPart
          ? 'All parts copied'
          : `Part ${partIndex + 1} of ${parts.length} copied`
        : 'Order copied',
      message: isMultipart
        ? isLastPart
          ? 'Paste the last part in the same Instagram DM, then tap Send.'
          : partIndex === 0
            ? 'Paste in Instagram, then return here for the next part.'
            : 'Paste this part in the same DM, then copy the next part.'
        : 'In Instagram: paste into the DM, then tap Send.',
      tone: handoff.priceRefreshFailed && partIndex === 0 ? 'warning' : 'success',
    });
    setHandoff({ ...handoff, partIndex: nextIndex });
  };

  const handleCopyAgain = async () => {
    if (!handoff) return;
    const { parts, partIndex } = handoff;
    const textIndex = Math.min(partIndex, parts.length - 1);
    const part = parts[textIndex];
    const copied = await copyOrderText(part);
    if (!copied) {
      setToast({
        title: 'Clipboard blocked',
        message: 'Long-press the order text above to select and copy, then paste in Instagram.',
        tone: 'error',
      });
      return;
    }
    setToast({
      title: parts.length > 1 ? `Part ${textIndex + 1} copied again` : 'Order copied again',
      message: 'In Instagram: paste into the DM, then tap Send.',
      tone: 'success',
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex items-center justify-center min-h-[44px] min-w-[44px] w-11 h-11 sm:w-10 sm:h-10 rounded-full border border-[var(--color-surface-sunken)] text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)] transition-colors"
        aria-expanded={open}
        aria-controls="cart-drawer"
        aria-label="Open cart"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2h3l2.6 12.3a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L22 6H6" />
        </svg>
        {itemCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[var(--color-brand)] text-white text-[11px] font-bold flex items-center justify-center">
            {itemCount}
          </span>
        )}
      </button>

      {showStickyBar && createPortal(
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="sm:hidden fixed left-4 right-4 z-[110] rounded-[var(--radius-pill)] bg-[var(--color-brand)] text-white shadow-[var(--shadow-rail)] px-4 py-3 flex items-center justify-between"
          style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
          aria-label="View cart"
        >
          <span className="text-[13px] font-semibold">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          <span className="text-[14px] font-semibold">View Cart · {formatPrice(totalCents)}</span>
        </button>,
        document.body,
      )}

      {isMounted && open && createPortal(
        <div className="fixed inset-0 z-[120]">
          <div
            className="absolute inset-0 bg-black/35"
            aria-hidden="true"
            onClick={() => {
              if (!handoff) setOpen(false);
            }}
          />
          <aside
            id="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            className="absolute right-0 top-0 h-dvh w-full sm:max-w-[420px] bg-[var(--color-surface-base)] border-l border-[var(--color-surface-sunken)] shadow-[var(--shadow-rail)] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-[var(--color-surface-sunken)] flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-[22px] font-semibold text-[var(--color-fg)]">
                Your Cart
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (!handoff) setOpen(false);
                }}
                disabled={Boolean(handoff)}
                className="h-11 w-11 inline-flex items-center justify-center rounded-full text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-fg)] transition-colors disabled:opacity-40"
                aria-label="Close cart"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {handoff ? (
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-4">
                <div className="rounded-[var(--radius-card)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-elevated)] p-4 space-y-4">
                  <div className="space-y-1">
                    <p className="text-[14px] font-semibold text-[var(--color-fg)]">
                      Send your order on Instagram
                    </p>
                    {handoff.parts.length > 1 && (
                      <p className="text-[13px] text-[var(--color-fg-muted)] leading-relaxed">
                        This order is split into {handoff.parts.length} messages—paste them in order.
                      </p>
                    )}
                  </div>

                  {(handoff.priceWasUpdated || handoff.priceRefreshFailed) && (
                    <p
                      className={`text-[12px] leading-relaxed rounded-[var(--radius-input)] px-3 py-2 ${
                        handoff.priceRefreshFailed
                          ? 'bg-amber-50 text-amber-800 border border-amber-100'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-100'
                      }`}
                    >
                      {handoff.priceRefreshFailed
                        ? 'Could not refresh latest prices. This order uses your current cart values.'
                        : 'Latest prices were applied to this order.'}
                    </p>
                  )}

                  <ol className="space-y-2 text-[13px] text-[var(--color-fg)] list-none">
                    <li className="flex gap-3">
                      <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[12px] font-bold text-[var(--color-brand)]">
                        1
                      </span>
                      <span className="leading-relaxed pt-0.5">
                        <span className="font-semibold">Copy your order</span>
                        {' — '}tap the button below
                        {handoff.partIndex > 0 ? ' ✓' : ''}
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[12px] font-bold text-[var(--color-brand)]">
                        2
                      </span>
                      <span className="leading-relaxed pt-0.5">
                        <span className="font-semibold">Instagram opens</span>
                        {' — '}DM with @{igHandle}
                        {handoff.partIndex > 0 ? ' ✓' : ''}
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[12px] font-bold text-[var(--color-brand)]">
                        3
                      </span>
                      <span className="leading-relaxed pt-0.5">
                        <span className="font-semibold">Paste and send</span>
                        {' — '}long-press → Paste on phone
                      </span>
                    </li>
                  </ol>

                  {handoff.parts.length > 1 && (
                    <p className="text-[13px] font-medium text-[var(--color-brand)]">
                      {handoff.partIndex >= handoff.parts.length
                        ? `All ${handoff.parts.length} messages copied — paste the last one, then send`
                        : `Message ${Math.min(handoff.partIndex + 1, handoff.parts.length)} of ${handoff.parts.length}`}
                    </p>
                  )}

                  {(handoff.parts.length > 1 || handoff.partIndex === 0) && (
                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto rounded-[var(--radius-input)] bg-[var(--color-surface-sunken)] p-3 text-[var(--color-fg-muted)] select-text">
                      {handoff.parts[Math.min(handoff.partIndex, handoff.parts.length - 1)]}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
                {items.length === 0 ? (
                  <p className="text-[14px] text-[var(--color-fg-muted)]">Your cart is empty.</p>
                ) : (
                  items.map((item) => (
                    <div key={item.cartId} className="border border-[var(--color-surface-sunken)] rounded-[var(--radius-card)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {item.kind === 'meal' ? (
                            <>
                              <p className="text-[14px] font-semibold text-[var(--color-fg)] break-words">{item.meal.name}</p>
                              <p className="text-[12px] text-[var(--color-fg-muted)]">Signature meal</p>
                              <p className="text-[12px] text-[var(--color-brand)] mt-1">
                                {formatPrice(item.meal.base_price_cents)}
                              </p>
                            </>
                          ) : item.kind === 'bundle' ? (
                            <>
                              <p className="text-[14px] font-semibold text-[var(--color-fg)] break-words">{item.bundle.bundleName}</p>
                              <p className="text-[12px] text-[var(--color-fg-muted)]">
                                Bundle · {item.bundle.slotCount} meals · {item.bundle.proteinSizeLabel} protein
                              </p>
                              <p className="text-[12px] text-[var(--color-fg-muted)] mt-1 break-words">
                                {Object.entries(
                                  item.bundle.mealNames.reduce((acc, name) => {
                                    acc[name] = (acc[name] ?? 0) + 1;
                                    return acc;
                                  }, {} as Record<string, number>),
                                ).map(([name, count], idx) => (
                                  <React.Fragment key={`${item.cartId}-${name}`}>
                                    {idx > 0 ? ' · ' : ''}
                                    {count}x {name}
                                  </React.Fragment>
                                ))}
                              </p>
                              <p className="text-[12px] text-[var(--color-brand)] mt-1">
                                {formatPrice(item.bundle.totalCents)}
                              </p>
                            </>
                          ) : item.kind === 'custom' ? (
                            <>
                              <p className="text-[14px] font-semibold text-[var(--color-fg)] break-words">
                                {item.build.proteinName}{item.build.proteinSize ? ` (${item.build.proteinSize})` : ''}
                              </p>
                              <p className="text-[12px] text-[var(--color-fg-muted)]">Custom meal</p>
                              <p className="text-[12px] text-[var(--color-fg-muted)] mt-1 break-words">
                                {item.build.macros.calories} cal · {item.build.macros.protein_g}g P · {item.build.macros.carbs_g}g C · {item.build.macros.fat_g}g F
                              </p>
                              <p className="text-[12px] text-[var(--color-brand)] mt-1">
                                {formatPrice(item.build.totalCents)}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-[14px] font-semibold text-[var(--color-fg)] break-words">
                                {item.addon.name}{item.addon.sizeLabel ? ` (${item.addon.sizeLabel})` : ''}
                              </p>
                              <p className="text-[12px] text-[var(--color-fg-muted)]">Add-on</p>
                              <p className="text-[12px] text-[var(--color-brand)] mt-1">
                                {formatPrice(item.addon.priceCents)}
                              </p>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.cartId)}
                          className="shrink-0 min-h-[44px] px-2 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-brand)] transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <CartAddonsUpsell sauceConfig={sauceConfig} />
              </div>
            )}

            <div
              className="border-t border-[var(--color-surface-sunken)] px-4 sm:px-5 pt-3 sm:pt-4 space-y-2 sm:space-y-3 bg-[var(--color-surface-base)]"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {handoff ? (
                <>
                  {handoff.partIndex >= handoff.parts.length ? (
                    <button
                      type="button"
                      onClick={finishHandoff}
                      className="w-full bg-[var(--color-brand)] text-white py-2.5 sm:py-3 rounded-[var(--radius-pill)] text-[14px] font-semibold transition-colors min-h-[44px] sm:min-h-[48px]"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCopyHandoffPart}
                      className="w-full bg-[var(--color-brand)] text-white py-2.5 sm:py-3 rounded-[var(--radius-pill)] text-[14px] font-semibold transition-colors min-h-[44px] sm:min-h-[48px]"
                    >
                      {handoff.parts.length === 1
                        ? 'Copy order & open Instagram'
                        : handoff.partIndex === 0
                          ? `Copy message 1 of ${handoff.parts.length} & open Instagram`
                          : `Copy message ${handoff.partIndex + 1} of ${handoff.parts.length}`}
                    </button>
                  )}
                  <div className="flex items-center justify-center gap-4 min-h-[36px]">
                    {handoff.partIndex > 0 && (
                      <button
                        type="button"
                        onClick={handleCopyAgain}
                        className="text-[12px] font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] transition-colors py-1"
                      >
                        Copy again
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHandoff(null);
                        setRedirecting(false);
                      }}
                      className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-brand)] transition-colors py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {discountCents > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[12px] text-[var(--color-fg-muted)]">
                        <span>Subtotal</span>
                        <span>{formatPrice(subtotalCents)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[12px] text-emerald-600">
                        <span>Sauce promo</span>
                        <span>-{formatPrice(discountCents)}</span>
                      </div>
                    </div>
                  ) : (
                    eligibleSpendCents < sauceConfig.free_threshold_cents && sauceConfig.free_threshold_cents > 0 && items.length > 0 && (
                      <div className="px-2.5 py-2 bg-emerald-50 rounded-[var(--radius-base)] border border-emerald-100 flex items-center gap-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-emerald-800 leading-snug">
                            {formatPrice(sauceConfig.free_threshold_cents - eligibleSpendCents)} more → free sauce
                          </p>
                          <div className="mt-1.5 h-1 bg-emerald-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, (eligibleSpendCents / sauceConfig.free_threshold_cents) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  )}

                  <div className="flex justify-between items-baseline gap-3">
                    <span className="text-[14px] font-bold text-[var(--color-fg)]">Total</span>
                    <span className="text-[22px] sm:text-[24px] font-[family-name:var(--font-display)] font-bold text-[var(--color-brand)] leading-none">
                      {formatPrice(totalCents)}
                    </span>
                  </div>

                  {items.length > 0 && (
                    <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
                      New clients: 1 meal OK · Returning: $60 or 5 meals
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSendOrder}
                    disabled={items.length === 0 || redirecting}
                    className="w-full bg-[var(--color-brand)] disabled:bg-[var(--color-surface-sunken)] disabled:text-[var(--color-fg-subtle)] text-white py-2.5 sm:py-3 rounded-[var(--radius-pill)] text-[14px] font-semibold transition-colors min-h-[44px] sm:min-h-[48px]"
                  >
                    {redirecting ? 'Preparing…' : 'Send on Instagram'}
                  </button>

                  <div className="flex items-center justify-between gap-3 min-h-[28px]">
                    <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug flex-1">
                      {partCount > 1 ? `Sends as ${partCount} messages` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={clearItems}
                      disabled={items.length === 0}
                      className="shrink-0 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-brand)] transition-colors disabled:opacity-50 py-1"
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}

      {isMounted && toast && createPortal(
        <div
          role="status"
          aria-live="polite"
          className={`fixed left-4 right-4 sm:left-auto sm:right-4 sm:w-[390px] z-[140] rounded-[var(--radius-card)] border px-4 py-3 shadow-[var(--shadow-rail)] ${
            toast.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50'
              : toast.tone === 'warning'
                ? 'border-amber-200 bg-amber-50'
                : 'border-rose-200 bg-rose-50'
          }`}
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="flex items-start gap-3">
            <span
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
                toast.tone === 'success'
                  ? 'bg-emerald-100 text-emerald-700'
                  : toast.tone === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-rose-100 text-rose-700'
              }`}
            >
              {toast.tone === 'success' ? '✓' : toast.tone === 'warning' ? '!' : '×'}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--color-fg)]">{toast.title}</p>
              <p className="text-[12px] text-[var(--color-fg-muted)] mt-1 leading-relaxed">{toast.message}</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
