#!/usr/bin/env node
/**
 * Smoke test for the Legion partner verification webhook.
 *
 *   LEGION_WEBHOOK_SECRET=... node scripts/legion-verify-smoke.mjs \
 *     [--url http://localhost:3000/api/legion/verify] \
 *     [--wallet 0x...] [--key tower_swap_completed] [--network arc-mainnet]
 *
 * Sends the exact payload shape Republic uses and checks the response against
 * the documented contract (https://republic.legion.cc/docs/partner-verification).
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

const url = args.url || "http://localhost:3000/api/legion/verify";
const secret = process.env.LEGION_WEBHOOK_SECRET;
const wallet = args.wallet || "0x1111111111111111111111111111111111111111";
const key = args.key || "tower_swap_completed";
const network = args.network || "arc-mainnet";

if (!secret) {
  console.error("Set LEGION_WEBHOOK_SECRET to the registered partner token.");
  process.exit(2);
}

const payload = (overrides = {}) => ({
  requestId: crypto.randomUUID(),
  campaignRef: "tower-smoke",
  action: { key, version: "1.0.0" },
  subject: { kind: "wallet", identifier: wallet, network },
  qualification: {},
  ...overrides,
});

async function call(label, { token = secret, body = payload(), expect }) {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Request-Id": body.requestId ?? "smoke",
      "User-Agent": "Republic-Partner-Verification/1.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  const ms = Date.now() - started;
  const ok = expect(res.status, parsed) && ms < 8000;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  -> ${res.status} ${JSON.stringify(parsed)} (${ms}ms)`);
  return ok;
}

const isContractBody = (status, body) => {
  if (status === 200 && body?.status === "completed")
    return body.completed === true && !!body.assertionId && !isNaN(Date.parse(body.occurredAt));
  if (status === 200 && body?.status === "incomplete") return body.completed === false;
  if (status === 202) return body?.status === "pending" && body.retryAfterSeconds >= 1;
  return false;
};

const results = [];
results.push(await call(`real payload (${key}, ${wallet})`, { expect: isContractBody }));
results.push(await call("bad token -> 401", { token: "wrong-token", expect: (s) => s === 401 }));
results.push(await call("no token -> 401", { token: "", expect: (s) => s === 401 }));
results.push(await call("legacy 'address' field -> 400", {
  body: payload({ subject: { kind: "wallet", address: wallet, network } }),
  expect: (s) => s === 400,
}));
results.push(await call("unknown action key -> 400", {
  body: payload({ action: { key: "definitely_not_a_tower_action", version: "1.0.0" } }),
  expect: (s) => s === 400,
}));

if (results.includes(false)) {
  console.error("\nSome checks failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
