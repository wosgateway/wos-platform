'use client';

// src/lib/journey/context.tsx
//
// "My Journey Builder" cart — lets a customer collect several main
// programs from different pages/partners (e.g. hospital check-up +
// dental clinic + spa) before booking them together as one Master
// Order. This is intentionally separate from the existing
// BookingForm hotel/transport add-on flow, which is per-package.
//
// State lives client-side only (localStorage) — there's no
// customer-auth concept yet on the public site (see app/api/orders
// note in create_order_with_items()), so this cart is not synced to
// Supabase until the customer actually submits the booking form at
// /booking/journey, at which point each item becomes an order_item
// via the existing multi-item create_order_with_items() RPC.
//
// Storage schema versioned via the key name — bump to `wos_journey_v2`
// if the JourneyItem shape ever changes incompatibly, so old stored
// carts don't get parsed into a broken shape.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface JourneyItem {
  id: string; // package id
  title: string;
  price: number;
  image_url: string | null;
  category?: string | null;
  partnerName?: string | null;
}

interface JourneyContextValue {
  items: JourneyItem[];
  addItem: (item: JourneyItem) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  isInJourney: (id: string) => boolean;
  total: number;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);
const STORAGE_KEY = 'wos_journey_v1';

export function JourneyProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<JourneyItem[]>([]);
  // Guards against writing [] back to storage before the initial
  // read below has actually happened (localStorage is only
  // available client-side, so the very first render is always []).
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {
      // Corrupt/blocked storage — just start with an empty cart.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full/disabled (e.g. private browsing) — non-fatal,
      // the cart just won't survive a refresh.
    }
  }, [items, hydrated]);

  const addItem = useCallback((item: JourneyItem) => {
    setItems((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item]));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const isInJourney = useCallback((id: string) => items.some((p) => p.id === id), [items]);

  const total = useMemo(() => items.reduce((sum, i) => sum + (i.price || 0), 0), [items]);

  const value = useMemo<JourneyContextValue>(
    () => ({ items, addItem, removeItem, clear, isInJourney, total }),
    [items, addItem, removeItem, clear, isInJourney, total]
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) {
    throw new Error('useJourney must be used within a <JourneyProvider>');
  }
  return ctx;
}
