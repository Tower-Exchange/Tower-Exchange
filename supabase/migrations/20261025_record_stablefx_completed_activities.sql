-- A StableFX order can be reconciled by both a Circle webhook and a customer
-- status poll. Keep the customer-facing payout activity idempotent across
-- those concurrent execution paths.

CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_stablefx_payout_once
  ON public.activities (lower(wallet_address), transaction_hash)
  WHERE type = 'Swap via Circle StableFX'
    AND transaction_hash IS NOT NULL;
