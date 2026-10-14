"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { X, Search, ChevronDown, Check } from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import { getSupportedTokens, type SupportedToken } from "@/lib/bridgeService";
import {
  type BridgeNetworkMode,
  DEFAULT_BRIDGE_CHAIN,
  getBridgeNetworkMode,
  readStoredBridgeNetworkMode,
  remapChainForNetwork,
} from "@/lib/bridgeNetworks";
import { getBridgeSelectChains } from "@/lib/bridgeChainUi";
import {
  isBridgeChainEnabled,
  isEvmBridgeEnabled,
  isSolanaBridgeEnabled,
} from "@/lib/bridgeEnabled";
import { useTowerNetworkMode } from "@/lib/hooks/useTowerNetworkMode";

type Chain = {
  id: string;
  name: string;
  badge?: string;
  color: string;
  logo?: StaticImageData | string;
};

const getInitialNetworkMode = (): BridgeNetworkMode =>
  readStoredBridgeNetworkMode();

export default function BridgeSelectContent() {
  if (!isEvmBridgeEnabled() && !isSolanaBridgeEnabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Bridging is temporarily unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            EVM and Solana bridges are currently disabled.
          </p>
        </div>
      </main>
    );
  }

  return <EnabledBridgeSelectContent />;
}

function EnabledBridgeSelectContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const side = searchParams.get("side") === "to" ? "to" : "from";
  const oppositeSide = side === "to" ? "from" : "to";
  const [networkMode, setLocalNetworkMode] = useState<BridgeNetworkMode>(() =>
    getInitialNetworkMode(),
  );
  const {
    mode: storedNetworkMode,
    isReady: isNetworkModeReady,
  } = useTowerNetworkMode();
  const chains = useMemo(
    () => getBridgeSelectChains(networkMode) as Chain[],
    [networkMode],
  );
  const oppositeChainId = remapChainForNetwork(
    searchParams.get(`${oppositeSide}Chain`),
    networkMode,
  );
  const oppositeTokenSymbol = searchParams.get(`${oppositeSide}Token`);
  const oppositeSelectionLabel = side === "to" ? "source" : "destination";

  const [chainSearch, setChainSearch] = useState("");
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokens, setTokens] = useState<SupportedToken[]>([]);
  const [selectedChainId, setSelectedChainId] = useState<string>(() => {
    const currentChainId = searchParams.get(`${side}Chain`);
    const mode = getInitialNetworkMode();
    const remapped = remapChainForNetwork(currentChainId, mode);
    if (remapped && remapped !== "all" && isBridgeChainEnabled(remapped)) {
      return remapped;
    }
    return (
      getBridgeSelectChains(mode).find((chain) => chain.id !== "all")?.id ??
      DEFAULT_BRIDGE_CHAIN[mode]
    );
  });
  const [isChainModalOpen, setIsChainModalOpen] = useState(false);

  useEffect(() => {
    if (!isNetworkModeReady || storedNetworkMode === networkMode) {
      return;
    }

    setLocalNetworkMode(storedNetworkMode);
    setSelectedChainId((previous) => {
      if (previous === "all") {
        return previous;
      }

      const remapped = remapChainForNetwork(previous, storedNetworkMode);
      return remapped && isBridgeChainEnabled(remapped)
        ? remapped
        : getBridgeSelectChains(storedNetworkMode).find(
            (chain) => chain.id !== "all",
          )?.id ?? DEFAULT_BRIDGE_CHAIN[storedNetworkMode];
    });
  }, [isNetworkModeReady, networkMode, storedNetworkMode]);

  // Fetch supported tokens for the selected chain
  useEffect(() => {
    const fetchTokens = async () => {
      try {
        const supportedTokens = getSupportedTokens(
          selectedChainId === "all" ? undefined : selectedChainId,
        );
        if (selectedChainId === "all") {
          setTokens(
            supportedTokens.map((token) => ({
              ...token,
              chains: token.chains.filter(
                (chainId) =>
                  getBridgeNetworkMode(chainId) === networkMode &&
                  isBridgeChainEnabled(chainId),
              ),
              chainAddresses: Object.fromEntries(
                Object.entries(token.chainAddresses).filter(
                  ([chainId]) =>
                    getBridgeNetworkMode(chainId) === networkMode &&
                    isBridgeChainEnabled(chainId),
                ),
              ),
            })),
          );
          return;
        }
        setTokens(supportedTokens);
      } catch (error) {
        console.error("Failed to fetch tokens:", error);
        setTokens([]);
      }
    };

    fetchTokens();
  }, [networkMode, selectedChainId]);

  const closeSelect = useCallback(() => {
    const mode = readStoredBridgeNetworkMode();
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.delete("side");
    current.set("network", mode);

    const remappedFrom = remapChainForNetwork(current.get("fromChain"), mode);
    const remappedTo = remapChainForNetwork(current.get("toChain"), mode);

    if (remappedFrom && remappedFrom !== "all") {
      current.set("fromChain", remappedFrom);
    } else {
      current.delete("fromChain");
    }

    if (remappedTo && remappedTo !== "all") {
      current.set("toChain", remappedTo);
    } else {
      current.delete("toChain");
    }

    router.push(`/bridge?${current.toString()}`);
  }, [router, searchParams]);

  const title = useMemo(
    () => (side === "to" ? "Exchange to" : "Exchange from"),
    [side]
  );

  const visibleChains = useMemo(() => {
    const query = chainSearch.toLowerCase().trim();
    if (!query) return chains;
    return chains.filter((chain) =>
      chain.name.toLowerCase().includes(query)
    );
  }, [chainSearch, chains]);

  const selectedChain = useMemo(() => {
    return chains.find((chain) => chain.id === selectedChainId) ??
      chains[1];
  }, [chains, selectedChainId]);

  const filteredTokens = useMemo(() => {
    const q = tokenSearch.toLowerCase().trim();
    if (!q) return tokens;
    return tokens.filter((token) => {
      const addressMatches = Object.values(token.chainAddresses).some((addr) =>
        addr.toLowerCase().includes(q)
      );
      return (
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        addressMatches
      );
    });
  }, [tokenSearch, tokens]);

  const isSameAsOppositeChain = (chainId: string) =>
    chainId !== "all" && chainId === oppositeChainId;

  const isSameAsOppositeSide = (token: SupportedToken) =>
    selectedChainId !== "all" &&
    selectedChainId === oppositeChainId &&
    token.symbol.toLowerCase() === (oppositeTokenSymbol ?? "").toLowerCase();

  return (
    <main className="flex-1 flex items-center justify-center py-10 px-4 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-4xl rounded-3xl border border-border/70 bg-[#101113] shadow-2xl overflow-hidden flex"
      >
        {/* Left: chain list */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border/70 bg-[#101113] h-screen max-h-screen">
          <div className="px-4 py-4 border-b border-border/60 space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={chainSearch}
                onChange={(e) => setChainSearch(e.target.value)}
                placeholder="Search Network"
                className="w-full rounded-xl bg-card pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 border border-transparent focus:border-border outline-none"
              />
            </div>
          </div>

          <div className="px-4 py-3 text-xs text-muted-foreground uppercase tracking-wide">
            Top Chains
          </div>

          <div className="relative flex-1">
            <div className="absolute inset-0 overflow-y-auto pr-2 scroll-smooth [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#101113] [&::-webkit-scrollbar-thumb]:bg-[#232428] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-[#2a2c31]">
              {visibleChains.length === 0 ? (
                <p className="px-4 py-8 text-xs text-muted-foreground">
                  Chain not found
                </p>
              ) : (
                <div className="pb-16">
                  {visibleChains.map((chain) => {
                    const isUnavailable = isSameAsOppositeChain(chain.id);

                    return (
                      <button
                        key={chain.id}
                        type="button"
                        disabled={isUnavailable}
                        aria-disabled={isUnavailable}
                        onClick={() => {
                          if (isUnavailable) {
                            return;
                          }

                          setSelectedChainId(chain.id);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                          isUnavailable
                            ? "cursor-not-allowed text-muted-foreground/60 opacity-60"
                            : selectedChainId === chain.id
                              ? "bg-primary/20 text-primary font-semibold"
                              : "text-foreground/80 hover:bg-[#181d26] hover:text-foreground"
                        }`}
                      >
                        <span className="inline-flex h-5 w-5 rounded-full overflow-hidden bg-[#232428]">
                          {chain.logo ? (
                            <Image
                              src={chain.logo}
                              alt={`${chain.name} logo`}
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : (
                            <span
                              className="inline-flex h-full w-full rounded-full"
                              style={{ backgroundColor: chain.color }}
                            />
                          )}
                        </span>
                        <span>{chain.name}</span>
                        {selectedChainId === chain.id && !isUnavailable && (
                          <Check className="ml-auto h-4 w-4 text-primary shrink-0" />
                        )}
                        {isUnavailable && (
                          <span className="ml-auto text-sm capitalize shrink-0">
                            {oppositeSelectionLabel}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fixed Footer */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#101113] to-transparent pt-4 pb-2 px-4 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {selectedChain.name}
              </p>
            </div>
          </div>
        </aside>

        {/* Right: token list */}
        <section className="flex flex-1 flex-col bg-[#101113]">
          <header className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-foreground">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeSelect}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-card hover:bg-[#202225] text-muted-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Mobile chain selector */}
          <div className="md:hidden px-5 py-3 border-b border-border/60 space-y-3">
            <button
              type="button"
              onClick={() => setIsChainModalOpen(true)}
              className="flex w-full items-center justify-between rounded-xl bg-card px-3 py-2.5 text-left hover:bg-[#202225] transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 rounded-full overflow-hidden bg-[#232428]">
                  {selectedChain.logo ? (
                    <Image
                      src={selectedChain.logo}
                      alt={`${selectedChain.name} logo`}
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="inline-flex h-full w-full rounded-full"
                      style={{ backgroundColor: selectedChain.color }}
                    />
                  )}
                </span>
                <span className="text-xs font-medium text-foreground">
                  {selectedChain.name}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Search input */}
          <div className="px-5 py-4 border-b border-border/60">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={tokenSearch}
                onChange={(e) => setTokenSearch(e.target.value)}
                placeholder="search token name or paste address"
                className="w-full rounded-xl bg-card pl-9 pr-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 border border-transparent focus:border-border outline-none"
              />
            </div>
          </div>

          {/* Token list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {filteredTokens.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Token not found
              </p>
            ) : (
              filteredTokens.map((token) => {
                const isUnavailable = isSameAsOppositeSide(token);

                return (
                  <button
                    key={token.symbol}
                    type="button"
                    disabled={isUnavailable}
                    aria-disabled={isUnavailable}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${
                      isUnavailable
                        ? "cursor-not-allowed opacity-45"
                        : "hover:bg-card"
                    }`}
                    onClick={() => {
                      if (isUnavailable) {
                        return;
                      }

                      const current = new URLSearchParams(
                        Array.from(searchParams.entries())
                      );
                      current.set(`${side}Token`, token.symbol);
                      current.set("network", networkMode);
                      let nextChainId = selectedChainId;
                      if (
                        nextChainId === "all" &&
                        token.symbol !== "USDC"
                      ) {
                        nextChainId =
                          token.chains.find(
                            (chainId) =>
                              getBridgeNetworkMode(chainId) === networkMode &&
                              chainId !== oppositeChainId,
                          ) || DEFAULT_BRIDGE_CHAIN[networkMode];
                      } else if (
                        nextChainId !== "all" &&
                        !token.chainAddresses[nextChainId]
                      ) {
                        nextChainId =
                          token.chains.find(
                            (chainId) =>
                              getBridgeNetworkMode(chainId) === networkMode &&
                              chainId !== oppositeChainId,
                          ) || DEFAULT_BRIDGE_CHAIN[networkMode];
                      }
                      if (nextChainId) {
                        current.set(`${side}Chain`, nextChainId);
                      }
                      if (
                        oppositeChainId &&
                        oppositeChainId !== "all" &&
                        !token.chainAddresses[oppositeChainId]
                      ) {
                        const remappedOpposite = token.chains.find(
                          (chainId) =>
                            getBridgeNetworkMode(chainId) === networkMode &&
                            chainId !== nextChainId,
                        );
                        if (remappedOpposite) {
                          current.set(`${oppositeSide}Chain`, remappedOpposite);
                        } else {
                          current.delete(`${oppositeSide}Chain`);
                        }
                      } else if (oppositeChainId) {
                        current.set(`${oppositeSide}Chain`, oppositeChainId);
                      }
                      router.push(`/bridge?${current.toString()}`);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#232428] overflow-hidden">
                        {token.logo ? (
                          <Image
                            src={token.logo}
                            alt={`${token.symbol} logo`}
                            width={32}
                            height={32}
                            className="h-8 w-8 object-contain"
                          />
                        ) : (
                          <span className="text-xs font-semibold text-foreground">
                            {token.symbol[0]}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {token.symbol}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {token.name}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-xs ${
                        isUnavailable
                          ? "text-muted-foreground"
                          : "font-semibold text-zinc-300"
                      }`}
                    >
                      {isUnavailable
                        ? side === "to"
                          ? "Selected as source"
                          : "Selected as destination"
                        : selectedChainId && selectedChainId !== "all"
                          ? (token.chainAddresses[selectedChainId] || "N/A").slice(0, 6) +
                            "..." +
                            (token.chainAddresses[selectedChainId] || "N/A").slice(-4)
                          : "Multiple"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </motion.div>

      {isChainModalOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex items-end bg-black/60 backdrop-blur-sm"
          onClick={() => setIsChainModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="w-full max-h-[80vh] rounded-t-3xl border border-border/70 bg-[#14181f] shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-[#14181f]">
              <h2 className="text-sm font-semibold text-foreground">
                Select Network
              </h2>
              <button
                type="button"
                onClick={() => setIsChainModalOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1c222e] hover:bg-[#252d3d] text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-border/50 bg-[#14181f]">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Search className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={chainSearch}
                  onChange={(e) => setChainSearch(e.target.value)}
                  placeholder="Search Network"
                  className="w-full rounded-xl bg-[#1c222e] pl-9 pr-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 border border-border/40 focus:border-primary/50 outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pb-4 bg-[#14181f]">
              {visibleChains.length === 0 ? (
                <p className="px-5 py-8 text-xs text-muted-foreground">
                  Chain not found
                </p>
              ) : (
                visibleChains.map((chain) => {
                  const isUnavailable = isSameAsOppositeChain(chain.id);
                  const isSelected = selectedChainId === chain.id;

                  return (
                    <button
                      key={chain.id}
                      type="button"
                      disabled={isUnavailable}
                      aria-disabled={isUnavailable}
                      onClick={() => {
                        if (isUnavailable) {
                          return;
                        }

                        setSelectedChainId(chain.id);
                        setIsChainModalOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 px-5 py-3 text-sm text-left transition-colors ${
                        isUnavailable
                          ? "cursor-not-allowed text-muted-foreground/60 opacity-60"
                          : isSelected
                            ? "bg-primary/20 text-primary font-semibold"
                            : "text-foreground/80 hover:bg-[#1a202b] hover:text-foreground"
                      }`}
                    >
                      <span className="inline-flex h-5 w-5 rounded-full overflow-hidden bg-[#232428]">
                        {chain.logo ? (
                          <Image
                            src={chain.logo}
                            alt={`${chain.name} logo`}
                            width={20}
                            height={20}
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <span
                            className="inline-flex h-full w-full rounded-full"
                            style={{ backgroundColor: chain.color }}
                          />
                        )}
                      </span>
                      <span>{chain.name}</span>
                      {isSelected && !isUnavailable && (
                        <Check className="ml-auto h-4 w-4 text-primary shrink-0" />
                      )}
                      {isUnavailable && (
                        <span className="ml-auto text-sm capitalize shrink-0">
                          {oppositeSelectionLabel}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </main>
  );
}
