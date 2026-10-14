/**
 * useBridge Hook
 * 
 * Manages bridge state and execution for the bridge component
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  bridgeTokens,
  getUnavailableCircleRouteError,
  isBridgeRouteSupported,
  estimateBridgeTime,
  getBridgeFees,
  waitForForwardedBridgeCompletion,
  BridgeRequest,
  BridgeResponse,
  SUPPORTED_CHAINS,
  formatBridgeAmount,
  isValidAddress,
} from "@/lib/bridgeService";
import { isSolanaBridgeChain } from "@/lib/bridgeNetworks";
import { isBridgeRouteEnabled } from "@/lib/bridgeEnabled";

export interface BridgeState {
  isLoading: boolean;
  isBridging: boolean;
  error: string | null;
  success: boolean;
  estimatedFee: string;
  estimatedCircleFee: string;
  estimatedPlatformFee: string;
  estimatedSourceDebit: string;
  estimatedReceivedAmount: string;
  estimatedTime: string;
  customFeeEnabled: boolean;
  transactionHash?: string;
  status?: string; // "pending" or "completed"
  message?: string; // Additional info message for pending status
  forwarded?: boolean;
}

export interface UseBridgeResult extends BridgeState {
  executeBridge: (request: BridgeRequest) => Promise<BridgeResponse>;
  validateBridgeInputs: (
    fromChain: string | null,
    toChain: string | null,
    amount: string,
    toAddress: string,
    tokenSymbol?: string,
  ) => string | null;
  calculateBridgeDetails: (
    fromChain: string,
    toChain: string,
    amount: string,
    tokenSymbol?: string,
  ) => Promise<void>;
  resetBridgeState: () => void;
  clearError: () => void;
  reportError: (errorMessage: string) => void;
}

const FORWARDED_BRIDGE_POLL_INTERVAL_MS = 10000;
const FORWARDED_BRIDGE_POLL_MAX_DURATION_MS = 15 * 60 * 1000;

export function useBridge(): UseBridgeResult {
  const { chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<BridgeState>({
    isLoading: false,
    isBridging: false,
    error: null,
    success: false,
    estimatedFee: "0.00",
    estimatedCircleFee: "0.00",
    estimatedPlatformFee: "0.00",
    estimatedSourceDebit: "0.00",
    estimatedReceivedAmount: "0.00",
    estimatedTime: "2-5 minutes",
    customFeeEnabled: false,
  });
  const forwardedBridgePollTimerRef =
    useRef<number | null>(null);
  const activeForwardedBridgePollRef = useRef<{
    burnTxHash: string;
    startedAt: number;
  } | null>(null);

  const clearForwardedBridgePolling = useCallback(() => {
    if (forwardedBridgePollTimerRef.current) {
      window.clearTimeout(forwardedBridgePollTimerRef.current);
      forwardedBridgePollTimerRef.current = null;
    }

    activeForwardedBridgePollRef.current = null;
  }, []);

  const pollForwardedBridgeCompletion = useCallback(
    async (
      pendingRequest: Pick<
        BridgeRequest,
        "fromChain" | "sourceAddress" | "publicClient" | "walletClient" | "chain"
      >,
      burnTxHash: string,
      startedAt: number,
    ) => {
      try {
        const completion = await waitForForwardedBridgeCompletion({
          ...pendingRequest,
          burnTxHash,
        });

        if (activeForwardedBridgePollRef.current?.burnTxHash !== burnTxHash) {
          return;
        }

        if (completion.success && completion.status === "completed") {
          clearForwardedBridgePolling();
          setState((prev) => {
            if (prev.status !== "pending") {
              return prev;
            }

            return {
              ...prev,
              success: true,
              status: "completed",
              message:
                completion.message ??
                "Circle Forwarder confirmed the destination mint.",
              transactionHash:
                completion.transactionHash ?? prev.transactionHash,
              forwarded: true,
              error: null,
            };
          });
          return;
        }
      } catch (completionError) {
        console.warn(
          "Unable to finalize pending forwarded bridge status:",
          completionError,
        );
      }

      if (activeForwardedBridgePollRef.current?.burnTxHash !== burnTxHash) {
        return;
      }

      if (Date.now() - startedAt >= FORWARDED_BRIDGE_POLL_MAX_DURATION_MS) {
        return;
      }

      forwardedBridgePollTimerRef.current = window.setTimeout(() => {
        void pollForwardedBridgeCompletion(pendingRequest, burnTxHash, startedAt);
      }, FORWARDED_BRIDGE_POLL_INTERVAL_MS);
    },
    [clearForwardedBridgePolling],
  );

  useEffect(() => {
    return () => {
      clearForwardedBridgePolling();
    };
  }, [clearForwardedBridgePolling]);

  /**
   * Validate bridge inputs
   */
  const validateBridgeInputs = useCallback(
    (
      fromChain: string | null,
      toChain: string | null,
      amount: string,
      toAddress: string,
      tokenSymbol: string = "USDC",
    ): string | null => {
      if (!fromChain) return "Please select a source chain";
      if (!toChain) return "Please select a destination chain";
      if (!amount || parseFloat(amount) <= 0) return "Please enter a valid amount";
      if (!toAddress) return "Please enter a destination address";

      // Validate route is supported
      if (!isBridgeRouteSupported(fromChain, toChain)) {
        return "This bridge route is not supported";
      }

      const unavailableRouteError = getUnavailableCircleRouteError(
        fromChain,
        toChain,
        tokenSymbol,
      );
      if (unavailableRouteError) {
        return unavailableRouteError;
      }

      // Validate destination address
      const toChainConfig = SUPPORTED_CHAINS[toChain as keyof typeof SUPPORTED_CHAINS];
      const chainType = isSolanaBridgeChain(toChain) ? "solana" : "evm";
      
      if (!isValidAddress(toAddress, chainType)) {
        return `Invalid ${toChainConfig?.name} address format`;
      }

      return null;
    },
    []
  );

  /**
   * Calculate bridge fees and estimated time
   */
  const calculateBridgeDetails = useCallback(
    async (fromChain: string, toChain: string, amount: string, tokenSymbol: string = "USDC") => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const fees = await getBridgeFees(fromChain, toChain, amount, tokenSymbol);
        const time = estimateBridgeTime(fromChain, toChain);

        setState((prev) => ({
          ...prev,
          isLoading: false,
          estimatedFee: fees.totalFee,
          estimatedCircleFee: fees.circleFee,
          estimatedPlatformFee: fees.platformFee,
          estimatedSourceDebit: fees.sourceDebitTotal,
          estimatedReceivedAmount: fees.amountReceived,
          estimatedTime: time,
          customFeeEnabled: fees.customFeeEnabled,
        }));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to calculate bridge details";
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }
    },
    []
  );

  /**
   * Execute a bridge transaction
   */
  const executeBridge = useCallback(
    async (request: BridgeRequest): Promise<BridgeResponse> => {
      if (!isBridgeRouteEnabled(request.fromChain, request.toChain)) {
        const error = "Bridging is disabled for one or both selected networks.";
        setState((prev) => ({
          ...prev,
          isBridging: false,
          error,
        }));
        return { success: false, error };
      }

      // Validate inputs first
      const validationError = validateBridgeInputs(
        request.fromChain,
        request.toChain,
        request.amount,
        request.toAddress || "",
        request.token,
      );

      if (validationError) {
        setState((prev) => ({
          ...prev,
          error: validationError,
          isBridging: false,
        }));
        return {
          success: false,
          error: validationError,
        };
      }

      try {
        clearForwardedBridgePolling();

        setState((prev) => ({
          ...prev,
          isBridging: true,
          error: null,
          success: false,
        }));

        // Format amount properly
        const formattedAmount = formatBridgeAmount(request.amount, 6);

        // Execute the bridge
        const result = await bridgeTokens({
          ...request,
          amount: formattedAmount,
          publicClient: request.publicClient ?? publicClient,
          walletClient: request.walletClient ?? walletClient,
          chain:
            request.chain ??
            walletClient?.chain ??
            publicClient?.chain ??
            chainId,
        });

        if (result.success) {
          setState((prev) => ({
            ...prev,
            isBridging: false,
            success: true,
            transactionHash: result.transactionHash,
            status: result.status,
            message: result.message,
            forwarded: result.forwarded,
            error: null,
          }));

          if (
            result.status === "pending" &&
            result.forwarded &&
            (result.sourceTransactionHash || result.transactionHash)
          ) {
            const pendingBurnTxHash =
              result.sourceTransactionHash ?? result.transactionHash!;
            const pollStartedAt = Date.now();

            activeForwardedBridgePollRef.current = {
              burnTxHash: pendingBurnTxHash,
              startedAt: pollStartedAt,
            };

            void pollForwardedBridgeCompletion(
              {
                fromChain: request.fromChain,
                sourceAddress: request.sourceAddress,
                publicClient: request.publicClient ?? publicClient,
                walletClient: request.walletClient ?? walletClient,
                chain:
                  request.chain ??
                  walletClient?.chain ??
                  publicClient?.chain ??
                  chainId,
              },
              pendingBurnTxHash,
              pollStartedAt,
            );
          } else {
            clearForwardedBridgePolling();
          }
        } else {
          clearForwardedBridgePolling();
          setState((prev) => ({
            ...prev,
            isBridging: false,
            success: false,
            error: result.error || "Bridge transaction failed",
          }));
        }

        return result;
      } catch (error) {
        clearForwardedBridgePolling();
        const errorMessage =
          error instanceof Error ? error.message : "Bridge transaction failed";
        setState((prev) => ({
          ...prev,
          isBridging: false,
          success: false,
          error: errorMessage,
        }));

        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    [
      chainId,
      clearForwardedBridgePolling,
      pollForwardedBridgeCompletion,
      publicClient,
      validateBridgeInputs,
      walletClient,
    ]
  );

  /**
   * Reset bridge state
   */
  const resetBridgeState = useCallback(() => {
    clearForwardedBridgePolling();
    setState({
      isLoading: false,
      isBridging: false,
      error: null,
      success: false,
      estimatedFee: "0.00",
      estimatedCircleFee: "0.00",
      estimatedPlatformFee: "0.00",
      estimatedSourceDebit: "0.00",
      estimatedReceivedAmount: "0.00",
      estimatedTime: "2-5 minutes",
      customFeeEnabled: false,
      status: undefined,
      message: undefined,
      forwarded: undefined,
    });
  }, [clearForwardedBridgePolling]);

  /**
   * Clear error message
   */
  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  const reportError = useCallback(
    (errorMessage: string) => {
      clearForwardedBridgePolling();
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isBridging: false,
        success: false,
        error: errorMessage,
      }));
    },
    [clearForwardedBridgePolling],
  );

  return {
    ...state,
    executeBridge,
    validateBridgeInputs,
    calculateBridgeDetails,
    resetBridgeState,
    clearError,
    reportError,
  };
}

export default useBridge;
