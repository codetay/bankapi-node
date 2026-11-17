#!/usr/bin/env node
// F4 + F5 (a) smoke of the built package (dist/) against a local BankAPI dev
// stack: one webhook endpoint pointed at the stubs relay, a receiver in this
// process, a payment intent, a signed bank credit, the delivery, the match and
// a redelivered credit. Never published (not in package.json `files`).
//
// Required (absolute paths): DEV_STACK_DIR, DEV_IMAGE, DEV_SECRETS_HOST.
// Optional: E2E_ENV_FILE ($DEV_SECRETS_HOST/e2e.env), DEV_DOCKER_CONTEXT
// (orbstack), SMOKE_BIND (127.0.0.1), SMOKE_PORT (59601), SMOKE_AMOUNT_VND
// (50000), SMOKE_WAIT_SECONDS (90), SMOKE_QUIET_SECONDS (15), SMOKE_BASE_URL.
// From the env file it reads only BANKAPI_BASE_URL, BANKAPI_KEY and
// E2E_CONNECTION_ID. It prints no secret: not the key, not the endpoint secret.
//
// Exit 0 only when every step prints PASS; 1 on any FAIL (each FAIL but the QR one
// stops the run); 2 on missing input.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const DESCRIPTION = 'e2e smoke: node';
const RELAY_URL = 'https://relay.stub.test:8443/node/hooks/bankapi';
const EVENT_TYPES = ['banking.credit', 'banking.payment_matched'];

class StepFailure extends Error {}

function fail(id, reason) {
  console.log(`FAIL ${id} ${reason}`);
  throw new StepFailure(id);
}

let softFailures = 0;

function softFail(id, reason) {
  console.log(`FAIL ${id} ${reason}`);
  softFailures += 1;
}

const pass = (id, detail = '') => console.log(`PASS ${id}${detail === '' ? '' : ` ${detail}`}`);

function requiredEnv() {
  const missing = ['DEV_STACK_DIR', 'DEV_IMAGE', 'DEV_SECRETS_HOST'].filter(
    (name) => (process.env[name] ?? '') === '',
  );
  const notAbsolute = ['DEV_STACK_DIR', 'DEV_SECRETS_HOST'].filter(
    (name) => !missing.includes(name) && !isAbsolute(process.env[name]),
  );
  if (missing.length > 0 || notAbsolute.length > 0) {
    for (const name of missing) console.error(`missing ${name}`);
    for (const name of notAbsolute) console.error(`${name} must be an absolute path`);
    process.exit(2);
  }
}

function positiveInt(name, fallback) {
  const raw = process.env[name] ?? '';
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(2);
  }
  return value;
}

// KEY=VALUE lines; only the three named keys are kept, so nothing else in the file is held.
function readEnvFile(path) {
  const wanted = new Set(['BANKAPI_BASE_URL', 'BANKAPI_KEY', 'E2E_CONNECTION_ID']);
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`cannot read E2E_ENV_FILE ${path} (${err.code ?? 'error'})`);
    process.exit(2);
  }
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || !wanted.has(match[1])) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const missing = [...wanted].filter((name) => (out[name] ?? '') === '');
  if (missing.length > 0) {
    for (const name of missing) console.error(`missing ${name} in E2E_ENV_FILE`);
    process.exit(2);
  }
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(id, seconds, what, probe) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) fail(id, `timed out after ${seconds} s waiting for ${what}`);
    await sleep(1000);
  }
}

function problemOf(err) {
  return `${err?.name ?? 'Error'} status=${err?.status ?? '?'} code=${err?.code ?? '-'}`;
}

async function main() {
  requiredEnv();
  const stackDir = process.env.DEV_STACK_DIR;
  const envFile = process.env.E2E_ENV_FILE || join(process.env.DEV_SECRETS_HOST, 'e2e.env');
  const limits = {
    DEV_DOCKER_CONTEXT: process.env.DEV_DOCKER_CONTEXT || 'orbstack',
    SMOKE_BIND: process.env.SMOKE_BIND || '127.0.0.1',
    SMOKE_PORT: positiveInt('SMOKE_PORT', 59601),
    SMOKE_AMOUNT_VND: positiveInt('SMOKE_AMOUNT_VND', 50000),
    SMOKE_WAIT_SECONDS: positiveInt('SMOKE_WAIT_SECONDS', 90),
    SMOKE_QUIET_SECONDS: positiveInt('SMOKE_QUIET_SECONDS', 15),
    SMOKE_BASE_URL: process.env.SMOKE_BASE_URL || '(unset)',
  };
  const env = readEnvFile(envFile);
  const baseUrl = (process.env.SMOKE_BASE_URL || env.BANKAPI_BASE_URL).replace(/\/+$/, '');
  const connectionId = env.E2E_CONNECTION_ID;
  const amount = limits.SMOKE_AMOUNT_VND;
  const wait = limits.SMOKE_WAIT_SECONDS;
  console.log(`limits ${JSON.stringify(limits)} base_url=${baseUrl}`);

  // Loaded only after the input checks, so a missing variable exits 2 without a build.
  const { BankApi, isWebhookEvent } = await import('../dist/index.js');
  const { bankapiWebhook } = await import('../dist/express.js');
  const client = new BankApi({ apiKey: env.BANKAPI_KEY, baseUrl });

  // O-20: an API key on the account host reaches an org operation.
  let conn;
  try {
    conn = await client.banking.connection(connectionId);
  } catch (err) {
    fail('O-20', problemOf(err));
  }
  if (conn.status !== 'active') fail('O-20', `connection ${conn.id} status=${conn.status}`);
  pass('O-20', `connection ${conn.id} bank=${conn.bankCode} status=active`);

  const named = async () => {
    const found = [];
    for await (const ep of await client.webhookEndpoints.all()) {
      if (ep.description === DESCRIPTION) found.push(ep);
    }
    return found;
  };

  // Endpoint: the url reads back masked, so it is found by description.
  let endpointId;
  let secret;
  const existing = (await named())[0];
  if (existing === undefined) {
    const created = await client.webhookEndpoints.create(RELAY_URL, EVENT_TYPES, DESCRIPTION);
    endpointId = created.id;
    secret = created.secret;
    console.log(`endpoint ${endpointId} created`);
  } else {
    endpointId = existing.id;
    const types = existing.eventTypes;
    if (!Array.isArray(types) || !EVENT_TYPES.every((t) => types.includes(t))) {
      fail('endpoint', `event_types of ${endpointId} lack ${EVENT_TYPES.join(' or ')}`);
    }
    let enabled = '';
    // Every other credit of the org is delivered here too and fails while no smoke
    // runs, so KIT-RS may have switched the endpoint off; PATCH active clears that.
    if (!existing.active || existing.autoDisabledAt !== null) {
      await client.webhookEndpoints.enable(endpointId);
      enabled = ' enabled';
    }
    secret = (await client.webhookEndpoints.rotateSecret(endpointId)).secret;
    console.log(`endpoint ${endpointId} rotated${enabled}`);
  }
  const count = (await named()).length;
  if (count !== 1) fail('endpoint', `${count} endpoints named '${DESCRIPTION}', expected 1`);
  pass('endpoint', `${endpointId} count=1`);

  // Receiver: every request goes through the SDK middleware.
  const received = [];
  // transaction_id -> payments the receiver recorded; a count above 1 is a double booking.
  const payments = new Map();
  let rejected = 0;
  const middleware = bankapiWebhook({ secret });
  const server = createServer((req, res) => {
    res.on('finish', () => {
      if (res.statusCode === 400) rejected += 1;
    });
    middleware(req, res, (err) => {
      if (err) {
        res.statusCode = 500;
        res.end();
        return;
      }
      const event = req.bankapiEvent;
      received.push({
        type: event.type,
        id: event.id,
        webhookId: event.webhookId,
        api_version: event.api_version,
        data: event.data,
      });
      if (isWebhookEvent(event, 'banking.credit')) {
        const tx = event.data.transaction_id;
        payments.set(tx, (payments.get(tx) ?? 0) + 1);
      }
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise((ready, refuse) => {
    server.once('error', refuse);
    server.listen(limits.SMOKE_PORT, limits.SMOKE_BIND, ready);
  });

  try {
    // Intent
    const code = `NODE${Math.floor(Date.now() / 1000)}`;
    const intent = await client.banking.createPaymentIntent({ code, expectedAmountVnd: amount });
    if (intent.status !== 'pending') fail('intent', `${intent.id} status=${intent.status}`);
    pass('intent', `${intent.id} code=${code} status=pending`);

    // QR: raw route, no /v2 prefix, no key. No later step reads it, so a FAIL here
    // is counted and the run still proves F4 and F5 (a); the exit code reports it.
    if (conn.bin === null || conn.accountNumber === null) {
      softFail('F5a', 'qr connection has no bin/account_number');
    } else {
      const qr = await fetch(
        `${baseUrl}/qr/vietqr.png?${new URLSearchParams({
          bin: conn.bin,
          account: conn.accountNumber,
          amount: String(amount),
          memo: code,
        })}`,
      );
      const png = Buffer.from(await qr.arrayBuffer());
      const type = qr.headers.get('content-type') ?? '';
      if (qr.status !== 200 || !type.startsWith('image/png')) {
        softFail('F5a', `qr status=${qr.status} content-type=${type} bytes=${png.length}`);
      } else {
        pass('F5a qr', `status=200 bytes=${png.length}`);
      }
    }

    // Credit through the stubs container, without a shell.
    const ref = `NODESMOKE${Math.floor(Date.now() / 1000)}`;
    const credit = async () => {
      let stdout;
      try {
        ({ stdout } = await promisify(execFile)(
          'docker',
          [
            '--context',
            limits.DEV_DOCKER_CONTEXT,
            'compose',
            '-p',
            'bankapirs',
            '--project-directory',
            stackDir,
            '-f',
            `${stackDir}/compose.yml`,
            'exec',
            '-T',
            'stubs',
            'bankapi-dev',
            '--config',
            '/etc/bankapi-dev/bankapi.dev.toml',
            'e2e',
            'credit',
            '--connection',
            connectionId,
            '--amount-vnd',
            String(amount),
            '--memo',
            code,
            '--ref',
            ref,
          ],
          { timeout: (wait + 60) * 1000, maxBuffer: 1024 * 1024 },
        ));
      } catch (err) {
        const last =
          String(err.stderr ?? '')
            .trim()
            .split('\n')
            .pop() ?? '';
        fail('credit', `e2e credit exit=${err.code ?? '?'} ${last.slice(0, 300)}`);
      }
      const tx = /^transaction_id=(btx_\S+)$/m.exec(stdout)?.[1];
      const status = /^callback_status=(\S+)$/m.exec(stdout)?.[1] ?? '?';
      if (tx === undefined) fail('credit', `no transaction_id (callback_status=${status})`);
      return { tx, status };
    };
    const first = await credit();
    const tx = first.tx;
    pass('credit', `ref=${ref} callback_status=${first.status} transaction_id=${tx}`);

    // F4: the receiver gets the signed banking.credit.
    const creditOf = (e) => e.type === 'banking.credit' && e.data?.transaction_id === tx;
    const event = await waitFor('F4 receiver', wait, `banking.credit of ${tx}`, () =>
      received.find(creditOf),
    );
    if (event.api_version !== '2' || event.data.amount_vnd !== amount || !tx.startsWith('btx_')) {
      fail(
        'F4 receiver',
        `api_version=${event.api_version} amount_vnd=${event.data.amount_vnd} transaction_id=${tx}`,
      );
    }
    pass('F4 receiver', `type=banking.credit api_version=2 amount_vnd=${amount} ${tx}`);

    // F4: the delivery log shows it succeeded.
    const delivery = await waitFor(
      'F4 delivery',
      wait,
      `a succeeded delivery of ${tx}`,
      async () => {
        for await (const d of await client.webhookEndpoints.deliveries(endpointId)) {
          if (
            d.transactionId === tx &&
            d.eventType === 'banking.credit' &&
            d.status === 'succeeded'
          ) {
            return d;
          }
        }
        return undefined;
      },
    );
    pass('F4 delivery', `${delivery.deliveryId} attempt=${delivery.attempt} status=succeeded`);

    // F5 (a): the intent is matched and the receiver gets banking.payment_matched.
    await waitFor('F5a', wait, `intent ${intent.id} matched to ${tx}`, async () => {
      const current = await client.banking.paymentIntent(intent.id);
      const matched =
        received.find(
          (e) =>
            e.type === 'banking.payment_matched' &&
            e.data?.transaction_id === tx &&
            e.data?.intent_id === intent.id,
        ) !== undefined;
      return current.status === 'matched' && current.matchedTransactionId === tx && matched;
    });
    pass('F5a', `${intent.id} status=matched transaction=${tx} banking.payment_matched received`);

    // F4 dedupe: the bank redelivers the same callback; the API records it once.
    const again = await credit();
    if (again.tx !== tx) fail('F4 dedupe', `redelivery recorded ${again.tx}, expected ${tx}`);
    await sleep(limits.SMOKE_QUIET_SECONDS * 1000);
    const ids = new Set(received.filter(creditOf).map((e) => e.id));
    const recorded = payments.get(tx) ?? 0;
    if (ids.size !== 1 || recorded !== 1) {
      fail('F4 dedupe', `${ids.size} banking.credit event ids, ${recorded} payments for ${tx}`);
    }
    pass('F4 dedupe', `same transaction ${tx}, 1 banking.credit event id, 1 payment`);
  } finally {
    server.closeAllConnections();
    await new Promise((closed) => server.close(closed));
    console.log(`receiver closed: ${received.length} verified, ${rejected} rejected`);
  }
}

main().then(
  () => process.exit(softFailures === 0 ? 0 : 1),
  (err) => {
    if (!(err instanceof StepFailure)) console.log(`FAIL smoke ${problemOf(err)} ${err?.message}`);
    process.exit(1);
  },
);
