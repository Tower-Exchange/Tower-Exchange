// On unless NEXT_PUBLIC_PAYMASTER_ENABLED is set to "false".
export const isPaymasterEnabled = () =>
  process.env.NEXT_PUBLIC_PAYMASTER_ENABLED?.trim().toLowerCase() !== "false";
