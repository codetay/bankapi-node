import type { Connection, PaymentIntent } from '../../src/resources/index.js';

export function vietqrUrl(
  baseUrl: string,
  connection: Pick<Connection, 'bin' | 'accountNumber'>,
  intent: Pick<PaymentIntent, 'expectedAmountVnd' | 'code'>,
): string | null;
