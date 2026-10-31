"use client";

import { useEffect, useMemo, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { fetchActivitiesByWallet, type ActivityRow } from "@/lib/supabase";
import { getTokenIcon } from "@/lib/tokenIcons";
import { getChainLogoByName } from "@/lib/chains";
import arcLogo from "@/public/assets/ARCSvg.svg";
import TransactionInfoModal from "@/components/TransactionInfoModal";
import {
  buildTransactionInfoDetails,
  type TransactionInfoDetails,
} from "@/lib/activityDetails";

type ActivityIcon = StaticImageData | string | null | undefined;

export type ActivityTabLiveItem = {
  id: string;
  kind: "swap" | "bridge";
  title: string;
  routeLabel: string;
  statusLabel: string;
  status: "processing" | "successful" | "pending" | "failed";
  progress?: number;
  timestamp: number | string;
  sourceIcon?: ActivityIcon;
  targetIcon?: ActivityIcon;
  sourceChainIcon?: ActivityIcon;
  targetChainIcon?: ActivityIcon;
  transactionHash?: string | null;
  details?: TransactionInfoDetails | null;
  onClick?: () => void;
};

type ActivityTabModalProps = {
  isOpen: boolean;
  onClose: () => void;
  isWalletConnected: boolean;
  walletAddress?: string | null;
  liveItems?: ActivityTabLiveItem[];
};

type ActivityTabItem = ActivityTabLiveItem & {
  searchText: string;
};

const formatAmount = (amount: number | null) => {
  if (amount === null || !Number.isFinite(amount)) {
    return "";
  }

  return amount.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
};

const formatTimeAgo = (timestamp: number | string) => {
  const date = typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (elapsedSeconds < 60) {
    return `${Math.max(elapsedSeconds, 1)} sec${elapsedSeconds === 1 ? "" : "s"} ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min${elapsedMinutes === 1 ? "" : "s"} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hr${elapsedHours === 1 ? "" : "s"} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
};

const getDbRouteLabel = (row: ActivityRow) => {
  if (/stable\s*fx/i.test(row.type)) {
    return "Circle StableFX";
  }

  if (row.type.toLowerCase().includes("bridge")) {
    return "CCTP (Fast)";
  }

  const routeFromType =
    row.type.match(/(?:via|route)\s+(.+)$/i)?.[1] ||
    row.type.match(/swap\s*[-:]\s*(.+)$/i)?.[1];

  return routeFromType?.trim() || "Swap";
};

const getDbStatus = (status: ActivityRow["status"]): ActivityTabLiveItem["status"] => {
  if (status === "Successful") {
    return "successful";
  }

  if (status === "Pending") {
    return "pending";
  }

  return "failed";
};

const getDbStatusLabel = (row: ActivityRow) => {
  const label = /stable\s*fx/i.test(row.type)
    ? "StableFX"
    : row.type.toLowerCase().includes("bridge")
      ? "Bridge"
      : "Swap";

  if (row.status === "Successful") {
    return `${label} Successful`;
  }

  if (row.status === "Pending") {
    return `${label} Pending`;
  }

  return `${label} Failed`;
};

const rowToActivityItem = (row: ActivityRow): ActivityTabItem => {
  const isBridge = row.type.toLowerCase().includes("bridge");
  const isStableFx = /stable\s*fx/i.test(row.type);
  const kind: ActivityTabLiveItem["kind"] = isBridge ? "bridge" : "swap";
  const sourceToken = row.source_currency_ticker;
  const destinationToken = row.destination_currency_ticker || "";
  const amount = formatAmount(row.amount);
  const title = isBridge
    ? `Bridge ${amount ? `${amount} ` : ""}${sourceToken}`
    : isStableFx
      ? `StableFX ${amount ? `${amount} ` : ""}${sourceToken}${
          destinationToken ? ` to ${destinationToken}` : ""
        }`
    : `Swap ${amount ? `${amount} ` : ""}${sourceToken}${
        destinationToken ? ` to ${destinationToken}` : ""
      }`;
  const sourceChainIcon = getChainLogoByName(row.source_network_name) ?? arcLogo;
  const targetChainIcon = row.destination_network_name
    ? getChainLogoByName(row.destination_network_name) ?? arcLogo
    : arcLogo;
  const details = buildTransactionInfoDetails(row);

  return {
    id: row.id,
    kind,
    title,
    routeLabel: getDbRouteLabel(row),
    status: getDbStatus(row.status),
    statusLabel: getDbStatusLabel(row),
    progress: row.status === "Pending" ? 58 : row.status === "Successful" ? 100 : 0,
    timestamp: row.timestamp,
    sourceIcon: getTokenIcon(sourceToken),
    targetIcon: destinationToken ? getTokenIcon(destinationToken) : null,
    sourceChainIcon,
    targetChainIcon,
    transactionHash: row.transaction_hash,
    details,
    searchText: [
      row.type,
      sourceToken,
      destinationToken,
      row.source_network_name,
      row.destination_network_name,
      row.transaction_hash,
      getDbRouteLabel(row),
      row.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
};

const IconBubble = ({ icon, size = "md" }: { icon?: ActivityIcon; size?: "md" | "sm" }) => {
  const className = size === "md" ? "h-8 w-8" : "h-5 w-5";

  return (
    <span
      className={`inline-flex ${className} shrink-0 items-center justify-center overflow-hidden rounded-full bg-transparent`}
    >
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={size === "md" ? 32 : 20}
          height={size === "md" ? 32 : 20}
          className="h-full w-full object-contain"
        />
      ) : (
        <CircleDollarSign className="h-full w-full text-primary" />
      )}
    </span>
  );
};

const StatusPill = ({ item }: { item: ActivityTabItem }) => {
  if (item.status === "successful") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-[#1dd75f] text-foreground">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        {item.statusLabel}
      </span>
    );
  }

  if (item.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
        <XCircle className="h-3 w-3 text-red-400" />
        {item.statusLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      {item.statusLabel}
    </span>
  );
};

const ActivityCard = ({
  item,
  onOpenDetails,
}: {
  item: ActivityTabItem;
  onOpenDetails: (details: TransactionInfoDetails) => void;
}) => {
  const isClickableProcessing = item.status === "processing" && item.onClick;
  const isClickableDetails = item.status !== "processing" && item.details;
  const isClickableFallback =
    item.status !== "processing" && item.onClick && item.transactionHash;
  const handleClick = () => {
    if (isClickableProcessing) {
      item.onClick?.();
      return;
    }

    if (item.details) {
      onOpenDetails(item.details);
      return;
    }

    item.onClick?.();
  };
  const cardContent = (
    <>
      <div className="mb-5 flex items-start justify-between gap-3">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-foreground">
          {formatTimeAgo(item.timestamp)}
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate rounded-full bg-muted px-3 py-1 text-xs text-foreground">
            {item.routeLabel}
          </span>
          {item.kind === "bridge" ? (
            <span className="flex shrink-0 items-center -space-x-1.5">
              {item.sourceChainIcon ? (
                <span className="inline-flex rounded-full bg-card ring-2 ring-[#14181f]">
                  <IconBubble icon={item.sourceChainIcon} size="sm" />
                </span>
              ) : null}
              <span className="inline-flex rounded-full bg-card ring-2 ring-[#14181f]">
                <IconBubble
                  icon={item.targetChainIcon || item.sourceChainIcon}
                  size="sm"
                />
              </span>
            </span>
          ) : (
            <IconBubble icon={item.targetChainIcon || item.sourceChainIcon} size="sm" />
          )}
        </div>
      </div>

      <div className="mb-5 flex min-w-0 items-center gap-2">
        <IconBubble icon={item.sourceIcon} />
        {item.kind === "swap" ? (
          <>
            <ArrowRight className="h-4 w-4 shrink-0 text-foreground" />
            <IconBubble icon={item.targetIcon} />
          </>
        ) : null}
        <h3 className="min-w-0 truncate text-lg font-semibold text-foreground">
          {item.title}
        </h3>
      </div>

      {item.status === "processing" || item.status === "pending" ? (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(Math.max(item.progress ?? 0, 6), 100)}%` }}
            transition={{ duration: 0.35 }}
            className="h-full rounded-full bg-primary"
          />
        </div>
      ) : null}

      <StatusPill item={item} />
    </>
  );

  if (isClickableProcessing || isClickableDetails || isClickableFallback) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="w-full rounded-lg border border-border bg-card px-5 py-5 text-left transition-colors hover:border-primary/45"
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-5">
      {cardContent}
    </div>
  );
};

const ActivityTabModal = ({
  isOpen,
  onClose,
  isWalletConnected,
  walletAddress,
  liveItems = [],
}: ActivityTabModalProps) => {
  const [activities, setActivities] = useState<ActivityTabItem[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDetails, setSelectedDetails] =
    useState<TransactionInfoDetails | null>(null);

  useEffect(() => {
    if (!isOpen || !isWalletConnected || !walletAddress) {
      setActivities([]);
      return;
    }

    let isMounted = true;
    const normalizedWalletAddress = walletAddress.toLowerCase();

    const fetchActivities = async () => {
      setIsLoading(true);
      const { data, error, success } = await fetchActivitiesByWallet(
        normalizedWalletAddress,
        { limit: 30 },
      );

      if (!isMounted) {
        return;
      }

      if (!success || error) {
        console.error("Error fetching activity tab rows:", error);
        setActivities([]);
      } else {
        setActivities((data || []).map((row) => rowToActivityItem(row as ActivityRow)));
      }

      setIsLoading(false);
    };

    fetchActivities();

    const pollId = window.setInterval(() => {
      void fetchActivities();
    }, 8000);

    return () => {
      isMounted = false;
      window.clearInterval(pollId);
    };
  }, [isOpen, isWalletConnected, walletAddress]);

  const liveActivityItems = useMemo<ActivityTabItem[]>(
    () =>
      liveItems.map((item) => ({
        ...item,
        searchText: [
          item.kind,
          item.title,
          item.routeLabel,
          item.statusLabel,
          item.transactionHash,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [liveItems],
  );

  const visibleItems = useMemo(() => {
    const liveHashes = new Set(
      liveActivityItems
        .map((item) => item.transactionHash?.toLowerCase())
        .filter(Boolean),
    );
    const combined = [
      ...liveActivityItems,
      ...activities.filter(
        (item) =>
          !item.transactionHash ||
          !liveHashes.has(item.transactionHash.toLowerCase()),
      ),
    ];
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return combined;
    }

    return combined.filter((item) => item.searchText.includes(normalizedQuery));
  }, [activities, liveActivityItems, query]);

  const modalBody = (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-xl font-medium text-foreground">Activity Tab</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
          aria-label="Close activity tab"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <label className="mb-5 flex h-12 items-center gap-3 rounded-lg border border-border bg-transparent px-4 text-sm text-muted-foreground focus-within:border-primary/50">
        <Search className="h-4 w-4 shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="search by token hash/symbol/chain"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="max-h-[calc(88vh-12rem)] space-y-5 overflow-y-auto pr-1 sm:max-h-[calc(92vh-12rem)]">
        {isLoading && visibleItems.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading activities...
          </div>
        ) : visibleItems.length > 0 ? (
          visibleItems.map((item) => (
            <ActivityCard
              key={item.id}
              item={item}
              onOpenDetails={setSelectedDetails}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border py-16 text-center">
            {!isWalletConnected ? (
              <div className="mb-5">
                <Image
                  src="/assets/empty state icon.svg"
                  alt="No wallet connected"
                  width={80}
                  height={80}
                  className="h-20 w-20"
                />
              </div>
            ) : null}
            <p className="text-base font-medium text-foreground">
              {isWalletConnected ? "No History" : "Connect wallet"}
            </p>
            <p className="mt-2 max-w-[18rem] text-sm text-muted-foreground/80">
              {isWalletConnected
                ? "Your swaps, StableFX trades, and bridges will appear here."
                : "Connect your wallet to view activity."}
            </p>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <TransactionInfoModal
        isOpen={Boolean(selectedDetails)}
        onClose={() => setSelectedDetails(null)}
        details={selectedDetails}
      />
      <AnimatePresence>
        {isOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              transition={{ duration: 0.22 }}
              className="fixed inset-0 z-[71] hidden items-center justify-center px-4 py-8 sm:flex"
            >
              <div className="flex max-h-[min(92vh,58rem)] w-full max-w-[30.5rem] flex-col rounded-[28px] bg-card px-7 py-7 shadow-2xl">
                {modalBody}
              </div>
            </motion.div>

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed inset-x-0 bottom-0 z-[71] max-h-[88vh] rounded-t-[28px] bg-card px-5 pb-6 pt-6 shadow-2xl sm:hidden"
            >
              <div className="max-h-[calc(88vh-3rem)] overflow-hidden">
                {modalBody}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
};

export default ActivityTabModal;
