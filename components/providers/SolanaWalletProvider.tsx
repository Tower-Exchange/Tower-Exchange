"use client";

import Image from "next/image";
import { type ReactNode, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ExternalLink, X } from "lucide-react";
import {
  connectSolanaWallet,
  refreshSolanaWalletState,
  useSolanaWallet,
  type SolanaWalletKey,
} from "@/lib/solanaWalletStore";
import phantomIcon from "@/public/assets/phantom.svg";
import solflareIcon from "@/public/assets/solflare.svg";

const walletIcons: Record<SolanaWalletKey, { src: typeof phantomIcon; alt: string }> = {
  phantom: { src: phantomIcon, alt: "Phantom" },
  solflare: { src: solflareIcon, alt: "Solflare" },
};

export const SolanaWalletProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const {
    modalOpen,
    closeConnectModal,
    availableWallets,
    isConnecting,
    selectedWallet,
    error,
  } = useSolanaWallet();

  useEffect(() => {
    refreshSolanaWalletState();

    const handleFocus = () => refreshSolanaWalletState();
    const handleInitialized = () => refreshSolanaWalletState();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("solana#initialized", handleInitialized as EventListener);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        "solana#initialized",
        handleInitialized as EventListener,
      );
    };
  }, []);

  return (
    <>
      {children}

      <AnimatePresence>
        {modalOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
              onClick={closeConnectModal}
            />

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="fixed left-1/2 top-1/2 z-[100] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-[#101113] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Connect Wallet
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose a Solana wallet for bridging on Solana Devnet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeConnectModal}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-foreground/65 transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Close wallet modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 py-5">
                <div className="space-y-3">
                  {availableWallets.map((wallet) => (
                    <div
                      key={wallet.key}
                      className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center">
                          <Image
                            src={walletIcons[wallet.key].src}
                            alt={`${walletIcons[wallet.key].alt} icon`}
                            width={24}
                            height={24}
                            className="h-6 w-6 object-contain"
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {wallet.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {wallet.installed
                              ? "Installed"
                              : "Not detected in this browser"}
                          </p>
                        </div>
                      </div>

                      {wallet.installed ? (
                        <button
                          type="button"
                          onClick={() => void connectSolanaWallet(wallet.key)}
                          disabled={isConnecting}
                          className="inline-flex h-10 min-w-[7rem] items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-black transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isConnecting && selectedWallet === wallet.key
                            ? "Connecting..."
                            : "Connect"}
                        </button>
                      ) : (
                        <a
                          href={wallet.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 min-w-[7rem] items-center justify-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-foreground/75 transition-colors hover:border-white/20 hover:text-foreground"
                        >
                          <span>Install</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#7bb8ff]/15 bg-primary/8 px-4 py-3 text-sm text-[#7bb8ff]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Your Solana wallet connection is shared across the app, so you
                    only need to connect once for the bridge flow.
                  </p>
                </div>

                {error ? (
                  <p className="mt-3 text-sm text-[#f87171]">{error}</p>
                ) : null}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
};

