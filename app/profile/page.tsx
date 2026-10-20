"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import TokenTicker from "@/components/TokenTicker";
import Positions from "@/components/Positions";
import Activities from "@/components/Activities";
import Badges from "@/components/Badges";
import UnifiedDeposit from "@/components/UnifiedDeposit";
import { isUnifiedDepositEnabled } from "@/lib/bridgeEnabled";
import {
  getArcNetworkHex,
  getArcNetworkLabel,
  normalizeArcChainHex,
} from "@/lib/arcNetwork";
import { ensureWalletOnArcNetwork } from "@/lib/arcWalletNetwork";
import { useTowerNetworkMode } from "@/lib/hooks/useTowerNetworkMode";
import { uploadProfilePicture, saveProfileData, loadProfileData } from "@/lib/profileService";
import { AppErrorModal } from "@/components/AppErrorModal";
import { useRainbowKitAuth } from "@/lib/use-rainbowkit-auth";
import badgeClaimedImage from "@/public/assets/Squire 2.svg";
import {
  fetchSquireBadgeStatus,
  type SquireBadgeStatus,
} from "@/lib/squireBadge";

  type EthereumWindow = Window & {
  ethereum?: {
    request?: (args: {
      method: string;
      params?: unknown[];
    }) => Promise<unknown>;
    on?: (event: string, handler: (chainId: string) => void) => void;
    removeListener?: (event: string, handler: (chainId: string) => void) => void;
  };
};

type ProfileTab = "positions" | "activities" | "badges" | "unified";

const profileTabs: Array<{ id: ProfileTab; label: string }> = [
  { id: "positions", label: "Positions" },
  { id: "activities", label: "Activities" },
  { id: "badges", label: "Badges" },
  ...(isUnifiedDepositEnabled()
    ? [{ id: "unified" as const, label: "Unified Balance" }]
    : []),
];

const ProfileContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ProfileTab>("positions");
  const { authenticated, user } = useRainbowKitAuth();
  const { mode: arcNetworkMode } = useTowerNetworkMode();
  const [chainId, setChainId] = useState<string | null>(null);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState("$0.00");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [profileImageError, setProfileImageError] = useState(false);
  const [isUploadingProfile, setIsUploadingProfile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [squireBadgeStatus, setSquireBadgeStatus] =
    useState<SquireBadgeStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedTab = searchParams.get("tab");
  const requestedBadgeId = searchParams.get("badge");

  useEffect(() => {
    const ethereum = typeof window === "undefined" ? undefined : (window as EthereumWindow).ethereum;
    if (!ethereum) return;

    const handleChainChanged = (newChainId: string) => {
      setChainId(newChainId);
    };

    ethereum
      .request?.({ method: "eth_chainId" })
      .then((id) => setChainId(typeof id === "string" ? id : null))
      .catch(() => setChainId(null));

    ethereum.on?.("chainChanged", handleChainChanged);
    return () => ethereum.removeListener?.("chainChanged", handleChainChanged);
  }, []);

  // Load profile picture when user address changes
  useEffect(() => {
    const loadProfile = async () => {
      if (user?.wallet?.address) {
        const savedProfilePicture = await loadProfileData(user.wallet.address);
        setProfilePictureUrl(savedProfilePicture);
        setProfileImageError(false);
        return;
      }

      setProfilePictureUrl(null);
      setProfileImageError(false);
    };

    loadProfile();
  }, [user?.wallet?.address]);

  useEffect(() => {
    if (
      requestedTab === "positions" ||
      requestedTab === "activities" ||
      requestedTab === "badges" ||
      (requestedTab === "unified" && isUnifiedDepositEnabled())
    ) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    const walletAddress = user?.wallet?.address?.trim().toLowerCase();

    if (!walletAddress) {
      setSquireBadgeStatus(null);
      return;
    }

    let cancelled = false;

    const loadSquireBadgeStatus = async () => {
      try {
        const { response, result } = await fetchSquireBadgeStatus(walletAddress);

        if (cancelled || !response.ok || !result.success || !result.badge) {
          if (!cancelled) {
            setSquireBadgeStatus(null);
          }
          return;
        }

        setSquireBadgeStatus(result.badge);
      } catch (error) {
        console.error("Failed to load profile badge state:", error);

        if (!cancelled) {
          setSquireBadgeStatus(null);
        }
      }
    };

    void loadSquireBadgeStatus();

    return () => {
      cancelled = true;
    };
  }, [user?.wallet?.address]);

  const isOnSelectedArc =
    chainId != null &&
    normalizeArcChainHex(chainId) ===
      normalizeArcChainHex(getArcNetworkHex(arcNetworkMode));
  const selectedArcLabel = getArcNetworkLabel(arcNetworkMode);
  const displayAddress = useMemo(() => {
    const addr = user?.wallet?.address;
    if (!addr) return null;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }, [user?.wallet?.address]);
  const hasClaimedSquireBadge = squireBadgeStatus?.isClaimed === true;

  const handleTabChange = (tab: ProfileTab) => {
    setActiveTab(tab);

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("tab", tab);

    if (tab !== "badges") {
      nextSearchParams.delete("badge");
    } else if (requestedBadgeId) {
      nextSearchParams.set("badge", requestedBadgeId);
    }

    router.replace(`/profile?${nextSearchParams.toString()}`, {
      scroll: false,
    });
  };

  const handleAddArcNetwork = async () => {
    try {
      await ensureWalletOnArcNetwork(arcNetworkMode);
    } catch (error) {
      console.error(`Error adding ${selectedArcLabel} to wallet:`, error);
    }
  };

  const handleProfilePictureChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !user?.wallet?.address) return;

    setIsUploadingProfile(true);
    setUploadError(null);

    try {
      const url = await uploadProfilePicture(file, user.wallet.address);
      setProfilePictureUrl(url);
      setProfileImageError(false);
      saveProfileData(user.wallet.address, url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload profile picture";
      setUploadError(errorMessage);
      console.error("Profile picture upload error:", error);
    } finally {
      setIsUploadingProfile(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <>
      <AppErrorModal error={uploadError} onClose={() => setUploadError(null)} title="Upload failed" />
      <div className="text-foreground min-h-screen">
        {/* Token Ticker */}
        <TokenTicker />

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-12">
          {/* Profile Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <h1 className="text-4xl font-bold mb-8">Profile</h1>

          <div className="flex items-center gap-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="relative group"
            >
              <div className="w-24 h-24 rounded-full overflow-hidden bg-linear-to-br from-muted to-secondary border-2 border-border">
                {profilePictureUrl ? (
                  <Image
                    src={profilePictureUrl}
                    alt="Profile"
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    unoptimized={true}
                    onError={() => {
                      console.error("Failed to load profile image:", profilePictureUrl);
                      setProfileImageError(true);
                    }}
                  />
                ) : null}
                {!profilePictureUrl || profileImageError ? (
                  <Image
                    src="/assets/Profile logo.svg"
                    alt="Profile"
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>

              {hasClaimedSquireBadge ? (
                <div className="pointer-events-none absolute -bottom-1 -right-1 z-10">
                  <Image
                    src={badgeClaimedImage}
                    alt="Claimed Squire badge"
                    width={30}
                    height={34}
                    className="h-auto w-[1.65rem] object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.24)]"
                  />
                </div>
              ) : null}

              {/* Upload overlay button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingProfile}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Upload profile picture"
              >
                <motion.div
                  animate={{ opacity: isUploadingProfile ? 1 : 0 }}
                  className="text-foreground text-xs font-semibold text-center px-2"
                >
                  {isUploadingProfile ? "Uploading..." : "Click to upload"}
                </motion.div>
              </button>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleProfilePictureChange}
                disabled={isUploadingProfile}
                className="hidden"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="flex items-center gap-3 mb-2">
                <p className="text-foreground font-semibold">
                  {authenticated ? "Connected" : "Not Connected"}
                </p>
                {displayAddress && (
                  <button
                    onClick={() => {
                      if (user?.wallet?.address) {
                        navigator.clipboard.writeText(user.wallet.address);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }
                    }}
                    className="text-xs text-muted-foreground px-2 py-1 rounded-lg bg-secondary/80 border border-border hover:bg-accent hover:text-foreground active:scale-95 transition-all cursor-pointer outline-none"
                  >
                    {copied ? "Copied!" : displayAddress}
                  </button>
                )}
              </div>

              {!isOnSelectedArc && (
                <div className="mb-3">
                  <button
                    onClick={handleAddArcNetwork}
                    className="text-xs px-3 py-1.5 rounded-lg bg-primary text-black font-semibold hover:opacity-90 transition"
                  >
                    Switch to {selectedArcLabel}
                  </button>
                </div>
              )}

              <h2 className="text-5xl font-bold mb-2">{totalPortfolioValue}</h2>
              <p className="text-green-400 text-sm">
                +0.00% <span className="text-muted-foreground">($0.00)</span>
              </p>
            </motion.div>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mb-8 flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1 sm:gap-4"
        >
          {profileTabs.map((tab) => (
            <motion.button
              key={tab.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleTabChange(tab.id)}
              className={`rounded-lg px-4 py-3 font-medium transition-all sm:px-6 ${
                activeTab === tab.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </motion.button>
          ))}
        </motion.div>

        {/* Content Section */}
        <AnimatePresence mode="wait">
          {activeTab === "positions" && (
            <Positions 
              walletAddress={user?.wallet?.address || null}
              onTotalValueChange={setTotalPortfolioValue}
            />
          )}
          {activeTab === "activities" && (
            <Activities
              isWalletConnected={authenticated}
              walletAddress={user?.wallet?.address || null}
            />
          )}
          {activeTab === "unified" && (
            <div className="w-full max-w-md">
              <UnifiedDeposit />
            </div>
          )}
          {activeTab === "badges" && (
            <Badges
              isWalletConnected={authenticated}
              highlightedBadgeId={activeTab === "badges" ? requestedBadgeId : null}
              onSquireBadgeStatusChange={setSquireBadgeStatus}
              walletAddress={user?.wallet?.address || null}
            />
          )}
        </AnimatePresence>
      </main>
      </div>
    </>
  );
};

const ProfileLoadingFallback = () => (
  <div className="min-h-screen text-foreground">
    <TokenTicker />
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-12 h-52 animate-pulse rounded-3xl bg-muted" />
      <div className="mb-8 h-16 w-fit animate-pulse rounded-xl bg-muted px-40" />
      <div className="h-[24rem] animate-pulse rounded-3xl bg-muted" />
    </main>
  </div>
);

export default function Profile() {
  return (
    <Suspense fallback={<ProfileLoadingFallback />}>
      <ProfileContent />
    </Suspense>
  );
}
