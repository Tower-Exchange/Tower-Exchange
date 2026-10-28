"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

type GasAccountInfoModalProps = {
  open: boolean;
  onClose: () => void;
  chainName: string;
};

export default function GasAccountInfoModal({
  open,
  onClose,
  chainName,
}: GasAccountInfoModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="How paying gas in USDC works"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="relative w-full max-w-md rounded-[1.75rem] border border-border bg-card/90 p-5 shadow-2xl backdrop-blur-md"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={16} />
            </button>

            <h3 className="pr-10 text-lg font-semibold text-foreground">
              Pay gas in USDC
            </h3>

            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <section className="rounded-2xl border border-border bg-white/[0.04] p-4">
                <p className="mb-1 font-medium text-foreground">
                  How it works
                </p>
                <p>
                  Every transaction needs a network fee, normally paid in ETH.
                  With this on, the fee is paid in USDC instead, so you
                  don&apos;t need ETH on {chainName}.
                </p>
              </section>

              <section className="rounded-2xl border border-border bg-white/[0.04] p-4">
                <p className="mb-1 font-medium text-foreground">
                  Why a Gas Account?
                </p>
                <p>
                  Circle&apos;s USDC-fee service only works with smart
                  accounts, not regular wallets. So your wallet owns a Gas
                  Account that holds the USDC. The fee is taken from it for each
                  transaction, and anything unused is refunded.
                </p>
              </section>

              <ul className="list-disc space-y-1 pl-5">
                <li>Only your wallet controls it. Tower can&apos;t move your funds.</li>
                <li>
                  Deposit USDC on {chainName} to its address, then bridge from
                  it. Keep a little extra for the fee.
                </li>
                <li>
                  Withdraw back to your wallet anytime. A small amount stays
                  behind for the fee.
                </li>
                <li>Turn it off to bridge from your wallet as usual.</li>
              </ul>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
