// VietQR render path of scripts/e2e-smoke.mjs, unit-tested in test/vietqr-url.test.ts.

/**
 * URL of the raw VietQR image route (no /v2 prefix, no key) for an intent paid to a
 * connection, or null when the connection has no verified bin or no account number:
 * the contract says a client then hides the QR.
 */
export function vietqrUrl(baseUrl, connection, intent) {
  if (connection.bin === null || connection.accountNumber === null) return null;
  const query = new URLSearchParams({
    bin: connection.bin,
    account: connection.accountNumber,
    amount: String(intent.expectedAmountVnd),
    memo: intent.code,
  });
  return `${baseUrl}/qr/vietqr.png?${query}`;
}
