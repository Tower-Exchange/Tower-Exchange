"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  Hash,
  WalletCards,
  X,
} from "lucide-react";
import {
  getExplorerHomeUrl,
  type ActivityDetailsImage,
  type TransactionInfoDetails,
} from "@/lib/activityDetails";
import { SUPPORTED_CHAINS } from "@/lib/bridgeService";
import usdcLogo from "@/public/assets/usdc.svg";
import arcTestnetLogo from "@/public/assets/ARCSvg.svg";
import routeIcon from "@/public/assets/route icon.svg";
import transferTimeIcon from "@/public/assets/transfertime icon.svg";
import synthraLogo from "@/public/assets/synthralogo.svg";
import unitflowLogo from "@/public/assets/unitflow.svg";
import circleLogo from "@/public/assets/circlelogo.svg";
import fromAddressIcon from "@/public/assets/fromaddress icon.svg";
import toAddressIcon from "@/public/assets/toaddress icon.svg";
import towerLogo from "@/public/assets/Tower Logo.svg";
import aeroLogo from "@/public/assets/aero-icon 1.svg";
import kyberLogo from "@/public/assets/kyber-logo-knc 1.svg";
import uniswapLogo from "@/public/assets/Uniswap_icon_pink 1.svg";

type EthereumProvider = {
  request?: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

type TransactionInfoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  details: TransactionInfoDetails | null;
};

const getEthereumProvider = (): EthereumProvider | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as Window & { ethereum?: EthereumProvider }).ethereum;

const getWalletErrorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? (error as { code?: number | string }).code
    : undefined;

const toChainHex = (chainId: number) => `0x${chainId.toString(16)}`;

const formatAddress = (address?: string | null) => {
  if (!address) {
    return "-";
  }

  return address.length > 12
    ? `${address.slice(0, 5)}...${address.slice(-4)}`
    : address;
};

const getRouteLogo = (routeLabel: string): ActivityDetailsImage => {
  const normalizedRouteLabel = routeLabel.toLowerCase();

  if (
    normalizedRouteLabel.includes("aero") ||
    normalizedRouteLabel.includes("aerodrome") ||
    normalizedRouteLabel.includes("slipstream")
  ) {
    return aeroLogo;
  }

  if (
    normalizedRouteLabel.includes("kyber") ||
    normalizedRouteLabel.includes("knc")
  ) {
    return kyberLogo;
  }

  if (
    normalizedRouteLabel.includes("uniswap") ||
    normalizedRouteLabel.includes("uni")
  ) {
    return uniswapLogo;
  }

  if (normalizedRouteLabel.includes("synthra")) {
    return synthraLogo;
  }

  if (normalizedRouteLabel.includes("unitflow")) {
    return unitflowLogo;
  }

  if (normalizedRouteLabel.includes("tower")) {
    return towerLogo;
  }

  if (normalizedRouteLabel.includes("cctp")) {
    return circleLogo;
  }

  return undefined;
};

const HeaderLogo = ({
  icon,
  badgeIcon,
  size = "lg",
}: {
  icon?: ActivityDetailsImage;
  badgeIcon?: ActivityDetailsImage;
  size?: "lg" | "sm";
}) => {
  const dimensions = size === "lg" ? "h-14 w-14" : "h-5 w-5";
  const imageSize = size === "lg" ? 56 : 20;

  return (
    <span
      className={`relative inline-flex ${dimensions} shrink-0 items-center justify-center rounded-full bg-transparent`}
    >
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={imageSize}
          height={imageSize}
          className="h-full w-full object-contain"
        />
      ) : (
        <WalletCards className="h-7 w-7 text-foreground" />
      )}

      {badgeIcon ? (
        <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-[#14181f] bg-card">
          <Image
            src={badgeIcon}
            alt=""
            width={18}
            height={18}
            className="h-full w-full rounded-full object-cover"
          />
        </span>
      ) : null}
    </span>
  );
};

const SmallAsset = ({ icon }: { icon?: ActivityDetailsImage }) => {
  if (!icon) {
    return null;
  }

  return (
    <Image
      src={icon}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 object-contain"
    />
  );
};

const InfoRow = ({
  icon,
  label,
  value,
  valueIcon,
  linkUrl,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  valueIcon?: ActivityDetailsImage;
  linkUrl?: string | null;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="flex min-w-0 items-center gap-2 text-[0.95rem] font-medium text-foreground">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </div>

    {linkUrl ? (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#8fc8ff] underline decoration-[#8fc8ff]/60 underline-offset-2 transition-colors hover:text-foreground"
      >
        View Transaction
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    ) : (
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 text-right text-[0.95rem] font-medium text-foreground">
        <span className="truncate">{value || "-"}</span>
        <SmallAsset icon={valueIcon} />
      </div>
    )}
  </div>
);

const AddAssetButton = ({
  label,
  primaryIcon,
  badgeIcon,
  onClick,
}: {
  label: string;
  primaryIcon: ActivityDetailsImage;
  badgeIcon?: ActivityDetailsImage;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/45 hover:bg-accent bg-secondary"
  >
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <SmallAsset icon={primaryIcon} />
      {badgeIcon ? (
        <span className="absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-full border border-[#1b1f28] bg-card">
          <Image
            src={badgeIcon}
            alt=""
            width={14}
            height={14}
            className="h-full w-full rounded-full object-cover"
          />
        </span>
      ) : null}
    </span>
    {label}
  </button>
);

const RouteValue = ({ routeLabel }: { routeLabel: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="truncate">{routeLabel}</span>
    <SmallAsset icon={getRouteLogo(routeLabel)} />
  </span>
);

const TransactionInfoModal = ({
  isOpen,
  onClose,
  details,
}: TransactionInfoModalProps) => {
  const [chainAddRequired, setChainAddRequired] = useState(false);
  const [walletActionError, setWalletActionError] = useState<string | null>(null);

  const destinationChainConfig = useMemo(() => {
    if (!details?.destinationChainId) {
      return null;
    }

    return SUPPORTED_CHAINS[
      details.destinationChainId as keyof typeof SUPPORTED_CHAINS
    ];
  }, [details?.destinationChainId]);

  useEffect(() => {
    setChainAddRequired(false);
    setWalletActionError(null);
  }, [details?.id]);

  if (!details) {
    return null;
  }

  const destinationValue = details.destinationAmount
    ? `${details.destinationAmount} ${details.destinationToken}`
    : details.destinationToken;
  const sourceValue = details.sourceAmount
    ? `${details.sourceAmount} ${details.sourceToken}`
    : details.sourceToken;
  const destinationExplorerHomeUrl = getExplorerHomeUrl(
    details.destinationNetworkName,
  );

  const getAddChainParams = () => {
    if (!destinationChainConfig) {
      return null;
    }

    return {
      chainId: toChainHex(destinationChainConfig.chainId),
      chainName: destinationChainConfig.name,
      nativeCurrency: {
        name: destinationChainConfig.nativeTokenSymbol,
        symbol: destinationChainConfig.nativeTokenSymbol,
        decimals: 18,
      },
      rpcUrls: [destinationChainConfig.rpcUrl],
      ...(destinationExplorerHomeUrl
        ? { blockExplorerUrls: [destinationExplorerHomeUrl] }
        : {}),
    };
  };

  const handleAddDestinationChain = async () => {
    const ethereum = getEthereumProvider();
    const addChainParams = getAddChainParams();

    if (!ethereum?.request || !addChainParams) {
      setWalletActionError("Wallet provider is not available.");
      return;
    }

    try {
      setWalletActionError(null);
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [addChainParams],
      });
      setChainAddRequired(false);
    } catch (error) {
      console.error("Error adding destination chain:", error);
      setWalletActionError("Unable to add the destination chain.");
    }
  };

  const handleAddDestinationUsdc = async () => {
    const ethereum = getEthereumProvider();

    if (!ethereum?.request || !destinationChainConfig || !details.destinationUsdcAddress) {
      setWalletActionError("Destination token details are not available.");
      return;
    }

    try {
      setWalletActionError(null);
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: toChainHex(destinationChainConfig.chainId) }],
      });
      setChainAddRequired(false);

      await ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: details.destinationUsdcAddress,
            symbol: "USDC",
            decimals: 6,
            image:
              typeof window === "undefined"
                ? undefined
                : new URL(usdcLogo.src, window.location.origin).toString(),
          },
        },
      });
    } catch (error) {
      const code = getWalletErrorCode(error);
      if (code === 4902 || code === "4902") {
        setChainAddRequired(true);
        setWalletActionError(
          `Add ${destinationChainConfig.name} before adding USDC.`,
        );
        return;
      }

      console.error("Error adding destination USDC:", error);
      setWalletActionError("Unable to add USDC to your wallet.");
    }
  };

  const showBridgeWalletActions =
    details.kind === "bridge" &&
    details.destinationToken.toUpperCase() === "USDC" &&
    Boolean(destinationChainConfig && details.destinationUsdcAddress);

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[91] flex items-center justify-center px-4 py-6"
          >
            <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-[31rem] overflow-y-auto rounded-[28px] border border-[#263243] bg-card px-5 pb-7 pt-8 shadow-2xl sm:px-7">
              <button
                type="button"
                onClick={onClose}
                className="absolute right-6 top-6 inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
                aria-label="Close transaction info"
              >
                <X className="h-6 w-6" />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex min-h-14 items-center justify-center gap-4">
                  <HeaderLogo
                    icon={details.sourceTokenIcon}
                    badgeIcon={details.sourceChainIcon}
                  />
                  <ArrowRight className="h-6 w-6 text-foreground" />
                  <HeaderLogo
                    icon={details.destinationTokenIcon}
                    badgeIcon={details.destinationChainIcon}
                  />
                </div>

                <h2 className="max-w-full truncate whitespace-nowrap text-[0.95rem] font-semibold leading-tight text-foreground sm:text-[1.45rem]">
                  {details.title}
                </h2>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {details.subtitle}
                </p>

                <div className="mt-6 rounded-full bg-muted px-7 py-2 text-sm font-semibold text-foreground">
                  {details.kind === "bridge" ? "Bridge Info" : "Swap Info"}
                </div>
              </div>

              <div className="mt-7 rounded-[28px] border border-border bg-card px-5 py-6">
                <div className="space-y-5">
                  {details.kind === "swap" ? (
                    <>
                      <InfoRow
                        icon={<SmallAsset icon={arcTestnetLogo} />}
                        label={`From ${details.sourceNetworkName}`}
                        value={sourceValue}
                        valueIcon={details.sourceTokenIcon}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={arcTestnetLogo} />}
                        label={`To ${details.destinationNetworkName}`}
                        value={destinationValue}
                        valueIcon={details.destinationTokenIcon}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={routeIcon} />}
                        label="Route"
                        value={<RouteValue routeLabel={details.routeLabel} />}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={transferTimeIcon} />}
                        label="Transfer Time"
                        value="~ 2 min"
                      />
                    </>
                  ) : (
                    <>
                      <InfoRow
                        icon={<SmallAsset icon={details.sourceChainIcon} />}
                        label={`From ${details.sourceNetworkName}`}
                        value={details.sourceToken}
                        valueIcon={details.sourceTokenIcon}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={details.destinationChainIcon} />}
                        label={`To ${details.destinationNetworkName}`}
                        value={destinationValue}
                        valueIcon={details.destinationTokenIcon}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={routeIcon} />}
                        label="Via"
                        value={<RouteValue routeLabel={details.routeLabel} />}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={fromAddressIcon} />}
                        label="From Address"
                        value={formatAddress(details.sourceAddress)}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={toAddressIcon} />}
                        label="To Address"
                        value={formatAddress(details.destinationAddress)}
                      />
                      <InfoRow
                        icon={<SmallAsset icon={transferTimeIcon} />}
                        label="Transfer Time"
                        value="~ 2 min"
                      />
                    </>
                  )}

                  <InfoRow
                    icon={<Hash className="h-4 w-4" />}
                    label="Transaction Hash"
                    linkUrl={details.transactionUrl}
                  />
                </div>
              </div>

              {showBridgeWalletActions ? (
                <div className="mt-7 flex flex-col items-center gap-3">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <AddAssetButton
                      label="Add USDC"
                      primaryIcon={usdcLogo}
                      badgeIcon={details.destinationChainIcon}
                      onClick={handleAddDestinationUsdc}
                    />
                    {chainAddRequired && destinationChainConfig ? (
                      <AddAssetButton
                        label={`Add ${destinationChainConfig.name}`}
                        primaryIcon={details.destinationChainIcon}
                        onClick={handleAddDestinationChain}
                      />
                    ) : null}
                  </div>
                  {walletActionError ? (
                    <p className="max-w-[21rem] text-center text-xs text-amber-300">
                      {walletActionError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
};

export default TransactionInfoModal;
