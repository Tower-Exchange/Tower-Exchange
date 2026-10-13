"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import badgeClaimedImage from "@/public/assets/Squire 2.svg";
import badgeUnclaimedImage from "@/public/assets/Dull 2.svg";
import mysteryBadgeImage from "@/public/assets/mystery badge.svg";
import silverBadgeImage from "@/public/assets/Silver.svg";
import goldBadgeImage from "@/public/assets/Gold.svg";
import starIcon from "@/public/assets/Star icon.svg";
import { ARCTOBER_BADGE_AT, CountdownBadgeModal } from "@/components/CountdownBadgeModal";
import {
  claimSquireBadge,
  fetchSquireBadgeStatus,
  getBadgeErrorLabel,
  type SquireBadgeStatus,
} from "@/lib/squireBadge";
import {
  claimPioneerBadge,
  fetchPioneerBadgeStatus,
  PIONEER_BADGE_IDS,
  type PioneerBadgeId,
  type PioneerBadgeStatus,
} from "@/lib/pioneerBadge";

type Badge = {
  id: string;
  name: string;
  alt: string;
  description?: string;
  image?: any;
  isClaimed: boolean;
  isInteractive: boolean;
  isMystery?: boolean;
  requirements?: string[];
  perks?: React.ReactNode;
  pioneerStatus?: PioneerBadgeStatus;
};

type PioneerBadgeStatuses = Partial<
  Record<PioneerBadgeId, PioneerBadgeStatus>
>;

const isPioneerBadgeId = (badgeId: string): badgeId is PioneerBadgeId =>
  (PIONEER_BADGE_IDS as readonly string[]).includes(badgeId);

const initialBadges: Badge[] = [
  {
    id: "squire",
    name: "Squire",
    alt: "Squire badge",
    isClaimed: false,
    isInteractive: true,
  },
  {
    id: "badge-slot-2",
    name: "",
    alt: "Mystery badge",
    isClaimed: false,
    isInteractive: true,
    isMystery: true,
  },
  {
    id: "badge-slot-3",
    name: "",
    alt: "Unclaimed badge",
    isClaimed: false,
    isInteractive: false,
  },
];

const postArctoberBadges: Badge[] = [
  {
    id: "squire",
    name: "Squire",
    alt: "Squire badge",
    isClaimed: false,
    isInteractive: true,
  },
  {
    id: "swap-pioneer",
    name: "Swap Pioneer",
    alt: "Swap Pioneer badge",
    description: "For those who swapped when the new market was only beginning to take shape.",
    image: silverBadgeImage,
    isClaimed: false,
    isInteractive: true,
    requirements: [
      "Complete at least 10 swap transactions",
      "Accumulate at least $1,000 in total swap volume",
    ],
    perks: (
      <>
        75 Republic Valor Points 
        <a
          href="https://republic.legion.cc/docs/vp-history"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#78AFFF] underline underline-offset-2 hover:opacity-80 transition-opacity ml-1"
        >
           Learn more
        </a>
      </>
    ),
  },
  {
    id: "bridge-pioneer",
    name: "Bridge Pioneer",
    alt: "Bridge Pioneer badge",
    description: "You crossed early, carrying value into a new era on Arc.",
    image: goldBadgeImage,
    isClaimed: false,
    isInteractive: true,
    requirements: [
      "Complete at least 10 bridge transactions",
      "Accumulate at least $1,000 in total bridge volume",
    ],
    perks: (
      <>
        75 Republic Valor Points 
        <a
          href="https://republic.legion.cc/docs/vp-history"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#78AFFF] underline underline-offset-2 hover:opacity-80 transition-opacity ml-1"
        >
           Learn more
        </a>
      </>
    ),
  },
];

const getBadgeDescription = (isClaimed: boolean) =>
  isClaimed
    ? "You've taken your first step on Tower.\nYou're a real user."
    : "This badge is for real users who have\ntaken their first step on Tower.";

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

const BadgeDetailsModal = ({
  badge,
  onClose,
  onClaim,
  canClaim = false,
  isCheckingEligibility = false,
  isClaiming = false,
  claimError = null,
  isWalletConnected = false,
}: {
  badge: Badge | null;
  onClose: () => void;
  onClaim?: () => void;
  canClaim?: boolean;
  isCheckingEligibility?: boolean;
  isClaiming?: boolean;
  claimError?: string | null;
  isWalletConnected?: boolean;
}) => {
  const [userSelectedTab, setUserSelectedTab] = useState<{
    badgeId: string | null;
    tab: "requirements" | "perks";
  }>({ badgeId: null, tab: "requirements" });

  const defaultTab =
    badge?.requirements && badge.requirements.length > 0
      ? "requirements"
      : "perks";

  const activeTab =
    userSelectedTab.badgeId === badge?.id
      ? userSelectedTab.tab
      : defaultTab;

  const setActiveTab = (tab: "requirements" | "perks") => {
    setUserSelectedTab({ badgeId: badge?.id ?? null, tab });
  };

  // Always show the brown (claimed) badge image for squire badge in the modal if claimed
  const badgeImage =
    badge?.image ??
    (badge?.id === "squire" ? badgeClaimedImage : badge?.isClaimed ? badgeClaimedImage : badgeUnclaimedImage);

  const requirements = badge?.pioneerStatus
    ? [
        {
          label: `${badge.pioneerStatus.transactionCount} / ${
            badge.pioneerStatus.minimumTransactionCount
          } successful ${
            badge.id === "swap-pioneer" ? "swap" : "bridge"
          } transactions`,
          isComplete:
            isWalletConnected &&
            badge.pioneerStatus.transactionCount >=
              badge.pioneerStatus.minimumTransactionCount,
        },
        {
          label: `${formatUsd(badge.pioneerStatus.volumeUsd)} / ${formatUsd(
            badge.pioneerStatus.minimumVolumeUsd,
          )} in total ${badge.id === "swap-pioneer" ? "swap" : "bridge"} volume`,
          isComplete:
            isWalletConnected &&
            badge.pioneerStatus.volumeUsd >= badge.pioneerStatus.minimumVolumeUsd,
        },
      ]
    : (badge?.requirements ?? []).map((label) => ({
        label,
        isComplete: isWalletConnected && Boolean(badge?.isClaimed),
      }));
  const hasRequirements = requirements.length > 0;
  const isPioneerBadge = isPioneerBadgeId(badge?.id ?? "");

  return (
    <AnimatePresence>
      {badge && (
        <>
          <motion.button
            type="button"
            aria-label="Close badge details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${badge.name} badge details`}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed inset-0 z-[91] flex items-center justify-center px-4 py-3 sm:py-6"
          >
            <div
              className={`relative max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto border border-border bg-[#14181f] shadow-2xl ${
                isPioneerBadge
                  ? "max-w-[460px] rounded-[24px] px-5 pb-5 pt-8 sm:px-7"
                  : "max-w-[540px] rounded-[28px] px-7 pb-9 pt-12 sm:px-10"
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close badge details"
                className={`absolute inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent ${
                  isPioneerBadge ? "right-5 top-5" : "right-7 top-7"
                }`}
              >
                <X size={20} strokeWidth={2} />
              </button>

              <div className="flex flex-col items-center text-center">
                <Image
                  src={badgeImage}
                  alt={`${badge.name} badge`}
                  width={128}
                  height={144}
                  className={`h-auto object-contain ${
                    isPioneerBadge
                      ? "w-[82px] sm:w-[92px]"
                      : "w-[116px] sm:w-[128px]"
                  }`}
                />
                <h3
                  className={`font-semibold leading-none text-foreground ${
                    isPioneerBadge
                      ? "mt-3 text-xl sm:text-[22px]"
                      : "mt-4 text-2xl sm:text-[26px]"
                  }`}
                >
                  {badge.name}
                </h3>
                <p
                  className={`max-w-[380px] whitespace-pre-line text-center font-medium leading-snug text-foreground ${
                    isPioneerBadge
                      ? "mt-2 text-sm"
                      : "mt-3 text-sm sm:text-base"
                  }`}
                >
                  {badge.description ?? getBadgeDescription(badge.isClaimed)}
                </p>

                {hasRequirements ? (
                  <div
                    className={`inline-flex items-center rounded-full border border-white/5 bg-[#14181f] p-1 ${
                      isPioneerBadge ? "mt-4" : "mt-6"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveTab("requirements")}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all sm:text-sm ${
                        activeTab === "requirements"
                          ? "bg-[#1d212b] text-foreground shadow-sm"
                          : "text-[#464D5A] "
                      }`}
                    >
                      Requirements
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("perks")}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all sm:text-sm ${
                        activeTab === "perks"
                          ? "bg-[#1d212b] text-foreground shadow-sm"
                          : "text-[#464D5A] "
                      }`}
                    >
                      Perks
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 inline-flex h-9 items-center justify-center rounded-full bg-white/[0.06] px-4 text-sm font-semibold text-foreground">
                    Perks
                  </div>
                )}

                <div
                  className={`w-full rounded-[24px] border border-[#828282]/22 text-left ${
                    isPioneerBadge
                      ? "mt-3 p-4 sm:p-5"
                      : "mt-5 p-5 sm:p-6"
                  }`}
                >
                  {activeTab === "requirements" && hasRequirements ? (
                    <div
                      className={`flex flex-col ${
                        isPioneerBadge ? "gap-3" : "gap-4"
                      }`}
                    >
                      {requirements.map((requirement, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div
                            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                              requirement.isComplete
                                ? "bg-[#7bb8ff]/15 text-[#000]"
                                : "bg-white/10 text-muted-foreground"
                            }`}
                          >
                            <Check size={12} strokeWidth={3} />
                          </div>
                          <p
                            className={`font-medium text-foreground ${
                              isPioneerBadge
                                ? "text-sm"
                                : "text-sm sm:text-base"
                            }`}
                          >
                            {requirement.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      {badge.perks ? (
                        <>
                          <Image
                            src={starIcon}
                            alt=""
                            width={14}
                            height={14}
                            className="shrink-0"
                          />
                          <p className="text-sm font-medium text-foreground sm:text-base">
                            {badge.perks}
                          </p>
                        </>
                      ) : (
                        <>
                          <Image
                            src={starIcon}
                            alt=""
                            width={14}
                            height={14}
                            className="shrink-0"
                          />
                          <p className="text-base font-medium leading-relaxed text-foreground sm:text-lg">
                            Squire Badge holders get a daily limit of 40 AI messages.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {badge.id === "swap-pioneer" || badge.id === "bridge-pioneer" ? (
                  <>
                    <button
                      type="button"
                      onClick={onClaim}
                      disabled={!canClaim || isClaiming}
                      className={`inline-flex w-full items-center justify-center rounded-full px-6 text-sm font-semibold transition-opacity sm:text-base ${
                        canClaim && !isClaiming
                          ? "bg-[#78AFFF] text-black hover:opacity-90"
                          : "cursor-not-allowed bg-white/10 text-muted-foreground"
                      } ${isPioneerBadge ? "mt-4 h-10" : "mt-5 h-11"}`}
                    >
                      {badge.isClaimed
                        ? "Claimed"
                        : isClaiming
                          ? "Claiming Badge..."
                          : isCheckingEligibility
                            ? "Checking Eligibility..."
                            : "Claim Badge"}
                    </button>
                    {claimError ? (
                      <p className="mt-2 text-center text-sm font-medium text-[#ff9a9a]">
                        {claimError}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const ClaimingBadgeModal = ({ isOpen }: { isOpen: boolean }) => (
  <AnimatePresence>
    {isOpen ? (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[92] bg-black/70 backdrop-blur-md"
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.97 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="fixed inset-0 z-[93] flex items-center justify-center px-4 py-6"
        >
          <div className="relative w-full max-w-[34rem] overflow-hidden rounded-[2rem] border border-white/8 bg-card px-6 pb-8 pt-9 shadow-[0_30px_90px_rgba(0,0,0,0.68)] sm:px-9">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <div className="mx-auto max-w-[24rem] text-center sm:max-w-none">
              <p className="text-[0.78rem] font-semibold uppercase tracking-[0.22em] text-[#8B9199]">
                Claiming Badge
              </p>
              <h3 className="mt-3 text-[1.15rem] font-semibold leading-tight text-foreground sm:text-[1.45rem] sm:whitespace-nowrap">
                Minting your Squire badge on Tower
              </h3>
              <p className="mx-auto mt-2 max-w-[20rem] text-center text-sm leading-6 text-[#9AA0A8] sm:max-w-[22rem]">
                We&apos;re sealing your first badge and updating your profile.
              </p>
            </div>

            <div className="relative mx-auto mt-9 flex w-full max-w-[22rem] items-center justify-center gap-3 sm:gap-6">
              <motion.div
                animate={{
                  x: [0, 8, 0],
                  y: [0, -4, 0],
                  opacity: [0.94, 0.7, 0.94],
                  scale: [1, 0.98, 1],
                }}
                transition={{
                  duration: 1.8,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="relative z-10"
              >
                <Image
                  src={badgeUnclaimedImage}
                  alt="Silver Squire badge"
                  width={148}
                  height={168}
                  className="h-auto w-[7.1rem] object-contain opacity-95 sm:w-[8.2rem]"
                />
              </motion.div>

              <motion.div
                animate={{
                  opacity: [0.14, 0.32, 0.14],
                  scaleX: [0.88, 1.08, 0.88],
                }}
                transition={{
                  duration: 1.3,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="absolute left-1/2 top-1/2 h-[2px] w-[7rem] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-[#7BB8FF] to-transparent sm:w-[8.5rem]"
              />

              <motion.div
                animate={{
                  x: [0, -8, 0],
                  y: [0, 4, 0],
                  scale: [0.96, 1.04, 0.96],
                  rotate: [0, 2, 0],
                }}
                transition={{
                  duration: 1.8,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="relative z-10"
              >
                <div className="absolute inset-0 rounded-full bg-[#9c6337]/18 blur-2xl" />
                <Image
                  src={badgeClaimedImage}
                  alt="Claimed Squire badge"
                  width={148}
                  height={168}
                  className="relative h-auto w-[7.1rem] object-contain sm:w-[8.2rem]"
                />
              </motion.div>
            </div>
          </div>
        </motion.div>
      </>
    ) : null}
  </AnimatePresence>
);

const BadgeCongratulationsModal = ({
  isOpen,
  onClose,
  onViewBadge,
}: {
  isOpen: boolean;
  onClose: () => void;
  onViewBadge: () => void;
}) => (
  <AnimatePresence>
    {isOpen ? (
      <>
        <motion.button
          type="button"
          aria-label="Close badge congratulations"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[94] bg-black/70 backdrop-blur-md"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="fixed inset-0 z-[95] flex items-center justify-center px-4 py-6"
        >
          <div className="relative w-full max-w-[28rem] rounded-[2rem] border border-white/6 bg-card px-4 pb-8 pt-5 shadow-[0_30px_90px_rgba(0,0,0,0.68)] sm:px-8">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close badge congratulations"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <div className="mt-2 flex justify-center">
              <div className="inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap text-center sm:gap-2">
                <Image
                  src={starIcon}
                  alt=""
                  width={13}
                  height={13}
                  className="h-[0.76rem] w-[0.76rem] shrink-0 opacity-95 sm:h-[0.82rem] sm:w-[0.82rem]"
                />
                <p className="text-[0.72rem] font-medium leading-none whitespace-nowrap text-foreground sm:text-[0.86rem] sm:leading-6 md:text-[0.9rem]">
                  Congratulations, you&apos;ve claimed the Squire Badge
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <Image
                src={badgeClaimedImage}
                alt="Claimed Squire badge"
                width={162}
                height={182}
                className="h-auto w-[8.8rem] object-contain sm:w-[9.6rem]"
              />
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={onViewBadge}
                className="inline-flex h-[3rem] min-w-[14.8rem] items-center justify-center rounded-full bg-[#78AFFF] px-8 text-[1.08rem] font-semibold text-black transition-opacity hover:opacity-90"
              >
                View Badge
              </button>
            </div>
          </div>
        </motion.div>
      </>
    ) : null}
  </AnimatePresence>
);

type BadgesProps = {
  walletAddress?: string | null;
  isWalletConnected?: boolean;
  highlightedBadgeId?: string | null;
  countdownOpenKey?: number;
  onSquireBadgeStatusChange?: (status: SquireBadgeStatus | null) => void;
};

const Badges = ({
  walletAddress = null,
  isWalletConnected = false,
  highlightedBadgeId = null,
  countdownOpenKey = 0,
  onSquireBadgeStatusChange,
}: BadgesProps) => {
  const router = useRouter();
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
  const [showCountdownModal, setShowCountdownModal] = useState(
    highlightedBadgeId !== "squire",
  );
  const [squireBadgeStatus, setSquireBadgeStatus] =
    useState<SquireBadgeStatus | null>(null);
  const [isCheckingSquireBadge, setIsCheckingSquireBadge] = useState(false);
  const [isClaimingSquireBadge, setIsClaimingSquireBadge] = useState(false);
  const [showClaimCongratulations, setShowClaimCongratulations] = useState(false);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [pioneerBadgeStatuses, setPioneerBadgeStatuses] =
    useState<PioneerBadgeStatuses>({});
  const [isCheckingPioneerBadges, setIsCheckingPioneerBadges] = useState(false);
  const [claimingPioneerBadgeId, setClaimingPioneerBadgeId] =
    useState<PioneerBadgeId | null>(null);
  const [pioneerBadgeError, setPioneerBadgeError] = useState<string | null>(
    null,
  );
  const normalizedWalletAddress = walletAddress?.trim().toLowerCase() ?? null;

  const handleCloseCountdown = useCallback(() => {
    setShowCountdownModal(false);
  }, []);

  useEffect(() => {
    if (!normalizedWalletAddress) {
      setSquireBadgeStatus(null);
      setBadgeError(null);
      setIsCheckingSquireBadge(false);
      return;
    }

    let cancelled = false;

    const loadSquireBadgeStatus = async () => {
      setIsCheckingSquireBadge(true);
      setBadgeError(null);

      try {
        const { response, result } = await fetchSquireBadgeStatus(
          normalizedWalletAddress,
        );

        if (cancelled) {
          return;
        }

        if (!response.ok || !result.success || !result.badge) {
          setBadgeError(getBadgeErrorLabel(result.message, result.debug));
          setSquireBadgeStatus(null);
          return;
        }

        setSquireBadgeStatus(result.badge);
      } catch (error) {
        console.error("Failed to load squire badge status:", error);

        if (!cancelled) {
          setBadgeError("Unable to check badge eligibility.");
          setSquireBadgeStatus(null);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingSquireBadge(false);
        }
      }
    };

    void loadSquireBadgeStatus();

    return () => {
      cancelled = true;
    };
  }, [normalizedWalletAddress]);

  useEffect(() => {
    if (!normalizedWalletAddress) {
      setPioneerBadgeStatuses({});
      setPioneerBadgeError(null);
      setIsCheckingPioneerBadges(false);
      return;
    }

    let cancelled = false;

    const loadPioneerBadgeStatuses = async () => {
      setIsCheckingPioneerBadges(true);
      setPioneerBadgeError(null);

      try {
        const results = await Promise.all(
          PIONEER_BADGE_IDS.map(async (badgeId) => ({
            badgeId,
            ...(await fetchPioneerBadgeStatus(normalizedWalletAddress, badgeId)),
          })),
        );

        if (cancelled) {
          return;
        }

        const statuses: PioneerBadgeStatuses = {};
        const failedResult = results.find(
          ({ response, result }) =>
            !response.ok || !result.success || !result.badge,
        );

        for (const { badgeId, response, result } of results) {
          if (response.ok && result.success && result.badge) {
            statuses[badgeId] = result.badge;
          }
        }

        setPioneerBadgeStatuses(statuses);

        if (failedResult) {
          setPioneerBadgeError(
            getBadgeErrorLabel(failedResult.result.message, failedResult.result.debug),
          );
        }
      } catch (error) {
        console.error("Failed to load pioneer badge statuses:", error);

        if (!cancelled) {
          setPioneerBadgeStatuses({});
          setPioneerBadgeError("Unable to check badge eligibility.");
        }
      } finally {
        if (!cancelled) {
          setIsCheckingPioneerBadges(false);
        }
      }
    };

    void loadPioneerBadgeStatuses();

    return () => {
      cancelled = true;
    };
  }, [normalizedWalletAddress]);

  useEffect(() => {
    onSquireBadgeStatusChange?.(squireBadgeStatus);
  }, [onSquireBadgeStatusChange, squireBadgeStatus]);

  useEffect(() => {
    if (highlightedBadgeId === "squire" && squireBadgeStatus?.isClaimed) {
      setShowCountdownModal(false);
      setSelectedBadgeId("squire");
    }
  }, [highlightedBadgeId, squireBadgeStatus?.isClaimed]);

  useEffect(() => {
    if (countdownOpenKey > 0) {
      setSelectedBadgeId(null);
      setShowCountdownModal(true);
    }
  }, [countdownOpenKey]);

  const [isArctoberEnded, setIsArctoberEnded] = useState(false);

  useEffect(() => {
    const checkEnded = () => {
      let ended = Date.now() >= Date.parse(ARCTOBER_BADGE_AT);
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.get("arctober") === "ended" || params.get("arctober") === "true") {
          ended = true;
        }
      }
      setIsArctoberEnded(ended);
      if (ended) {
        setShowCountdownModal(false);
      }
    };
    checkEnded();
  }, []);

  const activeBadgesList = isArctoberEnded ? postArctoberBadges : initialBadges;

  const displayBadges = useMemo(
    () =>
      activeBadgesList.map((badge) =>
        badge.id === "squire"
          ? {
              ...badge,
              isClaimed: squireBadgeStatus?.isClaimed === true,
            }
          : isPioneerBadgeId(badge.id)
            ? {
                ...badge,
                isClaimed: pioneerBadgeStatuses[badge.id]?.isClaimed === true,
                pioneerStatus: pioneerBadgeStatuses[badge.id],
              }
            : badge,
      ),
    [
      activeBadgesList,
      pioneerBadgeStatuses,
      squireBadgeStatus?.isClaimed,
    ],
  );
  const selectedBadge =
    displayBadges.find((badge) => badge.id === selectedBadgeId) ?? null;
  const selectedPioneerBadgeId =
    selectedBadge && isPioneerBadgeId(selectedBadge.id)
      ? selectedBadge.id
      : null;
  const isClaimingPioneerBadge =
    selectedPioneerBadgeId === claimingPioneerBadgeId;
  const canClaimPioneerBadge =
    isWalletConnected &&
    Boolean(normalizedWalletAddress) &&
    Boolean(selectedPioneerBadgeId) &&
    selectedBadge?.pioneerStatus?.isEligible === true &&
    selectedBadge.pioneerStatus.isClaimed !== true &&
    !isCheckingPioneerBadges &&
    !isClaimingPioneerBadge;
  const canClaimSquireBadge =
    isWalletConnected &&
    Boolean(normalizedWalletAddress) &&
    squireBadgeStatus?.isEligible === true &&
    squireBadgeStatus.isClaimed !== true &&
    !isCheckingSquireBadge &&
    !isClaimingSquireBadge;
  const isClaimButtonDisabled =
    !canClaimSquireBadge ||
    isCheckingSquireBadge ||
    isClaimingSquireBadge ||
    squireBadgeStatus?.isClaimed === true;
  const claimButtonLabel = squireBadgeStatus?.isClaimed
    ? "Claimed"
    : isCheckingSquireBadge
        ? "Checking..."
        : "Claim Badge";

  const handleClaimSquireBadge = async () => {
    if (!normalizedWalletAddress || !canClaimSquireBadge) {
      return;
    }

    setIsClaimingSquireBadge(true);
    setBadgeError(null);

    try {
      const { response, result } = await claimSquireBadge(
        normalizedWalletAddress,
      );

      if (!response.ok || !result.success || !result.badge) {
        setBadgeError(getBadgeErrorLabel(result.message, result.debug));

        if (result.badge) {
          setSquireBadgeStatus(result.badge);
        }
        return;
      }

      setSquireBadgeStatus(result.badge);
      setShowClaimCongratulations(true);
    } catch (error) {
      console.error("Failed to claim squire badge:", error);
      setBadgeError("Unable to claim badge right now.");
    } finally {
      setIsClaimingSquireBadge(false);
    }
  };

  const handleClaimPioneerBadge = async () => {
    if (
      !normalizedWalletAddress ||
      !selectedPioneerBadgeId ||
      !canClaimPioneerBadge
    ) {
      return;
    }

    setClaimingPioneerBadgeId(selectedPioneerBadgeId);
    setPioneerBadgeError(null);

    try {
      const { response, result } = await claimPioneerBadge(
        normalizedWalletAddress,
        selectedPioneerBadgeId,
      );

      if (!response.ok || !result.success || !result.badge) {
        setPioneerBadgeError(getBadgeErrorLabel(result.message, result.debug));

        if (result.badge) {
          setPioneerBadgeStatuses((current) => ({
            ...current,
            [selectedPioneerBadgeId]: result.badge,
          }));
        }
        return;
      }

      setPioneerBadgeStatuses((current) => ({
        ...current,
        [selectedPioneerBadgeId]: result.badge,
      }));
    } catch (error) {
      console.error("Failed to claim pioneer badge:", error);
      setPioneerBadgeError("Unable to claim badge right now.");
    } finally {
      setClaimingPioneerBadgeId(null);
    }
  };

  const handleViewBadge = () => {
    setShowClaimCongratulations(false);
    setSelectedBadgeId(null);
    router.replace("/profile?tab=badges", { scroll: false });
  };

  return (
    <>
      <motion.section
        key="badges"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 sm:px-11 lg:min-h-[296px] lg:px-11 lg:py-12"
      >
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(280px,1fr)_minmax(440px,0.95fr)]">
          <div className="max-w-[490px]">
            <h3 className="text-xl font-semibold text-foreground sm:text-[22px]">
              Collect Tower Badges
            </h3>
            <p className="mt-3 max-w-[460px] text-base leading-snug text-foreground sm:text-lg">
              Earn badges by completing milestones, participating in events, and
              engaging with the ecosystem.
            </p>
            <button
              type="button"
              disabled={isClaimButtonDisabled}
              onClick={handleClaimSquireBadge}
              className={`mt-7 inline-flex h-9 min-w-[162px] items-center justify-center rounded-full px-6 text-base font-semibold transition-all ${
                canClaimSquireBadge
                  ? "bg-primary text-black hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              }`}
            >
              {claimButtonLabel}
            </button>

            {badgeError ? (
              <p className="mt-3 text-sm font-medium text-[#ff9a9a]">
                {badgeError}
              </p>
            ) : null}
          </div>

          <div className="flex w-full justify-center lg:justify-end">
            <div className="grid w-full max-w-[430px] grid-cols-3 items-start gap-4 sm:gap-7 lg:max-w-[460px] lg:gap-10">
              {displayBadges.map((badge) => {
                const badgeImage = badge.image
                  ? badge.image
                  : badge.isMystery
                    ? mysteryBadgeImage
                    : badge.isClaimed
                      ? badgeClaimedImage
                      : badgeUnclaimedImage;
                const badgeContent = (
                  <>
                    <Image
                      src={badgeImage}
                      alt={badge.alt}
                      width={128}
                      height={144}
                      className="h-auto w-[70px] object-contain sm:w-[88px] lg:w-[104px]"
                    />
                    <div className="mt-4 h-8 text-center text-base font-semibold leading-[1.3] text-foreground sm:text-lg">
                      {badge.name}
                    </div>
                  </>
                );

                if (!badge.isInteractive) {
                  return (
                    <div
                      key={badge.id}
                      className="flex min-w-0 flex-col items-center"
                    >
                      {badgeContent}
                    </div>
                  );
                }

                return (
                  <button
                    key={badge.id}
                    type="button"
                    onClick={() => {
                      if (badge.isMystery) {
                        setSelectedBadgeId(null);
                        setShowCountdownModal(true);
                        return;
                      }

                      setShowCountdownModal(false);
                      setSelectedBadgeId(badge.id);
                    }}
                    className="group flex min-w-0 flex-col items-center rounded-xl outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-primary/70"
                    aria-label={
                      badge.isMystery
                        ? "Open Arctober badge countdown"
                        : `Open ${badge.name} badge details`
                    }
                  >
                    {badgeContent}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.section>

      <CountdownBadgeModal
        isOpen={showCountdownModal}
        onClose={handleCloseCountdown}
      />
      <BadgeDetailsModal
        badge={selectedBadge}
        onClose={() => setSelectedBadgeId(null)}
        onClaim={handleClaimPioneerBadge}
        canClaim={canClaimPioneerBadge}
        isCheckingEligibility={isCheckingPioneerBadges}
        isClaiming={isClaimingPioneerBadge}
        claimError={pioneerBadgeError}
        isWalletConnected={isWalletConnected}
      />
      <ClaimingBadgeModal isOpen={isClaimingSquireBadge} />
      <BadgeCongratulationsModal
        isOpen={showClaimCongratulations}
        onClose={() => setShowClaimCongratulations(false)}
        onViewBadge={handleViewBadge}
      />
    </>
  );
};

export default Badges;
