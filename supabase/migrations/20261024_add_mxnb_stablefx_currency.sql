-- Enable MXNB for deployments that already ran the initial StableFX migration.
ALTER TABLE stablefx_orders
  DROP CONSTRAINT IF EXISTS stablefx_orders_from_currency_check,
  DROP CONSTRAINT IF EXISTS stablefx_orders_to_currency_check;

ALTER TABLE stablefx_orders
  ADD CONSTRAINT stablefx_orders_from_currency_check
    CHECK (from_currency IN ('USDC', 'EURC', 'GBPA', 'MXNB', 'AUDF')),
  ADD CONSTRAINT stablefx_orders_to_currency_check
    CHECK (to_currency IN ('USDC', 'EURC', 'GBPA', 'MXNB', 'AUDF'));
