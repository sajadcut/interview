/** Persian display formatting. Do not use for API values, IDs or editable form state. */
const digits = "۰۱۲۳۴۵۶۷۸۹";
const formatter = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
export function formatFaDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => digits[Number(digit)] ?? digit);
}
export function formatFaNumber(value: number): string {
  return Number.isFinite(value) ? formatter.format(value) : "—";
}
/** API percentages already range from 0 to 100. */
export function formatFaPercent(value: number): string {
  return `${formatFaNumber(value)}٪`;
}
