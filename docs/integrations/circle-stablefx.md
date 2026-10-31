# Circle StableFX taker execution

Tower runs this integration as the Circle-approved **taker**. The connected
customer is not a StableFX participant and never signs a StableFX or Permit2
payload. Their wallet only signs in to Tower and sends the exact gross source
amount to Tower's approved Arc taker EOA.

The configured StableFX currencies are `USDC`, `EURC`, `GBPA`, `MXNB`, and
`AUDF`. Only `USDC ↔ EURC` and `USDC ↔ MXNB` are customer-enabled today.
GBPA and AUDF remain registered in the application for a later launch, but are
not shown in the selector or marquee and cannot be quoted or ordered. Circle
remains the source of truth for enabled currencies and corridors.

## Implemented flow

```text
Customer wallet -- exact ERC-20 transfer --> Tower approved taker EOA
                                             |
                                             v
                         executable tradable quote (Tower recipient)
                                             |
                                             v
                          Tower signs quote EIP-712 / creates trade
                                             |
                                             v
                         Tower signs Permit2 funding / submits funding
                                             |
                                             v
                           wait for Circle trade = completed on Arc
                                             |
                                             v
                          verify received output from settlement receipt
                                             |
                                             v
                            Tower EOA transfers actual output to customer
```

The backend stores each stage in `stablefx_orders`. It verifies the input-token
`Transfer` event, source address, destination address, and exact raw amount
before it asks Circle for a tradable quote. It also verifies the token/amount,
Arc chain ID, and Tower-recipient fields of every Circle EIP-712 payload before
Tower signs it.

## Tower StableFX fee

`TOWER_STABLEFX_FEE_BPS` is Tower's server-only source-token markup. It is
independent of Circle's own trade fee, which Circle returns in its quote/trade
data. The customer enters and deposits a gross amount; Tower retains the
rounded-down source-token fee and requests the Circle quote for the remaining
net principal. For example, at `30` basis points, a customer deposit of `100`
USDC produces a Tower fee of `0.30` USDC and a Circle trade principal of
`99.70` USDC.

The rate is snapshotted with each order and is checked again when the deposit
order is created. If it changed after the displayed reference quote, Tower
rejects the order and requires a fresh quote rather than applying an unseen
fee. Set or update it as a Railway server variable; never expose it with a
`NEXT_PUBLIC_` prefix.

The payout amount is the amount actually proven by the StableFX settlement
receipt—not a rounded UI estimate. A payout whose broadcast outcome is unknown
is deliberately stopped for operator reconciliation instead of being sent a
second time.

## Browser API

All browser endpoints require a Tower signed wallet session and same-origin
request. Customer identity always comes from that session, never a request body
address.

### 1. Optional display quote

`POST /api/stablefx/quote` remains a reference-price endpoint. It accepts a
fixed source amount (`amountSide: "from"`) and does not create a trade.
Tower requests both reference and tradable quotes with Circle's `instant` tenor
(approximately 30-minute settlement),
so the displayed settlement schedule matches the executable trade.

The `instant` tenor is a settlement schedule, not an executable-quote validity
period. Circle returns a separate `expiresAt` value for each tradable quote.
Tower first obtains an unsigned tradable quote to identify its Permit2 contract
and collateral requirement, then performs the balance and allowance checks in
parallel. It requests a second, fresh tradable quote and immediately signs,
stores, and creates the trade from that quote. If no trade exists and the final
quote has actually expired (or has less than 250 ms remaining), Tower discards
it and obtains one fresh replacement automatically. A second unusable quote
leaves the verified deposit in
`refund_required` for an operator-led refund rather than risking an expired
trade submission.

### 2. Create a fixed-source deposit order

`POST /api/stablefx/orders`

```json
{
  "fromCurrency": "USDC",
  "toCurrency": "MXNB",
  "amount": "1000.00",
  "amountSide": "from"
}
```

The response has a server-created order and a `depositInstruction` containing
the Arc token address, exact raw amount, and Tower taker address. The frontend
must use those fields to ask the connected wallet for the normal ERC-20
`transfer(to, amountRaw)` transaction.

Live orders intentionally require `amountSide: "from"`. An exact source amount
is required before an executable quote exists, so Tower can prove exactly what
the customer deposited. Destination-amount orders need a separate reservation
or customer-balance product; do not silently substitute a stale quote.

### 3. Confirm the Arc deposit

`POST /api/stablefx/orders/{orderId}/deposit`

```json
{ "transactionHash": "0x..." }
```

After Arc confirms the transfer, Tower executes the tradable quote, creates the
trade, signs Tower's quote intent, generates/signs Permit2 funding data, and
submits funding. The response is normally `202` because maker settlement may
still be in progress.

### 4. Read order status

`GET /api/stablefx/orders/{orderId}`

This also reconciles the order with Circle. After Circle reports `completed`,
Tower verifies the settlement receipt, broadcasts the ERC-20 payout to the
original signed-in wallet, and reports `completed` once that payout confirms.

## Circle StableFX webhooks (primary settlement trigger)

Create a production StableFX webhook in Circle Hub with this public Tower URL:

```text
https://YOUR_PUBLIC_TOWER_DOMAIN/api/webhooks/circle/stablefx
```

The route accepts Circle's `HEAD` validation request and verifies every `POST`
against the exact raw body using `X-Circle-Signature` and `X-Circle-Key-Id`.
It obtains Circle's ECDSA public verification key server-to-server; it never
accepts a shared webhook secret from the browser.

Subscribe to the StableFX trade lifecycle and contract-failure events. A
`stablefx.trade.completed` notification prompts Tower to re-fetch the
authoritative trade, verify the Arc settlement receipt, and then pay the
customer. It does **not** treat the webhook amount or status as payment proof.

Every raw delivery is recorded in `stablefx_webhook_events` using its SHA-256
hash as an idempotency key. Retries therefore cannot produce a second payout.
Set `CIRCLE_STABLEFX_WEBHOOK_SUBSCRIPTION_ID` to the production subscription ID
shown by Circle Hub after you create it; Tower then rejects signed deliveries
from any other subscription in the Circle account.

## Background settlement worker (fallback)

Deploy the database migration:

`supabase/migrations/20261022_create_stablefx_orders.sql`

`supabase/migrations/20261022_create_stablefx_webhook_events.sql`

Schedule `GET` or `POST /api/cron/stablefx-settlement` every five minutes on
Railway with:

```http
Authorization: Bearer $CRON_SECRET
```

The worker is a recovery path for a delayed or missed webhook and confirms
payout receipts after the browser has closed. Set `CRON_SECRET` in production.
The route follows the project's existing local-development behavior when it is
not configured.

## Required server configuration

```dotenv
CIRCLE_STABLEFX_ENABLED=true
CIRCLE_STABLEFX_API_KEY=...
CIRCLE_STABLEFX_API_BASE_URL=https://api.circle.com

# Circle-approved, Tower-controlled Arc EOA. This must be the EOA whose key
# signs the Circle typed data and whose balance funds the trade.
CIRCLE_STABLEFX_TAKER_ADDRESS=0x...
CIRCLE_STABLEFX_TAKER_PRIVATE_KEY=0x...
CIRCLE_STABLEFX_TAKER_WALLETS=0x...

# Tower source-token markup: 30 = 0.30%. Defaults to 0; range 0–1000.
TOWER_STABLEFX_FEE_BPS=30
# Falls back to CIRCLE_STABLEFX_API_KEY if not set. Use a dedicated Hub key only
# if Circle issues one specifically for Webhook public-key retrieval.
CIRCLE_STABLEFX_WEBHOOK_API_KEY=...
# Exact production webhook subscription ID from Circle Hub.
CIRCLE_STABLEFX_WEBHOOK_SUBSCRIPTION_ID=...

# StableFX uses Tower's existing ARC_MAINNET_RPC_URL /
# ARC_MAINNET_ALCHEMY_RPC_URL configuration; no duplicate RPC variable.
CRON_SECRET=...
```

`CIRCLE_STABLEFX_TAKER_PRIVATE_KEY` is server-only. Inject it via the hosting
secret manager or a protected signer boundary; never put it in client code,
version control, or a `NEXT_PUBLIC_` variable. The address derived from the key
must exactly equal `CIRCLE_STABLEFX_TAKER_ADDRESS`.

The application fixes the official Circle Arc mainnet contracts in code, all
with 6 decimals: USDC `0x3600000000000000000000000000000000000000`, EURC
`0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`, GBPA
`0xbBe6aAB0Ed76e90AeA0d1cd978EC231c8AdCDF8b`, MXNB
`0xF197FFC28c23E0309B5559e7a166f2c6164C80aA`, and AUDF
`0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b`. Do not configure a second
StableFX RPC endpoint: verification, allowance checks, and payouts use the
same `ARC_MAINNET_RPC_URL` / app fallback chain as the rest of Tower.

## One-time Permit2 prerequisite

Before accepting customer deposits, the Tower taker EOA must grant the source
token's ERC-20 allowance to the Permit2 contract used by StableFX. The service
checks it against the customer's source amount. The customer deposit includes
the Tower fee, which is retained and is not sent to Circle. If the source-token
balance or allowance is insufficient, the order is placed in `refund_required`
and no trade is created. Configure the approval operationally from the Tower
taker wallet; do not ask end users to approve Permit2 in this custodial model.

Circle's typed data supplies the authoritative Permit2 contract for the live
environment. Review it and the Circle integration with your compliance and key
custody controls before granting any long-lived allowance.

Collateral is always denominated in the quote's **source / `from` token** and
is a portion of the trade amount, not an extra charge. For an `X -> Y` trade
with principal `P` and quoted collateral `C`, Circle collects `C` when the
trade is recorded, then Permit2 funds only the remaining `P - C`. The Tower
taker therefore needs an `X` balance and ERC-20 allowance of at least `P`, not
`P + C`. For example, a `2 USDC -> MXNB` trade with `1 USDC` collateral draws
`1 USDC` on record-trade and the remaining `1 USDC` through Permit2.

This is the input-token contract's normal `approve(permit2Address, amount)`;
the Permit2 contract's own `approve` method is a different, internal allowance
mechanism and does not replace the ERC-20 approval that lets Permit2 pull the
source token. Always use the Permit2 address in Circle's current typed-data
domain, rather than assuming an unrelated router or prior environment address.

### Operator approval script

`scripts/approve-stablefx-permit2.mjs` calls the standard ERC-20 `approve`
function directly against the live token/proxy address, so it works even when
an explorer displays only proxy-administration methods. It defaults to a dry
run and only signs a transaction with `--execute`:

```powershell
npm run approve:stablefx -- --token USDC --amount 3
npm run approve:stablefx -- --token USDC --amount 3 --execute
```

It verifies the configured taker address matches its private key and reads the
existing allowance before sending anything. Run it once per token Tower may use
as an input token; do not target an implementation address.

## Operator states

- `awaiting_deposit`: customer has not submitted a verified transfer.
- `deposit_verified` / `executing`: Tower is obtaining the executable quote and
  creating the idempotent Circle trade.
- `funding_submitted`: Tower's Permit2 funding was accepted; wait for maker PvP
  completion.
- `settlement_completed`: Circle completed; output was proved in the Arc receipt
  and is awaiting / undergoing customer payout.
- `payout_broadcast`: customer payout exists and is awaiting Arc confirmation.
- `completed`: customer payout confirmed.
- `refund_required` / `needs_review`: automation stopped safely. Reconcile the
  taker wallet and customer deposit before a manual refund or retry.

These manual-review states are intentional safeguards: Circle funding and EVM
payouts are financially material, so an uncertain external outcome must never
be retried blindly.
