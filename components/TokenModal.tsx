"use client";
import { X } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDebounce } from "use-debounce";
import Image from "next/image";
import type { StaticImageData } from "next/image";

import { SWAP_TOKENS, type SwapToken } from "@/lib/swapTokens";

export type TokenModalToken = {
  id?: string;
  symbol: string;
  name: string;
  icon: StaticImageData;
  stableFx?: boolean;
};

interface TokenModalProps<Token extends TokenModalToken = SwapToken> {
  isOpen: boolean;
  onClose: () => void;
  selected: Token;
  onSelect: (token: Token) => void;
  excludeSymbol?: string;
  excludeTokenId?: string;
  availableTokens?: readonly Token[];
  tokenBalances?: Record<string, number>;
}

const TokenModal = <Token extends TokenModalToken = SwapToken>({
  isOpen,
  onClose,
  selected,
  onSelect,
  excludeSymbol,
  excludeTokenId,
  availableTokens,
  tokenBalances = {},
}: TokenModalProps<Token>) => {
  const selectableTokens =
    availableTokens ?? (SWAP_TOKENS as unknown as readonly Token[]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } else {
      setTimeout(() => {
        setSearchQuery("");
      }, 0);
    }
  }, [isOpen]);

  const filteredTokens = useMemo(() => {
    return selectableTokens.filter((token) => {
      if (token.symbol === excludeSymbol) return false;
      if ((token.id ?? token.symbol) === excludeTokenId) return false;

      const matchesSearch =
        !debouncedSearchQuery.trim() ||
        token.symbol
          .toLowerCase()
          .includes(debouncedSearchQuery.toLowerCase()) ||
        token.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase());

      return matchesSearch;
    });
  }, [selectableTokens, debouncedSearchQuery, excludeSymbol, excludeTokenId]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="bg-card border border-border/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
            <h3 className="text-base font-medium text-foreground/90">
              Select a token
            </h3>
            <motion.button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-card transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </motion.button>
          </div>

          <div className="p-6">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search Token"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-secondary border-0 rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-border transition-all"
              />
            </div>
          </div>

          <div className="max-h-100 overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground/60">
                No tokens found
              </div>
            ) : (
              <div className="px-2 pb-2">
                {filteredTokens.map((token, index) => {
                  const isSelected =
                    (selected.id ?? selected.symbol) ===
                    (token.id ?? token.symbol);
                  return (
                    <motion.button
                      key={token.id ?? token.symbol}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={() => {
                        onSelect(token);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-lg transition-colors group ${
                        isSelected
                          ? "bg-primary/20 hover:bg-primary/30"
                          : "hover:bg-secondary/30"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center overflow-hidden ${
                          isSelected ? "bg-primary/40" : "bg-primary/20"
                        }`}>
                          <Image
                            src={token.icon}
                            alt={`${token.symbol} logo`}
                            width={36}
                            height={36}
                            className="object-contain w-full h-full"
                          />
                        </div>
                        <div className="text-left">
                          <p className={`font-medium text-sm ${
                            isSelected ? "text-primary" : "text-foreground"
                          }`}>
                            {token.symbol}
                          </p>
                          <p className="text-xs text-muted-foreground/60">
                            {token.name}
                          </p>
                          {token.stableFx ? (
                            <span className="mt-1 inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              StableFX
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {tokenBalances?.[token.symbol] !== undefined && (
                          <div className="text-right">
                            <p className="text-sm font-medium text-foreground">
                              {tokenBalances[token.symbol].toFixed(6)}
                            </p>
                            <p className="text-xs text-muted-foreground/60">
                              Balance
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TokenModal;
export type { TokenModalProps };
