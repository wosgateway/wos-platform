'use client';

// src/components/admin/PackagePickerCombobox.tsx
//
// Two-step replacement for the plain <select> used to reassign a
// hotel/transport order_item to a different package:
//
//   Step 1 — search & pick a PARTNER (debounced, hits
//   /api/admin/partners/pickers, shows province next to each name so
//   an admin recognizing "อุดรธานี" can find the right row without
//   knowing the exact business name).
//
//   Step 2 — pick one of that PARTNER's packages (hits
//   /api/admin/packages/pickers?partner_id=..., always a short list
//   regardless of how many partners/packages exist nationwide).
//
// This replaces the old approach of loading every published/active
// package for the category up front — once there are 100+ partners
// nationwide, a flat list (searchable or not) is either too slow to
// load or too big to scan. Splitting into "which partner" then "which
// package" keeps every request small no matter how many partners
// there are.

import { useEffect, useMemo, useRef, useState } from 'react';

interface PartnerOption {
  id: string;
  name: string;
  province: string | null;
}

interface PackageOption {
  id: string;
  title: string;
  original_price: number | null;
  special_price: number | null;
}

interface PackagePickerComboboxProps {
  // Matches the partners.category / packages picker CHECK constraint
  // value exactly, e.g. 'Transport' or 'Hotel'.
  category: string;
  onSelect: (packageId: string, packageLabel?: string) => void;
  disabled?: boolean;
  placeholder: string;
  // Optional: text to show in the closed input once a package has
  // been picked. BookingsManager doesn't need this — reassignItem()
  // updates the item elsewhere on the row, so the picker going back
  // to its placeholder is fine there. A caller with nothing else
  // showing the confirmed pick (e.g. pending-assignments, before its
  // own "Assign" button is pressed) can pass the label back in.
  selectedLabel?: string;
}

function partnerLabel(p: PartnerOption): string {
  return p.province ? `${p.name} · ${p.province}` : p.name;
}

function packageLabel(p: PackageOption): string {
  return p.title;
}

// Small debounce hook — no lodash/use-debounce dependency needed for
// a single input like this.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function PackagePickerCombobox({
  category,
  onSelect,
  disabled,
  placeholder,
  selectedLabel,
}: PackagePickerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'partner' | 'package'>('partner');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<PartnerOption | null>(null);

  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier request overwriting results from a
  // newer one (e.g. fast typing outrunning network responses).
  const requestIdRef = useRef(0);

  // Fetch partners whenever the picker is open, on step 'partner', and
  // the debounced query changes (including the initial empty query,
  // so opening the picker shows *something* before typing).
  useEffect(() => {
    if (!open || step !== 'partner') return;

    const requestId = ++requestIdRef.current;
    setPartnersLoading(true);

    const params = new URLSearchParams({ categories: category });
    if (debouncedQuery) params.set('search', debouncedQuery);

    fetch(`/api/admin/partners/pickers?${params.toString()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed to load partners'))))
      .then((result) => {
        if (requestId !== requestIdRef.current) return; // stale response
        const key = category.toLowerCase();
        setPartners(result[key] ?? []);
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        console.error(e);
        setPartners([]);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setPartnersLoading(false);
      });
  }, [open, step, category, debouncedQuery]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function resetAll() {
    setOpen(false);
    setStep('partner');
    setQuery('');
    setSelectedPartner(null);
    setPackages([]);
  }

  async function handlePickPartner(partner: PartnerOption) {
    setSelectedPartner(partner);
    setStep('package');
    setPackagesLoading(true);
    try {
      const params = new URLSearchParams({ categories: category, partner_id: partner.id });
      const res = await fetch(`/api/admin/packages/pickers?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('failed to load packages');
      const result = await res.json();
      const key = category.toLowerCase();
      setPackages(result[key] ?? []);
    } catch (e) {
      console.error(e);
      setPackages([]);
    } finally {
      setPackagesLoading(false);
    }
  }

  function handlePickPackage(pkg: PackageOption) {
    onSelect(pkg.id, packageLabel(pkg));
    resetAll();
  }

  function handleBackToPartner() {
    setStep('partner');
    setSelectedPartner(null);
    setPackages([]);
    setQuery('');
  }

  const partnerListEmpty = useMemo(
    () => step === 'partner' && !partnersLoading && partners.length === 0,
    [step, partnersLoading, partners.length]
  );

  return (
    <div ref={containerRef} className="relative mt-0.5">
      <input
        type="text"
        disabled={disabled}
        value={
          step === 'partner'
            ? open
              ? query
              : (selectedLabel ?? query)
            : selectedPartner
              ? `${partnerLabel(selectedPartner)} — เลือกแพ็กเกจ...`
              : ''
        }
        readOnly={step === 'package'}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') resetAll();
        }}
        className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
      />

      {open && !disabled ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
          {step === 'partner' ? (
            <>
              {partnersLoading ? (
                <div className="px-2 py-1.5 text-xs text-slate-400">กำลังค้นหาร้าน...</div>
              ) : partnerListEmpty ? (
                <div className="px-2 py-1.5 text-xs text-slate-400">ไม่พบร้านที่ตรงกับคำค้น</div>
              ) : (
                partners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePickPartner(p)}
                    className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-primary-light"
                    title={partnerLabel(p)}
                  >
                    {partnerLabel(p)}
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleBackToPartner}
                className="block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
              >
                ← เปลี่ยนร้าน
              </button>
              {packagesLoading ? (
                <div className="px-2 py-1.5 text-xs text-slate-400">กำลังโหลดแพ็กเกจ...</div>
              ) : packages.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-slate-400">ร้านนี้ยังไม่มีแพ็กเกจที่เผยแพร่</div>
              ) : (
                packages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePickPackage(p)}
                    className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-primary-light"
                    title={packageLabel(p)}
                  >
                    {packageLabel(p)}
                  </button>
                ))
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
