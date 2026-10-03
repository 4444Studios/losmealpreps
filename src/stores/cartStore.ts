import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Database } from '@/types/database.types';

export type Meal = Database['public']['Tables']['meals']['Row'];

export interface SelectedProteinSize {
  label: string;
  priceCents: number;
}

export interface CustomBuildSummary {
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
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  selection?: {
    proteinId: string;
    proteinVariantId: string | null;
    carbId: string | null;
    veggieIds: string[];
    flavorId: string | null;
    sideSauceId: string | null;
    sideSauceVariantId: string | null;
  };
}

export interface BundleCartSummary {
  bundleId: string;
  bundleName: string;
  mealType: 'staple' | 'weekly';
  slotCount: number;
  proteinSizeLabel: string;
  totalCents: number;
  mealNames: string[];
}

export interface AddonCartSummary {
  id: string;
  name: string;
  priceCents: number;
  /** Size variant the price came from; absent on carts saved before sizes were tracked. */
  variantId?: string;
  sizeLabel?: string;
}

export type CartItem =
  | { kind: 'meal';   cartId: string; meal: Meal }
  | { kind: 'custom'; cartId: string; build: CustomBuildSummary }
  | { kind: 'bundle'; cartId: string; bundle: BundleCartSummary }
  | { kind: 'addon';  cartId: string; addon: AddonCartSummary };

interface CartState {
  activeBundleId: string | null;
  activeSlotCount: number | null;
  selectedProteinSize: SelectedProteinSize | null;
  slots: (Meal | null)[];
  setBundleConfig: (
    bundleId: string,
    slotCount: number,
    proteinSize?: SelectedProteinSize | null,
    options?: { preserveMeals?: boolean },
  ) => void;
  setProteinSize: (size: SelectedProteinSize) => void;
  addMeal: (meal: Meal) => void;
  removeMeal: (index: number) => void;
  clearBuilderSlots: () => void;

  items: CartItem[];
  addMealItem: (meal: Meal) => void;
  addCustomItem: (build: CustomBuildSummary) => void;
  addBundleItem: (bundle: BundleCartSummary) => void;
  addAddonItem: (addon: AddonCartSummary) => void;
  replaceItems: (items: CartItem[]) => void;
  removeItem: (cartId: string) => void;
  clearItems: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      activeBundleId: null,
      activeSlotCount: null,
      selectedProteinSize: null,
      slots: [],
      items: [],

      setBundleConfig: (bundleId, slotCount, proteinSize = null, options) => set((state) => {
        const sameBundle = state.activeBundleId === bundleId;
        const sameSlots = state.activeSlotCount === slotCount;
        const sameSize =
          (state.selectedProteinSize?.label ?? null) === (proteinSize?.label ?? null);

        if (sameBundle && sameSlots && sameSize && state.slots.length === slotCount) {
          return state;
        }

        const preserveMeals = options?.preserveMeals ?? false;
        const newSlots = new Array(slotCount).fill(null) as (Meal | null)[];
        if (preserveMeals && sameBundle) {
          const existingMeals = state.slots.filter((m) => m !== null);
          for (let i = 0; i < Math.min(existingMeals.length, slotCount); i++) {
            newSlots[i] = existingMeals[i];
          }
        }

        return {
          activeBundleId: bundleId,
          activeSlotCount: slotCount,
          selectedProteinSize: proteinSize,
          slots: newSlots,
        };
      }),

      setProteinSize: (size) => set((state) => ({
        selectedProteinSize: size,
        slots: new Array(state.slots.length).fill(null),
      })),

      addMeal: (meal) => set((state) => {
        if (!state.activeBundleId || !state.selectedProteinSize) return state;
        const emptyIndex = state.slots.findIndex((m) => m === null);
        if (emptyIndex === -1) return state;
        const newSlots = [...state.slots];
        newSlots[emptyIndex] = meal;
        return { slots: newSlots };
      }),

      removeMeal: (index) => set((state) => {
        const meals = state.slots.filter((_, i) => i !== index && state.slots[i] !== null);
        const compressedSlots = new Array(state.slots.length).fill(null) as (Meal | null)[];
        meals.forEach((m, i) => { compressedSlots[i] = m; });
        return { slots: compressedSlots };
      }),

      clearBuilderSlots: () => set((state) => ({
        slots: new Array(state.slots.length).fill(null),
      })),

      addMealItem: (meal) => set((state) => ({
        items: [...state.items, { kind: 'meal', cartId: crypto.randomUUID(), meal }],
      })),

      addCustomItem: (build) => set((state) => ({
        items: [...state.items, { kind: 'custom', cartId: crypto.randomUUID(), build }],
      })),

      addBundleItem: (bundle) => set((state) => ({
        items: [...state.items, { kind: 'bundle', cartId: crypto.randomUUID(), bundle }],
      })),

      addAddonItem: (addon) => set((state) => ({
        items: [...state.items, { kind: 'addon', cartId: crypto.randomUUID(), addon }],
      })),

      replaceItems: (items) => set({ items }),

      removeItem: (cartId) => set((state) => ({
        items: state.items.filter(i => i.cartId !== cartId),
      })),

      clearItems: () => set({ items: [] }),
    }),
    { name: 'los-meal-preps-cart-v2' },
  ),
);
