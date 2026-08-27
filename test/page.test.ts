import { describe, expect, it, vi } from 'vitest';
import { Page } from '../src/page.js';

describe('Page', () => {
  it('exposes the items and cursor of a single page', () => {
    let page: Page<string>;
    page = new Page(['a', 'b'], 'cur_2', async () => page);
    expect(page.items).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('cur_2');
  });

  it('iterates one page and stops when the cursor is empty', async () => {
    const page = new Page(['a', 'b'], '', async () => {
      throw new Error('must not fetch');
    });
    const seen: string[] = [];
    for await (const item of page) seen.push(item);
    expect(seen).toEqual(['a', 'b']);
  });

  it('follows the cursor across pages', async () => {
    const last = new Page(['c'], '', async () => {
      throw new Error('must not fetch');
    });
    const fetchPage = vi.fn(async () => last);
    const first = new Page(['a', 'b'], 'cur_2', fetchPage);
    const seen: string[] = [];
    for await (const item of first) seen.push(item);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenCalledWith('cur_2');
  });

  it('fetches lazily — nothing is requested until iteration starts', () => {
    const fetchPage = vi.fn(async () => new Page<string>([], '', fetchPage));
    new Page(['a'], 'cur_2', fetchPage);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
