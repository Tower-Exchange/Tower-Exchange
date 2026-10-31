-- Custodial StableFX order ledger. Customer deposits and Tower's institutional
-- taker actions are never exposed through the browser's Supabase client.
--
-- This ledger intentionally retains the Circle EIP-712 payloads/signatures so
-- a server restart can safely resume idempotent trade creation. Access is
-- limited to service_role because those signatures are settlement authorities.

CREATE TABLE IF NOT EXISTS stablefx_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  taker_address TEXT NOT NULL,
  from_currency TEXT NOT NULL CHECK (from_currency IN ('USDC', 'EURC', 'GBPA', 'MXNB', 'AUDF')),
  to_currency TEXT NOT NULL CHECK (to_currency IN ('USDC', 'EURC', 'GBPA', 'MXNB', 'AUDF')),
  source_amount NUMERIC(38, 18) NOT NULL CHECK (source_amount > 0),
  source_amount_raw NUMERIC(78, 0) NOT NULL CHECK (source_amount_raw > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_deposit' CHECK (status IN (
    'awaiting_deposit',
    'deposit_verified',
    'executing',
    'funding_submitting',
    'funding_submitted',
    'funding_submission_unknown',
    'settlement_completed',
    'payout_submitting',
    'payout_broadcast',
    'completed',
    'refund_required',
    'needs_review'
  )),
  idempotency_key UUID NOT NULL UNIQUE,
  deposit_tx_hash TEXT UNIQUE,
  deposit_block_number BIGINT,
  quote_id TEXT UNIQUE,
  quote_expires_at TIMESTAMPTZ,
  trade_typed_data JSONB,
  trade_signature TEXT,
  trade_id TEXT UNIQUE,
  contract_trade_id TEXT UNIQUE,
  circle_status TEXT,
  funding_typed_data JSONB,
  funding_signature TEXT,
  settlement_tx_hash TEXT,
  output_amount_raw NUMERIC(78, 0),
  payout_tx_hash TEXT UNIQUE,
  payout_amount_raw NUMERIC(78, 0),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency)
);

CREATE INDEX IF NOT EXISTS idx_stablefx_orders_customer_created
  ON stablefx_orders (lower(customer_address), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stablefx_orders_pending
  ON stablefx_orders (status, updated_at)
  WHERE status IN (
    'deposit_verified', 'executing', 'funding_submitting',
    'funding_submitted', 'funding_submission_unknown',
    'settlement_completed', 'payout_submitting', 'payout_broadcast'
  );

DROP TRIGGER IF EXISTS update_stablefx_orders_updated_at ON stablefx_orders;
CREATE TRIGGER update_stablefx_orders_updated_at
  BEFORE UPDATE ON stablefx_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE stablefx_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stablefx_orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stablefx_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE stablefx_orders TO service_role;

COMMENT ON TABLE stablefx_orders IS
  'Server-only custodial StableFX execution ledger; contains Circle authorisations and payout state.';
