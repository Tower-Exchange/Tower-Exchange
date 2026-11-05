/**
 * Recurring orders are deliberately unavailable until their replacement has
 * completed a new security review. This is a hard application-level stop,
 * rather than an environment toggle that could be enabled accidentally.
 */
export const RECURRING_ORDERS_ENABLED = false;

export const RECURRING_ORDERS_UNAVAILABLE_MESSAGE =
  "Recurring orders are not available while Tower completes a new audited design.";

export const recurringOrdersUnavailablePayload = {
  success: false,
  code: "RECURRING_ORDERS_DISABLED",
  error: RECURRING_ORDERS_UNAVAILABLE_MESSAGE,
} as const;
