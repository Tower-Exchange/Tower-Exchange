# Legion (The Republic) partner verification

Republic quests can require on-chain/in-product actions on Tower. When a user taps
**Verify** on Republic, Republic POSTs `https://tower.exchange/api/legion/verify`
and waits up to 8 seconds. Tower answers whether that wallet really did the
action. Contract: <https://republic.legion.cc/docs/partner-verification> and
<https://republic.legion.cc/docs-assets/openapi.public.json>.

Route: `app/api/legion/verify/route.ts`
Chain proof: `lib/server/txVerification.ts`
Smoke test: `scripts/legion-verify-smoke.mjs`

## How the endpoint answers

| Situation | HTTP | Body |
| --- | --- | --- |
| Wallet qualified | 200 | `{status:"completed", completed:true, assertionId, occurredAt}` |
| Not qualified yet | 200 | `{status:"incomplete", completed:false}` |
| Tx not indexed yet / budget nearly spent | 202 | `{status:"pending", retryAfterSeconds}` |
| Wrong/missing Bearer token | 401 | `{error}` |
| Malformed payload / unknown `action.key` | 400 | `{error}` |
| Secret not configured, DB or RPC down | 503 | `{error}` |

Rules Republic enforces that we follow:
- Wallet is `subject.identifier` (checksummed EVM address), `subject.kind` is always `wallet`.
- `assertionId` must be **stable** for the same qualifying event (we use the tx hash,
  or `tower_<action>_<wallet>` for one-time state). Republic pays a quest once per `assertionId`.
- Never return `{verified:true}` or `completed` without `assertionId` + `occurredAt`.
- No redirects: register the exact production URL (`https://tower.exchange/...`, port 443).
- Timeout, 5xx, pending, malformed bodies never grant credit.

## Why swaps/bridges are verified on-chain

`activities` rows are written by the browser through `POST /api/user/activities`,
so type, amount and hash are self-reported. The webhook therefore counts a
swap/bridge only when the transaction hash is proven:

1. receipt exists on the right chain and `status === success`
2. **Swaps:** `tx.from` equals the wallet being verified (a hash copied from someone else fails),
   and, if `LEGION_TRUSTED_CONTRACTS` is set, `tx.to` is one of those contracts.
3. **Bridges:** proven from either side, because the hash Tower logs for a bridge is usually the
   *destination mint*, which Circle's relayer sends (not the user):
   - source side: the user's burn transaction was sent by the wallet, or
   - destination side: the transaction contains a USDC/EURC `Transfer` from the zero address
     (a real CCTP mint) to the wallet, emitted by Circle's token contract on that chain.
4. the activity's network matches the campaign mode (`subject.network` containing
   `test`/`sepolia`/`fuji`/`amoy`/`devnet` = testnet, otherwise mainnet). Testnet
   activity never counts for a mainnet campaign, and vice versa.

Rows with status `Pending` count when proven on-chain. A bridge logged while still settling is
never updated to `Successful` afterwards, so the on-chain proof, not the status column, decides.
`Failed` rows never count.

Results are cached in `activities.onchain_status` so each hash is looked up once.
Bridge rejections cached before 2026-10-11 came from an older, stricter rule and are re-checked once
(see `BRIDGE_RULES_EFFECTIVE_AT` in the route).
`POST /api/user/activities` also uses the server clock for `timestamp` and ignores
duplicate (wallet, type, tx hash) logs.

**Apply the migration first:** `supabase/migrations/20261007_add_onchain_verification_to_activities.sql`.

### Known limits (decide per quest)
- **Volume uses the logged `amount_usd`.** The tx is proven and must come from the
  wallet (and target a Tower contract when `LEGION_TRUSTED_CONTRACTS` is set), but the
  USD figure itself is not re-derived on-chain. Set `LEGION_TRUSTED_CONTRACTS` before
  running volume quests, and prefer low thresholds / `minUsd` for first campaigns.
- **Solana bridges:** a Solana -> EVM bridge is proven by its mint on the EVM side and an EVM -> Solana
  bridge by its burn on the EVM side. Solana -> Solana cannot be proven and is ignored.
- **Bridges made outside Tower:** a real Circle mint to the wallet proves a bridge happened, not that it
  happened through Tower. A user could log their own genuine bridge from another app.
- **Smart-account / relayer wallets:** a tx whose `from` is a bundler, not the user
  wallet, is rejected. Recurring-order *executions* by the relayer are not swaps by the user.
- **`tower_ai_chat`** reads `ai_db`, which the client can write. Do not attach real rewards to it.

## Verification IDs (`action.key`)

Set these as `verificationId` on the quest action. Keys are matched exactly.

| `verificationId` | Qualifies when |
| --- | --- |
| `tower_swap_completed` (alias `tower_swap`) | one proven swap, or the `minCount` / `minVolumeUsd` you set (swaps only) |
| `tower_bridge_completed` (alias `tower_bridge`) | one proven bridge (EVM source), or the thresholds you set (bridges only) |
| `tower_any_activity` | one proven swap or bridge, or the thresholds you set (swaps + bridges together) |
| `tower_volume_<usd>` e.g. `tower_volume_100` | proven swap+bridge volume reaches the number (each tx hash counted once) |
| `tower_volume` | same, threshold from `qualification.minVolumeUsd` (required for this ID) |
| `tower_squire_badge_claimed` (alias `tower_squire_badge`) | Squire badge claimed **and** one proven on-chain event |
| `tower_recurring_order` | recurring order whose authorization tx is proven on-chain |
| `tower_ai_chat` | at least one AI chat saved (low trust) |

Optional `qualification` JSON for swap, bridge, any-activity and volume actions:
- `minCount`: minimum number of proven transactions (positive integer, max 1000)
- `minVolumeUsd`: minimum cumulative USD of proven transactions (positive number)
- `minUsd`: minimum USD size of **each** counted transaction (smaller ones are ignored)
- `since`: ISO timestamp, e.g. `"2026-10-12T00:00:00Z"`; events logged before it are ignored. **Set this to the
  campaign start on every swap/bridge quest** so old activity (and bridges made before the campaign) can't count.
  It compares against the time Tower logged the activity (server clock). A value that is not a valid date, and an
  invalid `minUsd`, return HTTP 400 instead of being silently ignored.

If both `minCount` and `minVolumeUsd` are set, **both** must be met. Invalid values (zero, negative,
non-numeric, a fractional `minCount`) return HTTP 400 so a bad quest setup is obvious.
Each transaction hash counts once even if it was logged twice.

Examples:
- 5 swaps: `{"minCount": 5}` on `tower_swap_completed`
- $250 of swap volume: `{"minVolumeUsd": 250}` on `tower_swap_completed`
- 3 swaps of at least $10 each: `{"minCount": 3, "minUsd": 10}`
- 2 bridges worth $100 in total: `{"minCount": 2, "minVolumeUsd": 100}` on `tower_bridge_completed`

First-time checks of many transactions can return `pending` (HTTP 202) while Tower confirms each one on-chain
(up to 24 new lookups per check). The user taps Verify again; results are cached, so the next check is faster.
The `assertionId` for a threshold requirement is `tower_<swap|bridge|activity|volume>_n<count>_v<usd>_<wallet>`
and does not change between checks. Bump the action `version` if you change a quest's thresholds.

Example quest action (draft quest, partner token):

```bash
curl -X PUT 'https://republic.legion.cc/api/partner/quests/QUEST_ID/actions/swap-once' \
  -H "Authorization: Bearer $PARTNER_TOKEN" -H 'Content-Type: application/json' \
  --data '{
    "label": "Complete a swap on Tower",
    "verificationId": "tower_swap_completed",
    "version": "1.0.0",
    "campaignRef": "tower-launch",
    "qualification": { "since": "2026-10-10T00:00:00Z", "minUsd": 5 },
    "actionDestinationId": "open-tower",
    "destinationUrl": "https://tower.exchange/swap",
    "required": true
  }'
```

Changing a verification ID, version or parameters invalidates earlier evidence, so bump
`version` whenever the meaning of an ID changes.

## Go-live checklist

1. Apply the migration; deploy this branch (`GET https://tower.exchange/api/legion/verify` should return 200, not 404).
2. Generate a random token (24-2048 printable ASCII, no spaces) and set `LEGION_WEBHOOK_SECRET` on the server.
   Set `LEGION_TRUSTED_CONTRACTS` to the mainnet TowerSwapExecutor / router addresses.
3. Tenant admin on Republic: *Create setup credential*, then register (token must equal `LEGION_WEBHOOK_SECRET`):
   ```bash
   curl -X PUT https://republic.legion.cc/api/partner/connection \
     -H "Authorization: Bearer $SETUP_TOKEN" -H 'Content-Type: application/json' \
     --data '{"webhookUrl":"https://tower.exchange/api/legion/verify","token":"<LEGION_WEBHOOK_SECRET>","defaultNetwork":"arc-mainnet"}'
   ```
   `defaultNetwork` decides mainnet vs testnet matching; use `arc-mainnet` for real campaigns.
4. Run `node scripts/legion-verify-smoke.mjs --url https://tower.exchange/api/legion/verify` (needs the secret).
5. Use Republic's `POST /api/partner/connection/test` with a wallet that qualifies (expect `complete`) and one that doesn't (expect `incomplete`).
6. Assign IDs to draft quests, then publish through the Republic builder.

## Rotating the token

1. Deploy with `LEGION_WEBHOOK_SECRET=<new>` and `LEGION_WEBHOOK_SECRET_PREVIOUS=<old>` (both accepted).
2. Call `POST https://republic.legion.cc/api/partner/connection/rotate-token` with `{"token":"<new>"}`,
   authenticated with the old token. The old token stops working on Republic immediately.
3. Remove `LEGION_WEBHOOK_SECRET_PREVIOUS` once in-flight checks have drained.

## Operational notes

- Production runs on Railway (not Vercel), so `vercel.json` limits do not apply. Make sure the
  platform request timeout is above 8s and that no WAF/bot protection blocks `Republic-Partner-Verification/1.0`.
- Republic rate-limits participants (15s debounce); there is no automatic retry from Republic.
- Logs: every check logs `requestId`, action key, network, outcome and duration (`[legion]` prefix).
