import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  BankApiError,
  ConnectionError,
  MalformedResponseError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ValidationError,
  errorFromResponse,
} from '../src/errors.js';

const problem = { title: 'Bad Request', detail: 'limit must be positive' };

describe('errorFromResponse', () => {
  it.each([
    [400, ValidationError],
    [422, ValidationError],
    [401, AuthenticationError],
    [403, PermissionError],
    [404, NotFoundError],
    [429, RateLimitError],
    [418, BankApiError],
    [500, BankApiError],
  ])('maps status %i to the right class', (status, expected) => {
    const err = errorFromResponse(status, problem, new Headers());
    expect(err).toBeInstanceOf(expected);
    expect(err.status).toBe(status);
  });

  it('keeps title, detail and the raw problem body', () => {
    const err = errorFromResponse(400, problem, new Headers());
    expect(err.title).toBe('Bad Request');
    expect(err.detail).toBe('limit must be positive');
    expect(err.body).toEqual(problem);
    expect(err.message).toBe('[400] Bad Request: limit must be positive');
  });

  it('falls back when the body is not problem+json', () => {
    const err = errorFromResponse(500, {}, new Headers());
    expect(err.title).toBe('API error');
    expect(err.detail).toBe('');
  });

  it('reads a numeric Retry-After header on 429', () => {
    const err = errorFromResponse(429, problem, new Headers({ 'retry-after': '17' }));
    expect((err as RateLimitError).retryAfter).toBe(17);
  });

  it('leaves retryAfter null when Retry-After is absent or not numeric', () => {
    expect(
      (errorFromResponse(429, problem, new Headers()) as RateLimitError).retryAfter,
    ).toBeNull();
    const httpDate = new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    expect((errorFromResponse(429, problem, httpDate) as RateLimitError).retryAfter).toBeNull();
  });
});

describe('error shapes', () => {
  it('names each subclass after itself so logs are readable', () => {
    expect(errorFromResponse(404, problem, new Headers()).name).toBe('NotFoundError');
  });

  it('ConnectionError carries status 0 and the cause', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new ConnectionError('connect failed', cause);
    expect(err.status).toBe(0);
    expect(err.title).toBe('Connection error');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(BankApiError);
  });

  it('MalformedResponseError keeps the 2xx status it was given', () => {
    const err = new MalformedResponseError(200, 'response body is not a JSON object');
    expect(err.status).toBe(200);
    expect(err.title).toBe('Malformed response');
  });
});
