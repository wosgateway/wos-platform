'use client';

// Agoda-style popup calendar date picker: a button showing dd/mm/yyyy that
// opens a month grid you click a day on, with ‹ › to change months.
//
// Same value/onChange/min contract as the dropdown version it replaces
// (value is always a plain YYYY-MM-DD string, or '' when nothing chosen
// yet) — so BookingForm.tsx and the payload sent to Supabase don't need
// any changes.

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

interface DatePickerProps {
  value: string; // YYYY-MM-DD, or '' when nothing chosen yet
  onChange: (value: string) => void;
  min?: string; // YYYY-MM-DD floor (e.g. today, or another field's date)
  yearsAhead?: number; // how many years past min the calendar can navigate to. Default 2.
  className?: string;
}

// Hardcoded here (rather than pulled from the locale JSON) since these are
// only ever rendered inside this calendar grid, not reused as standalone
// UI copy elsewhere.
const MONTHS: Record<string, string[]> = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  lo: ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const WEEKDAYS: Record<string, string[]> = {
  th: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
  lo: ['ອາ', 'ຈ', 'ອຄ', 'ພ', 'ພຫ', 'ສກ', 'ສ'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function parseISO(value: string): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function toISO(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function DatePicker({ value, onChange, min, yearsAhead = 2, className }: DatePickerProps) {
  const locale = useLocale();
  const lang = MONTHS[locale] ? locale : 'en';
  const months = MONTHS[lang];
  const weekdays = WEEKDAYS[lang];

  const todayIso = new Date().toISOString().slice(0, 10);
  const selected = parseISO(value);
  const minParts = parseISO(min || '') ?? parseISO(todayIso)!;
  const minIso = toISO(minParts.y, minParts.m, minParts.d);

  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(selected?.y ?? minParts.y);
  const [viewM, setViewM] = useState(selected?.m ?? minParts.m);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Keep the visible month in sync if the value changes from outside this
  // component (e.g. hotel checkout getting reset when checkin moves past it).
  useEffect(() => {
    const p = parseISO(value);
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
    }
  }, [value]);

  const maxYear = minParts.y + yearsAhead;
  const atMinMonth = viewY === minParts.y && viewM === minParts.m;
  const atMaxMonth = viewY === maxYear && viewM === 12;

  function goPrevMonth() {
    if (atMinMonth) return;
    if (viewM === 1) {
      setViewY((y) => y - 1);
      setViewM(12);
    } else {
      setViewM((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (atMaxMonth) return;
    if (viewM === 12) {
      setViewY((y) => y + 1);
      setViewM(1);
    } else {
      setViewM((m) => m + 1);
    }
  }

  const firstWeekday = new Date(viewY, viewM - 1, 1).getDay(); // 0 = Sunday
  const totalDays = daysInMonth(viewY, viewM);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  function pick(day: number) {
    const iso = toISO(viewY, viewM, day);
    if (iso < minIso) return;
    onChange(iso);
    setOpen(false);
  }

  const displayValue = selected ? `${pad(selected.d)}/${pad(selected.m)}/${selected.y}` : '';

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="form-input w-full flex items-center justify-between text-left"
      >
        <span className={displayValue ? '' : 'text-slate-400'}>
          {displayValue || 'DD/MM/YYYY'}
        </span>
        <span aria-hidden className="ml-2 text-slate-400">📅</span>
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              disabled={atMinMonth}
              className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-slate-800">
              {months[viewM - 1]} {viewY}
            </span>
            <button
              type="button"
              onClick={goNextMonth}
              disabled={atMaxMonth}
              className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
            {weekdays.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const iso = toISO(viewY, viewM, day);
              const isDisabled = iso < minIso;
              const isSelected = !!selected && iso === toISO(selected.y, selected.m, selected.d);
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => pick(day)}
                  className={`h-8 rounded-lg text-sm transition-colors ${
                    isSelected
                      ? 'bg-primary text-white font-medium'
                      : isDisabled
                        ? 'cursor-not-allowed text-slate-300'
                        : isToday
                          ? 'border border-primary text-primary-dark hover:bg-primary-light'
                          : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
