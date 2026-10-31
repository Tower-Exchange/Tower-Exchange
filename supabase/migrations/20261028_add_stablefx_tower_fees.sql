-- Preserve the customer's entered/deposited gross amount separately from the
-- smaller amount Tower submits to Circle after retaining its source-token fee.
-- Existing pre-fee orders remain readable through source_amount/source_amount_raw.

ALTER TABLE public.stablefx_orders
  ADD COLUMN IF NOT EXISTS customer_amount NUMERIC(38, 18),
  ADD COLUMN IF NOT EXISTS customer_amount_raw NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS tower_fee_amount NUMERIC(38, 18),
  ADD COLUMN IF NOT EXISTS tower_fee_amount_raw NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS tower_fee_bps INTEGER NOT NULL DEFAULT 0
    CHECK (tower_fee_bps >= 0 AND tower_fee_bps <= 1000);

COMMENT ON COLUMN public.stablefx_orders.customer_amount IS
  'Gross amount entered and deposited by the customer, before Tower StableFX fee.';
COMMENT ON COLUMN public.stablefx_orders.customer_amount_raw IS
  'Gross customer deposit in source-token smallest units.';
COMMENT ON COLUMN public.stablefx_orders.tower_fee_amount IS
  'Tower source-token fee retained from the gross customer deposit.';
COMMENT ON COLUMN public.stablefx_orders.tower_fee_amount_raw IS
  'Tower source-token fee in smallest units.';
COMMENT ON COLUMN public.stablefx_orders.tower_fee_bps IS
  'Snapshot of TOWER_STABLEFX_FEE_BPS used when the order was created.';
