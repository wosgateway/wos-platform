// Ported from window.formatTHB in the old js/main.js.
export function formatTHB(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '-';
  return Number(amount).toLocaleString('th-TH') + ' บาท';
}
