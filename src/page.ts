/**
 * One page of a cursor-paginated list. Exhausted when nextCursor is empty.
 * Iterating the page with `for await` walks every remaining page, fetching
 * each one lazily.
 */
export class Page<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor: string,
    private readonly fetchPage: (cursor: string) => Promise<Page<T>>,
  ) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    let page: Page<T> = this;
    for (;;) {
      for (const item of page.items) yield item;
      if (page.nextCursor === '') return;
      page = await page.fetchPage(page.nextCursor);
    }
  }
}
