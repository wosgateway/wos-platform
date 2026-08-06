'use client';

// Custom 24-hour time picker built from 2 <select> elements (ชม./นาที).
//
// The underlying value was always 24h "HH:MM" even with <input type="time">
// — only the AM/PM display was coming from the browser's own widget. This
// component makes the 24h display explicit and consistent across every
// device, and keeps the same "HH:MM" value/onChange contract so nothing
// downstream needs to change.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface TimePickerProps {
  value: string; // HH:MM (24h), or '' when not fully chosen yet
  onChange: (value: string) => void;
  minuteStep?: number; // default 5
  className?: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function parseHM(value: string): { h: number | ''; min: number | '' } {
  if (!value) return { h: '', min: '' };
  const [h, min] = value.split(':');
  return { h: Number(h) || 0, min: Number(min) || 0 };
}

export function TimePicker({ value, onChange, minuteStep = 5, className }: TimePickerProps) {
  const t = useTranslations('booking');
  const parsedInitial = parseHM(value);
  const [h, setH] = useState<number | ''>(parsedInitial.h);
  const [min, setMin] = useState<number | ''>(parsedInitial.min);

  useEffect(() => {
    const p = parseHM(value);
    setH(p.h);
    setMin(p.min);
  }, [value]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep);

  function commit(nh: number | '', nmin: number | '') {
    if (nh === '' || nmin === '') {
      onChange('');
      return;
    }
    onChange(`${pad(nh)}:${pad(nmin)}`);
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ''}`}>
      <select
        className="form-input"
        aria-label={t('fields.hour')}
        value={h}
        onChange={(e) => {
          const nh = e.target.value ? Number(e.target.value) : '';
          setH(nh);
          commit(nh, min);
        }}
      >
        <option value="">{t('fields.hour')}</option>
        {hours.map((n) => (
          <option key={n} value={n}>
            {pad(n)}
          </option>
        ))}
      </select>
      <select
        className="form-input"
        aria-label={t('fields.minute')}
        value={min}
        onChange={(e) => {
          const nmin = e.target.value ? Number(e.target.value) : '';
          setMin(nmin);
          commit(h, nmin);
        }}
      >
        <option value="">{t('fields.minute')}</option>
        {minutes.map((n) => (
          <option key={n} value={n}>
            {pad(n)}
          </option>
        ))}
      </select>
    </div>
  );
}
