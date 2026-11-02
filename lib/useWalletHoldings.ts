import { useState, useEffect } from "react";
import type { StaticImageData } from "next/image";

import { getTokenIcon } from "./tokenIcons";
import { fetchArcTokenUsdPrices } from "./tokenUsdPrices";
import { AERO_MAINNET_TOKENS } from "./aeroDex";
import { STABLEFX_ARC_MAINNET_TOKENS } from "./stableFx";

export interface WalletHolding {
  token: string;
  icon: StaticImageData | null;
  balance: string;
  price: string;
  value: string;
  rawBalance: number;
}

const SUPPORTED_PROFILE_TOKENS = [
  { symbol: "EURC", address: AERO_MAINNET_TOKENS.EURC },
  { symbol: "cirBTC", address: AERO_MAINNET_TOKENS.cirBTC },
  // USDC is already represented by Arc's native balance above and EURC is
  // already included through the DEX registry. MXNB is the currently enabled
  // StableFX-only asset, so include its direct Arc contract balance here.
  { symbol: "MXNB", address: STABLEFX_ARC_MAINNET_TOKENS.MXNB.address },
] as const;

export const useWalletHoldings = (walletAddress: string | null) => {
  const [holdings, setHoldings] = useState<WalletHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setHoldings([]);
      return;
    }

    const fetchHoldings = async () => {
      setLoading(true);
      setError(null);
      try {
        const holdingsChainId = "arc";
        const fetchBalance = async ({
          tokenAddress,
          balanceType,
        }: {
          tokenAddress?: string;
          balanceType?: "native";
        }) => {
          const response = await fetch("/api/wallet/balance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: walletAddress,
              chainId: holdingsChainId,
              tokenAddress,
              balanceType,
            }),
          });

          if (!response.ok) {
            throw new Error("Failed to fetch wallet balance.");
          }

          const data = (await response.json()) as {
            balance?: string;
            error?: string;
          };

          const parsedBalance = Number.parseFloat(data.balance ?? "0");
          return Number.isFinite(parsedBalance) ? parsedBalance : 0;
        };

        const [nativeBalanceFormatted, tokenBalances, priceMap] = await Promise.all([
          fetchBalance({
            balanceType: "native",
          }),
          Promise.all(
            SUPPORTED_PROFILE_TOKENS.map(async ({ symbol, address }) => {
              try {
                const balance = await fetchBalance({ tokenAddress: address });
                return { tokenName: symbol, balance };
              } catch (err) {
                console.error(`Error fetching ${symbol} balance:`, err);
                return { tokenName: symbol, balance: 0 };
              }
            }),
          ),
          fetchArcTokenUsdPrices(),
        ]);

        const newHoldings: WalletHolding[] = [];

        if (nativeBalanceFormatted > 0.000001) {
          const price = priceMap.USDC;
          newHoldings.push({
            token: "USDC",
            icon: getTokenIcon("USDC"),
            balance: nativeBalanceFormatted.toFixed(6),
            price: `$${price.toFixed(2)}`,
            value: `$${(nativeBalanceFormatted * price).toFixed(2)}`,
            rawBalance: nativeBalanceFormatted,
          });
        }

        tokenBalances.forEach(({ tokenName, balance }) => {
          if (balance > 0) {
            const formattedBalance = balance;

            if (formattedBalance < 0.000001) return;

            const price = priceMap[tokenName] || 0;
            const value = formattedBalance * price;

            newHoldings.push({
              token: tokenName,
              icon: getTokenIcon(tokenName),
              balance: formattedBalance.toFixed(6),
              price: `$${price.toFixed(2)}`,
              value: `$${value.toFixed(2)}`,
              rawBalance: formattedBalance,
            });
          }
        });

        newHoldings.sort(
          (a, b) =>
            parseFloat(b.value.replace("$", "")) -
            parseFloat(a.value.replace("$", "")),
        );

        setHoldings(newHoldings);
      } catch (err) {
        console.error("Error fetching wallet holdings:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch holdings",
        );
        setHoldings([]);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchHoldings, 300);
    return () => clearTimeout(timer);
  }, [walletAddress]);

  return { holdings, loading, error };
};
