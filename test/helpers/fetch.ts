/** A fetch stub that replays queued responses and records what was sent. */
export function stubFetch(queue: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = [];

  const fetchImpl = (async (input: string | Request | URL, init?: RequestInit) => {
    const request = new Request(input as string | URL, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: init?.body === undefined ? null : String(init.body),
    });
    const next = queue.shift();
    if (next === undefined) throw new Error('stubFetch: no queued response left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;

  return { fetch: fetchImpl, calls };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}
