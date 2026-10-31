-- Durable delivery ledger for Circle StableFX webhooks. Circle can retry a
-- delivery, so the SHA-256 of the signed raw payload is the idempotency key.
-- It is service-role only because it contains operational trade metadata.

CREATE TABLE IF NOT EXISTS stablefx_webhook_events (
  delivery_hash CHAR(64) PRIMARY KEY,
  notification_type TEXT NOT NULL,
  subscription_id TEXT,
  trade_id TEXT,
  contract_trade_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'processing', 'processed', 'failed'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stablefx_webhook_events_status
  ON stablefx_webhook_events (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_stablefx_webhook_events_trade
  ON stablefx_webhook_events (trade_id, contract_trade_id)
  WHERE trade_id IS NOT NULL OR contract_trade_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_stablefx_webhook_events_updated_at ON stablefx_webhook_events;
CREATE TRIGGER update_stablefx_webhook_events_updated_at
  BEFORE UPDATE ON stablefx_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE stablefx_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stablefx_webhook_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stablefx_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE stablefx_webhook_events TO service_role;

COMMENT ON TABLE stablefx_webhook_events IS
  'Server-only Circle StableFX webhook delivery ledger and idempotency record.';
