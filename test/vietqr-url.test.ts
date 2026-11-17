import { describe, expect, it } from 'vitest';
import { toConnection, toPaymentIntent } from '../src/resources/index.js';
import { vietqrUrl } from '../scripts/lib/vietqr-url.mjs';

// Ruling CD-13: no seeded dev-stack connection has both a bin and an account number,
// so the smoke's VietQR render path is proven here on fixture connections.
const BASE_URL = 'http://localhost:59080';
const intent = toPaymentIntent({
  id: 'bpi_1',
  code: 'NODE1794925093',
  expected_amount_vnd: 50000,
  status: 'pending',
});

describe('vietqrUrl', () => {
  it('builds the raw VietQR image URL for a connection with bin and account_number', () => {
    const conn = toConnection({
      id: 'bcn_ocb',
      bank_code: 'OCB',
      status: 'active',
      bin: '970448',
      account_number: '0123456789',
    });
    expect(vietqrUrl(BASE_URL, conn, intent)).toBe(
      'http://localhost:59080/qr/vietqr.png?bin=970448&account=0123456789&amount=50000&memo=NODE1794925093',
    );
  });

  it('hides the QR when the connection has no bin', () => {
    const conn = toConnection({ id: 'bcn_mb', bank_code: 'MB', account_number: '0123456789' });
    expect(vietqrUrl(BASE_URL, conn, intent)).toBeNull();
  });

  it('hides the QR when the connection has no account_number', () => {
    const conn = toConnection({ id: 'bcn_ocb', bank_code: 'OCB', bin: '970448' });
    expect(vietqrUrl(BASE_URL, conn, intent)).toBeNull();
  });
});
