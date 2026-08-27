/** Reads the `{items, next_cursor}` envelope every cursor list uses. */

export function items(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.items)
    ? data.items.map((item) =>
        typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {},
      )
    : [];
}

export function nextCursor(data: Record<string, unknown>): string {
  return typeof data.next_cursor === 'string' ? data.next_cursor : '';
}
