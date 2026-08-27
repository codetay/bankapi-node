/**
 * Lenient coercion helpers. Every mapper reads only the fields it knows and
 * ignores the rest, so a server that adds a field never breaks a consumer.
 */

export function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function optStr(value: unknown): string | null {
  return value === undefined || value === null ? null : str(value);
}

export function optNum(value: unknown): number | null {
  return value === undefined || value === null ? null : num(value);
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function recordList(value: unknown): Record<string, unknown>[] {
  return list(value).map(record);
}

export function strList(value: unknown): string[] {
  return list(value).map(str);
}

export function numRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record(value))) out[key] = num(raw);
  return out;
}
