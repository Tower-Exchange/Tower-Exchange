const parseBooleanEnv = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return true;
  }

  return null;
};

export const BADGE_CLAIMING_DISABLED_MESSAGE =
  "Badge claiming is temporarily paused.";

export const isBadgeClaimingEnabled = () => {
  const serverFlag = parseBooleanEnv(process.env.BADGE_CLAIMING_ENABLED);
  const clientFlag = parseBooleanEnv(
    process.env.NEXT_PUBLIC_BADGE_CLAIMING_ENABLED,
  );

  if (serverFlag === false || clientFlag === false) {
    return false;
  }

  if (serverFlag === true || clientFlag === true) {
    return true;
  }

  // Default to false (disabled)
  return false;
};

