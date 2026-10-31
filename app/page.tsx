"use client";
import { Suspense, useCallback, useState, useEffect } from "react";
import { flushSync } from "react-dom";
import BridgeCardContent from "@/app/bridge/bridge-content";
import SwapCard from "@/components/SwapCard";
import TokenTicker from "@/components/TokenTicker";
import PromotionalSidebar from "@/components/PromotionalSidebar";

export default function Home() {
  const [currentView, setCurrentView] = useState<"swap" | "bridge">("swap");

  useEffect(() => {
    const handleSelectTokenEvent = () => {
      setCurrentView("swap");
    };

    window.addEventListener("select-sell-token", handleSelectTokenEvent);

    // On mount, if swap prefills exist, switch to swap view
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    if (
      requestedView === "swap" || requestedView === "bridge"
    ) {
      setCurrentView(requestedView);
    }
    if (params.get("select") || params.get("from") || params.get("to")) {
      setCurrentView("swap");
    }

    return () => {
      window.removeEventListener("select-sell-token", handleSelectTokenEvent);
    };
  }, []);

  const showSwap = useCallback(() => {
    flushSync(() => setCurrentView("swap"));
  }, []);
  const showBridge = useCallback(() => {
    flushSync(() => setCurrentView("bridge"));
  }, []);
  return (
    <>
      <TokenTicker />
      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4 gap-8">
        {currentView !== "bridge" ? (
          <div className="w-full max-w-[62rem]">
            <SwapCard
              onNavigateToBridge={showBridge}
            />
          </div>
        ) : (
          <div className="w-full max-w-md">
            <Suspense fallback={null}>
              <BridgeCardContent
                onNavigateToSwap={showSwap}
              />
            </Suspense>
          </div>
        )}
        <div className="w-full max-w-md">
          <PromotionalSidebar />
        </div>
      </main>
    </>
  );
}
