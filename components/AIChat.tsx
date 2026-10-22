"use client";
import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  Info,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  sendMessageToAIAgent,
  transcribeVoiceNote,
  fetchVoiceReply,
  createAIAgentSession,
  saveChatMessageToHistory,
  getConversationHistory,
  type ChatHistoryItem,
  type AIAgentResponse,
  type AIAgentBridgeRequest,
} from "@/lib/aiAgentService";
import { loadProfileData } from "@/lib/profileService";
import { registerBridgeActivity, registerBridgeFee, insertActivity } from "@/lib/supabase";
import { recordExecutorSwapFee } from "@/lib/swapFeeTracking";
import { v4 as uuidv4 } from "uuid";
import { Plus, Trash2, Menu, X } from "lucide-react";
import { useSwapExecution } from "@/lib/useSwapExecution";
import { TOKEN_CONTRACTS, TOKEN_DECIMALS } from "@/lib/arcNetwork";
import { AERO_MAINNET_TOKENS, AERO_TOKEN_DECIMALS } from "@/lib/aeroDex";
import {
  fetchArcTokenUsdPrices,
  type StableTokenSymbol,
} from "@/lib/tokenUsdPrices";
import useBridge from "@/lib/hooks/useBridge";
import { SUPPORTED_CHAINS, getBridgeFees } from "@/lib/bridgeService";
import { getBridgeTransactionUrl, isSolanaBridgeChain } from "@/lib/bridgeNetworks";
import { TransactionConfirmation } from "./TransactionConfirmation";
import { AtlasAuthGate } from "@/components/AtlasAuthGate";
import { isAtlasAuthEnabled } from "@/lib/atlasAuth";
import { useRainbowKitAuth } from "@/lib/use-rainbowkit-auth";
import { useSolanaWallet } from "@/lib/solanaWalletStore";
import chatLogo from "@/public/assets/chat_logo.svg";

interface VoiceNote {
  url: string;
  durationSec: number;
  // Play once as soon as the bubble appears (Atlas's spoken replies).
  autoPlay?: boolean;
}

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  isTyping?: boolean;
  // Voice note shown instead of the text. On a user message it's their
  // recording (`text` is the transcript Atlas received); on an Atlas message
  // it's the spoken reply, with `text` behind a "Show text" toggle.
  voiceNote?: VoiceNote;
}

const formatVoiceDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const VoiceNoteBubble = ({
  voiceNote,
  variant = "user",
}: {
  voiceNote: VoiceNote;
  variant?: "user" | "assistant";
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [durationSec, setDurationSec] = useState(voiceNote.durationSec);
  const progress =
    durationSec > 0 ? Math.min(100, (elapsed / durationSec) * 100) : 0;
  const isUser = variant === "user";

  useEffect(() => {
    const audio = audioRef.current;
    if (!voiceNote.autoPlay || !audio) return;
    // Only the first time: don't replay when the chat re-renders or remounts.
    voiceNote.autoPlay = false;
    // Stop any other voice note so two don't talk over each other.
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== audio) other.pause();
    });
    // The browser may block sound without a recent tap; the play button
    // still works then.
    audio.play().catch(() => {});
  }, [voiceNote]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  return (
    <div className="flex min-w-[11rem] items-center gap-3">
      <button
        type="button"
        onClick={togglePlayback}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-[#081019] text-primary" : "bg-primary text-[#081019]"
        }`}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
        )}
      </button>
      <div
        className={`h-1 flex-1 overflow-hidden rounded-full ${
          isUser ? "bg-[#081019]/20" : "bg-primary/20"
        }`}
      >
        <div
          className={`h-full rounded-full ${isUser ? "bg-[#081019]" : "bg-primary"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs tabular-nums">
        {formatVoiceDuration(
          isPlaying || elapsed > 0 ? elapsed : durationSec,
        )}
      </span>
      <audio
        ref={audioRef}
        src={voiceNote.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const { duration } = event.currentTarget;
          if (Number.isFinite(duration) && duration > 0) {
            setDurationSec(duration);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onEnded={() => {
          setIsPlaying(false);
          setElapsed(0);
        }}
        className="hidden"
      />
    </div>
  );
};

interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
}

const quickPrompts = [
  "What are my buy/sell position",
  "Show my 7D trading volume",
  "Provide overall analysis on the market",
];

const GENERIC_CHAT_TITLES = new Set(["New Chat", "Chat"]);
const HIDDEN_BALANCE_TOKENS = new Set(["QTM", "SWPRC"]);
const ACTIVITY_TOKEN_SYMBOL_ALIASES: Record<string, string> = {
  WUSDC: "USDC",
  WUSDC_SYNTHRA: "USDC",
};

type AiSwapActivityQuote = {
  inputToken?: string;
  outputToken?: string;
  inputAmount?: string;
  outputAmount?: string;
};

const ACTIVITY_TOKEN_METADATA = [
  ...Object.entries(TOKEN_CONTRACTS).map(([symbol, address]) => ({
    address: address.toLowerCase(),
    decimals: TOKEN_DECIMALS[symbol] ?? 18,
    symbol: ACTIVITY_TOKEN_SYMBOL_ALIASES[symbol] ?? symbol,
  })),
  ...Object.entries(AERO_MAINNET_TOKENS).map(([symbol, address]) => ({
    address: address.toLowerCase(),
    decimals: AERO_TOKEN_DECIMALS[address.toLowerCase()] ?? 18,
    symbol: ACTIVITY_TOKEN_SYMBOL_ALIASES[symbol] ?? symbol,
  })),
];

const formatSessionTitle = (text: string) => {
  const summary = text.trim().replace(/\s+/g, " ");
  if (!summary) return "New Chat";

  return summary.length > 30 ? `${summary.slice(0, 30)}...` : summary;
};

const isGenericSessionTitle = (title: string) => {
  const normalizedTitle = title.trim();
  return !normalizedTitle || GENERIC_CHAT_TITLES.has(normalizedTitle);
};

// Atlas transcribes up to 60s per voice note; stop recording there.
const MAX_VOICE_NOTE_MS = 60_000;

const toAssistantErrorReply = (
  message: string,
  fallback = "Something went wrong. Please try again.",
) => {
  const cleaned = message.replace(/\s+/g, " ").replace(/^error:\s*/i, "").trim();
  if (!cleaned) {
    return fallback;
  }

  const firstSentence = cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? cleaned;
  const reply =
    firstSentence.length > 280
      ? `${firstSentence.slice(0, 277).trimEnd()}...`
      : firstSentence;

  return /[.!?]$/.test(reply) ? reply : `${reply}.`;
};

const getTokenDecimalsByAddress = (tokenAddress?: string) => {
  if (!tokenAddress) {
    return 18;
  }

  return (
    ACTIVITY_TOKEN_METADATA.find(
      ({ address }) => address === tokenAddress.toLowerCase(),
    )?.decimals ?? 18
  );
};

const getTokenSymbolByAddress = (tokenAddress?: string) => {
  if (!tokenAddress) {
    return null;
  }

  return (
    ACTIVITY_TOKEN_METADATA.find(
      ({ address }) => address === tokenAddress.toLowerCase(),
    )?.symbol ?? null
  );
};

const getSwapUsdValue = async ({
  sourceSymbol,
  destinationSymbol,
  sourceAmount,
  destinationAmount,
}: {
  sourceSymbol: string;
  destinationSymbol: string;
  sourceAmount: number;
  destinationAmount: number | null;
}) => {
  if (sourceSymbol === "USDC") return sourceAmount;
  if (destinationSymbol === "USDC" && destinationAmount != null) {
    return destinationAmount;
  }

  const prices = await fetchArcTokenUsdPrices();
  const price = prices[sourceSymbol as StableTokenSymbol];
  return Number.isFinite(price) ? sourceAmount * price : null;
};

const normalizeAiQuoteAmountToTokenDecimals = (
  amount: string | null | undefined,
  tokenAddress?: string,
) => {
  if (!amount) {
    return null;
  }

  const decimals = getTokenDecimalsByAddress(tokenAddress);

  try {
    const amountBn = BigInt(amount);

    if (decimals >= 18) {
      return amountBn.toString();
    }

    const conversionFactor = 10n ** BigInt(18 - decimals);

    if (amountBn >= conversionFactor && amountBn % conversionFactor === 0n) {
      return (amountBn / conversionFactor).toString();
    }

    return amountBn.toString();
  } catch {
    return amount;
  }
};

const formatTokenAmountForActivity = (
  amount: string | null | undefined,
  tokenAddress?: string,
) => {
  const nativeAmount = normalizeAiQuoteAmountToTokenDecimals(
    amount,
    tokenAddress,
  );

  if (!nativeAmount) {
    return null;
  }

  try {
    const amountBn = BigInt(nativeAmount);
    const decimals = BigInt(getTokenDecimalsByAddress(tokenAddress));
    const scale = 10n ** decimals;
    const whole = amountBn / scale;
    const fraction = amountBn % scale;
    const fractionText = fraction
      .toString()
      .padStart(Number(decimals), "0")
      .replace(/0+$/, "");
    const formatted = fractionText
      ? `${whole.toString()}.${fractionText}`
      : whole.toString();
    const parsedAmount = Number(formatted);

    return Number.isFinite(parsedAmount) ? parsedAmount : null;
  } catch {
    const parsedAmount = Number(nativeAmount);
    return Number.isFinite(parsedAmount) ? parsedAmount : null;
  }
};

const logAiSwapActivity = async ({
  walletAddress,
  quote,
  transactionHash,
}: {
  walletAddress: string;
  quote?: AiSwapActivityQuote;
  transactionHash?: string;
}) => {
  try {
    if (!walletAddress || !quote?.inputToken || !quote.outputToken) {
      return null;
    }

    const sourceSymbol = getTokenSymbolByAddress(quote.inputToken);
    const destinationSymbol = getTokenSymbolByAddress(quote.outputToken);
    const amount = formatTokenAmountForActivity(
      quote.inputAmount,
      quote.inputToken,
    );
    const outputAmount = formatTokenAmountForActivity(
      quote.outputAmount,
      quote.outputToken,
    );

    if (!sourceSymbol || !destinationSymbol || amount == null) {
      console.error("Skipping AI swap activity with unknown token metadata", {
        inputToken: quote.inputToken,
        outputToken: quote.outputToken,
        transactionHash,
      });
      return null;
    }

    const amountUsd = await getSwapUsdValue({
      sourceSymbol,
      destinationSymbol,
      sourceAmount: amount,
      destinationAmount: outputAmount,
    });
    if (amountUsd == null || !Number.isFinite(amountUsd)) {
      console.error("Skipping AI swap activity without a reliable USD value", {
        sourceSymbol,
        destinationSymbol,
        transactionHash,
      });
      return null;
    }

    const { data, error, success } = await insertActivity({
        wallet_address: walletAddress.toLowerCase(),
        type: "Swap",
        source_currency_ticker: sourceSymbol,
        destination_currency_ticker: destinationSymbol,
        source_network_name: "Arc",
        destination_network_name: "Arc",
        status: "Successful",
        amount,
        amount_usd: amountUsd,
        transaction_hash: transactionHash || null,
        timestamp: new Date().toISOString(),
      });

    if (!success || error) {
      console.error("Error logging AI swap activity:", error);
      return null;
    }

    return data?.id ?? null;
  } catch (activityError) {
    console.error("Error logging AI swap activity:", activityError);
    return null;
  }
};

const getBridgeChainName = (chainId?: string) => {
  if (!chainId) {
    return "";
  }

  return (
    SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS]?.name ||
    chainId
  );
};

const getHistorySessionMetadata = (
  history: Pick<ChatHistoryItem, "created_at" | "user_query" | "ai_response">[],
) => {
  const firstUserMessage =
    history.find((item) => item.user_query?.trim())?.user_query?.trim() || "";
  const firstCreatedAt = history[0]?.created_at
    ? new Date(history[0].created_at).getTime()
    : Number.NaN;

  return {
    title: firstUserMessage ? formatSessionTitle(firstUserMessage) : "New Chat",
    timestamp: Number.isFinite(firstCreatedAt) ? firstCreatedAt : Date.now(),
    messageCount: history.reduce(
      (count, item) => count + (item.user_query ? 1 : 0),
      0,
    ),
  };
};

const sanitizeBalanceResponse = (
  response: AIAgentResponse,
): AIAgentResponse => {
  const balances = response.data?.balances;

  if (!balances?.length) {
    return response;
  }

  const hiddenTokenPattern = /\b(QTM|SWPRC)\b/i;
  const filteredBalances = balances.filter(
    (balance) => !HIDDEN_BALANCE_TOKENS.has(balance.token.toUpperCase()),
  );
  const filteredReply = response.reply
    .split(/\r?\n/)
    .filter((line) => !hiddenTokenPattern.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    ...response,
    reply: filteredReply || response.reply,
    data: {
      ...response.data,
      balances: filteredBalances,
    },
  };
};

const normalizeSession = (session: ChatSession): ChatSession => ({
  ...session,
  title: session.title?.trim() || "New Chat",
  timestamp: Number.isFinite(session.timestamp)
    ? session.timestamp
    : Date.now(),
  messageCount:
    typeof session.messageCount === "number" && session.messageCount >= 0
      ? session.messageCount
      : 0,
});

export const AIChat = () => {
  const { user } = useRainbowKitAuth();
  const atlasAuthRequired = isAtlasAuthEnabled();
  const [hasAtlasAccess, setHasAtlasAccess] = useState(!atlasAuthRequired);
  const {
    address: solanaAddress,
    connected: isSolanaConnected,
    openConnectModal: openSolanaConnectModal,
  } = useSolanaWallet();
  const swapExecution = useSwapExecution();
  const bridgeHook = useBridge();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(
    null,
  );
  const [profileImageError, setProfileImageError] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSwapConfirmation, setShowSwapConfirmation] = useState(false);
  const [showBridgeConfirmation, setShowBridgeConfirmation] = useState(false);
  const [swapConfirmationInsertIndex, setSwapConfirmationInsertIndex] =
    useState<number | null>(null);
  const [bridgeConfirmationInsertIndex, setBridgeConfirmationInsertIndex] =
    useState<number | null>(null);
  const [activeBridgeRequest, setActiveBridgeRequest] =
    useState<AIAgentBridgeRequest | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [voiceState, setVoiceState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSendMessageRef = useRef<
    ((text: string, voiceNote?: VoiceNote) => Promise<void>) | null
  >(null);
  const voiceNoteUrlsRef = useRef<string[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const reportedSwapErrorRef = useRef<string | null>(null);
  const reportedBridgeErrorRef = useRef<string | null>(null);

  const pushAssistantMessage = useCallback((text: string) => {
    const reply = toAssistantErrorReply(text);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        text: reply,
        isUser: false,
      },
    ]);
  }, []);

  // Load sessions from localStorage
  const loadSessions = (walletAddress: string): ChatSession[] => {
    try {
      const sessionsData = localStorage.getItem(
        `tower-ai-sessions-${walletAddress}`,
      );
      return sessionsData
        ? (JSON.parse(sessionsData) as ChatSession[]).map(normalizeSession)
        : [];
    } catch (error) {
      console.error("Error loading sessions:", error);
      return [];
    }
  };

  // Save sessions to localStorage
  const saveSessions = (walletAddress: string, sessionsData: ChatSession[]) => {
    try {
      localStorage.setItem(
        `tower-ai-sessions-${walletAddress}`,
        JSON.stringify(sessionsData),
      );
    } catch (error) {
      console.error("Error saving sessions:", error);
    }
  };

  const syncSessionFromHistory = useCallback(
    (
      targetSessionId: string,
      history: Pick<
        ChatHistoryItem,
        "created_at" | "user_query" | "ai_response"
      >[],
    ) => {
      const walletAddress = user?.wallet?.address;
      if (!walletAddress || history.length === 0) return;

      const nextMetadata = getHistorySessionMetadata(history);

      setSessions((prevSessions) => {
        let changed = false;

        const updatedSessions = prevSessions.map((session) => {
          if (session.id !== targetSessionId) return session;

          const shouldRefreshTimestamp =
            isGenericSessionTitle(session.title) ||
            session.messageCount === 0 ||
            !Number.isFinite(session.timestamp);
          const nextTitle = isGenericSessionTitle(session.title)
            ? nextMetadata.title
            : session.title;
          const nextTimestamp = shouldRefreshTimestamp
            ? nextMetadata.timestamp
            : session.timestamp;
          const nextMessageCount = Math.max(
            session.messageCount,
            nextMetadata.messageCount,
          );

          if (
            nextTitle !== session.title ||
            nextTimestamp !== session.timestamp ||
            nextMessageCount !== session.messageCount
          ) {
            changed = true;
            return {
              ...session,
              title: nextTitle,
              timestamp: nextTimestamp,
              messageCount: nextMessageCount,
            };
          }

          return session;
        });

        if (changed) {
          saveSessions(walletAddress, updatedSessions);
        }

        return updatedSessions;
      });
    },
    [user?.wallet?.address],
  );

  // Start a new chat
  const startNewChat = async () => {
    const walletAddress = user?.wallet?.address;
    if (!walletAddress) return;

    try {
      const newSessionId = uuidv4();
      const newSession: ChatSession = {
        id: newSessionId,
        title: "New Chat",
        timestamp: Date.now(),
        messageCount: 0,
      };

      // Add to sessions list
      setSessions((prevSessions) => {
        const updatedSessions = [newSession, ...prevSessions];
        saveSessions(walletAddress, updatedSessions);
        return updatedSessions;
      });

      // Switch to new session
      switchSession(newSessionId);
    } catch (error) {
      console.error("Error creating new chat:", error);
    }
  };

  // Switch to a different session
  const switchSession = async (newSessionId: string) => {
    if (!user?.wallet?.address) return;

    try {
      setSessionId(newSessionId);
      localStorage.setItem("ai-session-id", newSessionId);
      setMessages([]);
      setMessage("");
      setShowSwapConfirmation(false);
      setShowBridgeConfirmation(false);
      setActiveBridgeRequest(null);
      reportedSwapErrorRef.current = null;
      reportedBridgeErrorRef.current = null;
      swapExecution.resetState();
      bridgeHook.resetBridgeState();
      setProfileImageError(false);
      setSidebarOpen(false); // Close sidebar after selecting a session

      // Load history for this session
      const history = await getConversationHistory(
        newSessionId,
        user.wallet.address,
      );

      if (history.length > 0) {
        const loadedMessages: Message[] = [];
        let messageId = 1;

        history.forEach((item) => {
          if (item.user_query) {
            loadedMessages.push({
              id: messageId++,
              text: item.user_query,
              isUser: true,
            });
          }
          if (item.ai_response) {
            loadedMessages.push({
              id: messageId++,
              text: item.ai_response,
              isUser: false,
            });
          }
        });
        setMessages(loadedMessages);
        syncSessionFromHistory(newSessionId, history);
      }
    } catch (error) {
      console.error("Error switching session:", error);
    }
  };

  // Delete a session
  const deleteSession = (sessionToDelete: string) => {
    try {
      const updatedSessions = sessions.filter((s) => s.id !== sessionToDelete);
      setSessions(updatedSessions);
      if (user?.wallet?.address) {
        saveSessions(user.wallet.address, updatedSessions);
      }

      // If we deleted the active session, switch to the first available or clear chat
      if (sessionId === sessionToDelete) {
        if (updatedSessions.length > 0) {
          switchSession(updatedSessions[0].id);
        } else {
          // No more sessions, clear the chat area
          setMessages([]);
          setMessage("");
          setShowSwapConfirmation(false);
          setShowBridgeConfirmation(false);
          setActiveBridgeRequest(null);
          reportedSwapErrorRef.current = null;
          reportedBridgeErrorRef.current = null;
          swapExecution.resetState();
          bridgeHook.resetBridgeState();
          setSessionId("");
          setSidebarOpen(false);
        }
      }
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  // Initialize session when user is available
  useEffect(() => {
    const initializeSession = async () => {
      if (!user?.wallet?.address) return;

      try {
        // Load profile picture from localStorage or fetch from Supabase
        const profilePicUrl = await loadProfileData(user.wallet.address);
        console.log(
          "Profile picture URL loaded:",
          profilePicUrl ? "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ URL exists" : "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â No URL",
        );
        console.log("Profile URL:", profilePicUrl);
        setProfilePictureUrl(profilePicUrl);
        setProfileImageError(false);

        // Load all sessions for this user
        const userSessions = loadSessions(user.wallet.address);

        // Try to use stored session or create a new one
        let sessionIdToUse = localStorage.getItem("ai-session-id");

        if (
          !sessionIdToUse ||
          !userSessions.find((s) => s.id === sessionIdToUse)
        ) {
          const response = await createAIAgentSession(user.wallet.address);
          sessionIdToUse = response.sessionId;

          // Add to sessions list if not already there
          if (!userSessions.find((s) => s.id === sessionIdToUse)) {
            const newSession: ChatSession = {
              id: sessionIdToUse,
              title: "New Chat",
              timestamp: Date.now(),
              messageCount: 0,
            };
            userSessions.unshift(newSession);
            saveSessions(user.wallet.address, userSessions);
          }
        }

        setSessions(userSessions);
        localStorage.setItem("ai-session-id", sessionIdToUse);
        setSessionId(sessionIdToUse);

        // Load chat history from Supabase
        const history = await getConversationHistory(
          sessionIdToUse,
          user.wallet.address,
        );

        if (history.length > 0) {
          const loadedMessages: Message[] = [];
          let messageId = 1;

          history.forEach((item) => {
            if (item.user_query) {
              loadedMessages.push({
                id: messageId++,
                text: item.user_query,
                isUser: true,
              });
            }
            if (item.ai_response) {
              loadedMessages.push({
                id: messageId++,
                text: item.ai_response,
                isUser: false,
              });
            }
          });
          setMessages(loadedMessages);
          syncSessionFromHistory(sessionIdToUse, history);
        }
      } catch (err) {
        console.error("Failed to initialize session:", err);
        // Fallback to generating a local session ID
        const localSessionId = uuidv4();
        setSessionId(localSessionId);
        localStorage.setItem("ai-session-id", localSessionId);
      }
    };

    initializeSession();
  }, [syncSessionFromHistory, user?.wallet?.address]);

  // Detect if device is touch-enabled
  useEffect(() => {
    const isTouchEnabled = () => {
      return (
        window.matchMedia("(pointer:coarse)").matches ||
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0
      );
    };
    setIsTouchDevice(isTouchEnabled());
  }, []);

  // Close tooltip when clicking outside (for touch devices)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[aria-label="Trading volume information"]')) {
        setShowInfoTooltip(false);
      }
    };

    if (showInfoTooltip && isTouchDevice) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showInfoTooltip, isTouchDevice]);

  const handleSendMessage = async (text: string, voiceNote?: VoiceNote) => {
    if (!text.trim()) return;
    const walletAddress = user?.wallet?.address?.toLowerCase();
    if (!walletAddress) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text, isUser: true },
        {
          id: Date.now() + 1,
          text: toAssistantErrorReply("Please connect your wallet first"),
          isUser: false,
        },
      ]);
      setMessage("");
      return;
    }
    if (atlasAuthRequired && !hasAtlasAccess) {
      setMessage("");
      return;
    }
    if (!sessionId) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text, isUser: true },
        {
          id: Date.now() + 1,
          text: toAssistantErrorReply("Chat session not initialized"),
          isUser: false,
        },
      ]);
      setMessage("");
      return;
    }

    const userMessage: Message = {
      id: Date.now(),
      text: text,
      isUser: true,
      ...(voiceNote ? { voiceNote } : {}),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);

    try {
      // Detect user intent to enable appropriate features
      const lowerMessage = text.toLowerCase();
      const enableWalletAccess =
        /balance|holding|wallet|token|asset|portfolio|position/.test(
          lowerMessage,
        );
      const enablePortfolioAnalysis =
        /portfolio|performance|pnl|profit|loss|trading|volume|analysis/.test(
          lowerMessage,
        );
      const enableSwap = /swap|exchange|trade/.test(lowerMessage);
      const enableBridge =
        /bridge|bridging|cross-chain|cross chain/.test(lowerMessage) ||
        /\b(send|transfer|move)\b.+\b(from|to|into|onto)\b.+\b(usdc|arc|base|optimism|avalanche|arbitrum|ethereum|linea|polygon|sonic|unichain|solana|devnet)\b/.test(
          lowerMessage,
        );

      const rawResponse = await sendMessageToAIAgent({
        message: text,
        userid: walletAddress,
        session_id: sessionId,
        wallet_address: walletAddress,
        solana_wallet_address: solanaAddress || undefined,
        solanaWalletAddress: solanaAddress || undefined,
        chain_id: 5042, // Arc mainnet
        enable_wallet_access: enableWalletAccess,
        enable_swap_execution: enableSwap,
        enable_bridge_execution: enableBridge,
        enable_portfolio_analysis: enablePortfolioAnalysis,
      });
      const response = sanitizeBalanceResponse(rawResponse);

      console.log("AI Response received:", response);
      console.log("Response data:", response.data);

      // Voice in, voice out: answer a voice note with Atlas's spoken reply.
      // Skip it if the reply text was filtered (the audio would still say the
      // hidden lines), and fall back to plain text if the audio fails.
      let replyVoiceNote: VoiceNote | undefined;
      if (voiceNote && response.audio_id && response.reply === rawResponse.reply) {
        try {
          const audio = await fetchVoiceReply(response.audio_id);
          const url = URL.createObjectURL(audio);
          voiceNoteUrlsRef.current.push(url);
          replyVoiceNote = { url, durationSec: 0, autoPlay: true };
        } catch (voiceError) {
          console.error("Atlas voice reply failed, showing text:", voiceError);
        }
      }

      const aiResponse: Message = {
        id: Date.now() + 1,
        text: response.reply,
        isUser: false,
        ...(replyVoiceNote ? { voiceNote: replyVoiceNote } : {}),
      };
      setMessages((prev) => [...prev, aiResponse]);

      // Check if swap execution data is present
      if (response.data?.swap_execution) {
        console.log(
          "Swap execution data detected:",
          response.data.swap_execution,
        );

        // Validate transaction structure
        const txData = response.data.swap_execution.transaction;
        const quote = response.data.swap_execution.quote;

        // Enhanced quote logging
        if (quote) {
          console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â FULL QUOTE OBJECT FROM BACKEND ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â");
          console.log("Full quote:", JSON.stringify(quote, null, 2));
          console.log("quote.inputToken:", quote.inputToken);
          console.log("quote.outputToken:", quote.outputToken);
          console.log("quote.outputToken type:", typeof quote.outputToken);
          console.log("quote.outputToken length:", quote.outputToken?.length);
          console.log("quote.inputAmount:", quote.inputAmount);
          console.log("quote.outputAmount:", quote.outputAmount);
          console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â");
        }

        if (txData) {
          console.log("Transaction fields:", {
            to: txData.to || "MISSING",
            data: txData.data
              ? `${txData.data.substring(0, 66)}...`
              : "MISSING",
            value: txData.value || "MISSING",
            from: txData.from || "MISSING",
            gasLimit: txData.gasLimit || "MISSING",
            approvalCount: Array.isArray(txData.approval)
              ? txData.approval.length
              : txData.approval
                ? 1
                : 0,
          });
        } else {
          console.error(
            "Transaction object is undefined in swap_execution data",
          );
        }

        setShowSwapConfirmation(true);

        // Auto-trigger swap execution flow
        if (walletAddress) {
          try {
            if (!txData || !txData.to) {
              throw new Error(
                "Cannot execute swap: Transaction object missing or 'to' address is undefined. Backend may not have returned proper swap execution data.",
              );
            }

            await swapExecution.executeSwap(
              {
                ...txData,
                inputToken: quote?.inputToken,
                outputToken: quote?.outputToken,
              },
              walletAddress,
              sessionId,
              async (confirmation) => {
                // TowerSwapExecutor settles user output and platform fee in this transaction.
                console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â");
                console.log("SWAP CONFIRMATION RECEIVED");
                console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â");
                console.log("Swap confirmed:", confirmation);

                // Submit fee using captured quote data
                console.log("Quote data available:", !!quote);
                console.log("Confirmation status:", confirmation.status);
                console.log(
                  "walletAddress captured:",
                  !!walletAddress,
                  walletAddress?.substring(0, 6) + "...",
                );

                // Detailed quote inspection
                if (quote) {
                  console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ Quote Details ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬");
                  console.log("quote.outputToken:", quote.outputToken);
                  console.log(
                    "quote.outputToken length:",
                    quote.outputToken?.length,
                  );
                  console.log(
                    "quote.outputToken valid?",
                    quote.outputToken?.length === 42 &&
                      quote.outputToken?.startsWith("0x"),
                  );
                  console.log("quote.outputAmount:", quote.outputAmount);
                  console.log("quote.inputToken:", quote.inputToken);
                  console.log("quote.inputAmount:", quote.inputAmount);
                  console.log(
                    "Full quote object:",
                    JSON.stringify(quote, null, 2),
                  );
                }

                if (quote && confirmation.status === "success") {
                  const swapActivityId = await logAiSwapActivity({
                    walletAddress,
                    quote,
                    transactionHash: confirmation.transactionHash,
                  });

                  console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ Initiating Fee Submission ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬");

                  const feeTokenAddress =
                    typeof txData?.feeToken === "string" && txData.feeToken
                      ? txData.feeToken
                      : quote.inputToken;
                  const executorFeeAmount =
                    typeof txData?.platformFeeAmount === "string"
                      ? txData.platformFeeAmount
                      : null;
                  const inputAmountNative =
                    normalizeAiQuoteAmountToTokenDecimals(
                      quote.inputAmount,
                      quote.inputToken,
                    );
                  const isValidAmount =
                    executorFeeAmount && BigInt(executorFeeAmount) > 0n;
                  const isValidToken =
                    feeTokenAddress?.length === 42 &&
                    feeTokenAddress.startsWith("0x");

                  console.log("Executor fee tracking validation:", {
                    tokenValid: isValidToken,
                    amountValid: isValidAmount,
                    walletValid:
                      walletAddress?.length === 42 &&
                      walletAddress?.startsWith("0x"),
                    feeTokenAddress,
                    executorFeeAmount,
                    inputAmount: quote.inputAmount,
                    inputAmountNative,
                    feeMode: txData?.feeMode,
                  });

                  if (!isValidToken || !isValidAmount) {
                    console.error(
                      "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Invalid quote data - cannot submit fee:",
                      {
                        feeTokenAddress,
                        executorFeeAmount,
                      },
                    );
                    pushAssistantMessage(
                      "Swap confirmed, but fee tracking could not be completed because the executor fee details were missing.",
                    );
                  } else {
                    console.log(
                      "Submitting platform fee after swap confirmation...",
                      {
                        feeTokenAddress,
                        feeAmount: executorFeeAmount,
                        totalAmount: inputAmountNative,
                        userAddress: walletAddress,
                        feeBps: txData?.feeBps ?? 25,
                      },
                    );
                    try {
                      if (!inputAmountNative) {
                        throw new Error(
                          "Executor swap input amount could not be normalized.",
                        );
                      }

                      const feeResult = await recordExecutorSwapFee({
                        walletAddress,
                        tokenAddress: feeTokenAddress,
                        tokenSymbol: getTokenSymbolByAddress(feeTokenAddress),
                        totalAmount: inputAmountNative,
                        feeAmount: executorFeeAmount,
                        feeBps:
                          typeof txData?.feeBps === "number"
                            ? txData.feeBps
                            : 25,
                        transactionHash: confirmation.transactionHash,
                        blockNumber: confirmation.blockNumber,
                        activityId: swapActivityId,
                      });
                      if (feeResult.success) {
                        console.log("Executor swap fee recorded successfully!");
                      } else {
                        console.warn(
                          "Executor swap fee tracking failed",
                          feeResult.error,
                        );
                        pushAssistantMessage(
                          "Swap confirmed, but fee tracking failed. Please contact support with your transaction hash.",
                        );
                      }
                    } catch (feeError) {
                      console.error(
                        "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error submitting platform fee:",
                        feeError,
                      );
                      pushAssistantMessage(
                        "Swap confirmed, but fee tracking failed. Please contact support with your transaction hash.",
                      );
                    }
                  }
                } else {
                  console.warn(
                    "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Fee submission skipped - quote missing or confirmation failed",
                    {
                      quote: !!quote,
                      status: confirmation.status,
                    },
                  );
                }
                console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â");
              },
            );
          } catch (swapError) {
            console.error("Swap execution error:", swapError);
            // Error is handled by the hook's state
          }
        }
      }

      if (response.data?.bridge_execution?.request) {
        const bridgeRequest = response.data.bridge_execution.request;
        const isSolanaSourceChain = isSolanaBridgeChain(bridgeRequest.fromChain);
        const isSolanaDestinationChain = isSolanaBridgeChain(bridgeRequest.toChain);
        const sourceAddress =
          bridgeRequest.sourceAddress ||
          (isSolanaSourceChain ? solanaAddress || "" : walletAddress);
        const toAddress =
          bridgeRequest.toAddress ||
          (isSolanaDestinationChain ? solanaAddress || "" : walletAddress);

        console.log("Bridge execution data detected:", bridgeRequest);
        setActiveBridgeRequest({
          ...bridgeRequest,
          sourceAddress,
          toAddress,
        });
        setShowBridgeConfirmation(true);

        if (isSolanaSourceChain && !isSolanaConnected) {
          openSolanaConnectModal();
          setShowBridgeConfirmation(false);
          setActiveBridgeRequest(null);
          pushAssistantMessage("Please connect your Solana wallet first.");
        } else {
          const connectedSourceAddress = isSolanaSourceChain
            ? solanaAddress || ""
            : walletAddress;
          const isMatchingConnectedWallet = isSolanaSourceChain
            ? sourceAddress === connectedSourceAddress
            : sourceAddress.toLowerCase() === connectedSourceAddress.toLowerCase();

          if (!isMatchingConnectedWallet) {
            setShowBridgeConfirmation(false);
            setActiveBridgeRequest(null);
            pushAssistantMessage(
              isSolanaSourceChain
                ? "Bridge source address must match your connected Solana wallet before signing."
                : "Bridge source address must match your connected wallet before signing.",
            );
          } else {
            try {
              if (isSolanaBridgeChain(bridgeRequest.toChain) && !toAddress) {
                setShowBridgeConfirmation(false);
                setActiveBridgeRequest(null);
                pushAssistantMessage(
                  "Please include a Solana receiving address to continue.",
                );
                return;
              }

              const result = await bridgeHook.executeBridge({
                fromChain: bridgeRequest.fromChain,
                toChain: bridgeRequest.toChain,
                amount: bridgeRequest.amount,
                token: bridgeRequest.token || "USDC",
                sourceAddress: connectedSourceAddress,
                toAddress,
              });

              if (result.success) {
                const tokenSymbol = bridgeRequest.token || "USDC";
                const bridgeFeeQuote = await getBridgeFees(
                  bridgeRequest.fromChain,
                  bridgeRequest.toChain,
                  bridgeRequest.amount,
                  tokenSymbol,
                );
                const fromChainName = getBridgeChainName(bridgeRequest.fromChain);
                const toChainName = getBridgeChainName(bridgeRequest.toChain);
                const fromChainConfig =
                  SUPPORTED_CHAINS[
                    bridgeRequest.fromChain as keyof typeof SUPPORTED_CHAINS
                  ];
                const toChainConfig =
                  SUPPORTED_CHAINS[
                    bridgeRequest.toChain as keyof typeof SUPPORTED_CHAINS
                  ];
                const bridgeFeeRecipientAddress = bridgeFeeQuote.customFeeEnabled
                  ? isSolanaBridgeChain(bridgeRequest.fromChain)
                    ? process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT_SOLANA?.trim() ||
                      null
                    : process.env.NEXT_PUBLIC_BRIDGE_FEE_RECIPIENT_EVM?.trim() ||
                      null
                  : null;
                const activityResult = await registerBridgeActivity({
                  walletAddress,
                  fromChain: fromChainName,
                  toChain: toChainName,
                  amount: bridgeRequest.amount,
                  token: tokenSymbol,
                  transactionHash: result.transactionHash,
                  fee: bridgeFeeQuote.totalFee,
                  status: result.status === "pending" ? "Pending" : "Successful",
                  destinationAddress: toAddress || undefined,
                });

                await registerBridgeFee({
                  walletAddress,
                  fromChain: fromChainName,
                  toChain: toChainName,
                  sourceTokenAddress: fromChainConfig?.usdcAddress || null,
                  destinationTokenAddress: toChainConfig?.usdcAddress || null,
                  tokenSymbol,
                  bridgeAmount: bridgeRequest.amount,
                  platformFeeAmount: bridgeFeeQuote.platformFee,
                  platformFeeAmountUsd: bridgeFeeQuote.platformFee,
                  protocolFeeAmount: bridgeFeeQuote.circleFee,
                  protocolFeeAmountUsd: bridgeFeeQuote.circleFee,
                  totalFeeAmount: bridgeFeeQuote.totalFee,
                  totalFeeAmountUsd: bridgeFeeQuote.totalFee,
                  amountReceived: bridgeFeeQuote.amountReceived,
                  sourceDebitTotal: bridgeFeeQuote.sourceDebitTotal,
                  feeType: "Flat",
                  feeRecipientAddress: bridgeFeeRecipientAddress,
                  protocolProvider: "Circle",
                  transactionHash: result.transactionHash,
                  status: result.status === "pending" ? "Pending" : "Recorded",
                  activityId: activityResult.id ?? null,
                });
              }
            } catch (bridgeError) {
              console.error("Bridge execution error:", bridgeError);
            }
          }
        }
      }
      // Save chat to Supabase
      const savedChatMessage = await saveChatMessageToHistory(
        walletAddress,
        sessionId,
        text,
        response.reply,
      );

      // Update session title and message count
      const conversationStartedAt = savedChatMessage?.created_at
        ? new Date(savedChatMessage.created_at).getTime()
        : Date.now();

      setSessions((prevSessions) => {
        const updatedSessions = prevSessions.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }

          return {
            ...session,
            title: isGenericSessionTitle(session.title)
              ? formatSessionTitle(text)
              : session.title,
            timestamp:
              session.messageCount === 0
                ? conversationStartedAt
                : session.timestamp,
            messageCount: session.messageCount + 1,
          };
        });

        saveSessions(walletAddress, updatedSessions);
        return updatedSessions;
      });

    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to get response";
      pushAssistantMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };
  // The recorder's onstop fires after later renders; always send with the
  // latest handler so it sees the current session and messages.
  handleSendMessageRef.current = handleSendMessage;

  const stopVoiceRecording = () => {
    if (voiceStopTimerRef.current) {
      clearTimeout(voiceStopTimerRef.current);
      voiceStopTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const startVoiceRecording = async () => {
    const walletAddress = user?.wallet?.address?.toLowerCase();
    if (!walletAddress) {
      pushAssistantMessage("Please connect your wallet first");
      return;
    }
    if (atlasAuthRequired && !hasAtlasAccess) {
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      pushAssistantMessage("Voice notes aren't supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      pushAssistantMessage(
        "Microphone access was blocked. Allow it in your browser to send voice notes.",
      );
      return;
    }

    // Chrome/Firefox record webm/opus, Safari records mp4; Atlas decodes all.
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const recordingStartedAt = Date.now();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;

      const audio = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (audio.size === 0) {
        setVoiceState("idle");
        return;
      }

      setVoiceState("transcribing");
      let transcript = "";
      try {
        transcript = await transcribeVoiceNote(audio, walletAddress);
      } catch (error) {
        pushAssistantMessage(
          error instanceof Error ? error.message : "Could not transcribe audio",
        );
        setVoiceState("idle");
        return;
      }
      setVoiceState("idle");

      if (!transcript) {
        pushAssistantMessage(
          "I couldn't hear anything in that voice note. Please try again.",
        );
        return;
      }
      const url = URL.createObjectURL(audio);
      voiceNoteUrlsRef.current.push(url);
      await handleSendMessageRef.current?.(transcript, {
        url,
        durationSec: (Date.now() - recordingStartedAt) / 1000,
      });
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setVoiceState("recording");
    voiceStopTimerRef.current = setTimeout(stopVoiceRecording, MAX_VOICE_NOTE_MS);
  };

  const handleVoiceButtonClick = () => {
    if (voiceState === "recording") {
      stopVoiceRecording();
    } else if (voiceState === "idle") {
      void startVoiceRecording();
    }
  };

  // Leaving the page mid-recording: release the mic and drop the note.
  useEffect(() => {
    const voiceNoteUrls = voiceNoteUrlsRef.current;
    return () => {
      voiceNoteUrls.forEach((url) => URL.revokeObjectURL(url));
      if (voiceStopTimerRef.current) {
        clearTimeout(voiceStopTimerRef.current);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handlePromptClick = (prompt: string) => {
    setActivePrompt(prompt);
    setMessages([]);
    handleSendMessage(prompt);
  };

  const handleReset = () => {
    setActivePrompt(null);
    setMessages([]);
    setIsLoading(false);
    setShowSwapConfirmation(false);
    setShowBridgeConfirmation(false);
    setActiveBridgeRequest(null);
    reportedSwapErrorRef.current = null;
    reportedBridgeErrorRef.current = null;
    swapExecution.resetState();
    bridgeHook.resetBridgeState();
  };

  useEffect(() => {
    if (swapExecution.status !== "error") {
      if (swapExecution.status === "idle") {
        reportedSwapErrorRef.current = null;
      }
      return;
    }

    const message = swapExecution.error || "The swap could not be completed.";
    if (reportedSwapErrorRef.current === message) {
      return;
    }

    reportedSwapErrorRef.current = message;
    pushAssistantMessage(message);
    setShowSwapConfirmation(false);
  }, [pushAssistantMessage, swapExecution.error, swapExecution.status]);

  useEffect(() => {
    if (!bridgeHook.error) {
      reportedBridgeErrorRef.current = null;
      return;
    }

    if (reportedBridgeErrorRef.current === bridgeHook.error) {
      return;
    }

    reportedBridgeErrorRef.current = bridgeHook.error;
    pushAssistantMessage(bridgeHook.error);
    setShowBridgeConfirmation(false);
    setActiveBridgeRequest(null);
  }, [bridgeHook.error, pushAssistantMessage]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(message);
      setActivePrompt(null);
    }
  };

  useEffect(() => {
    const textarea = messageInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const maxHeight = 144;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 32), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [message]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 50;
    const isTop = element.scrollTop === 0;
    setIsAtBottom(isBottom);
    setIsAtTop(isTop);
  };

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const scrollToTop = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  };

  const hasMessages = messages.length > 0;
  const hasConversationContent =
    hasMessages || showSwapConfirmation || showBridgeConfirmation;
  const bridgeConfirmationStatus = bridgeHook.error
    ? "error"
    : bridgeHook.isBridging
      ? "signing"
      : bridgeHook.success
        ? "confirmed"
        : "idle";
  const bridgeExplorerChain = activeBridgeRequest
    ? bridgeHook.status === "completed"
      ? activeBridgeRequest.toChain
      : activeBridgeRequest.fromChain
    : null;
  const bridgeExplorerUrl =
    getBridgeTransactionUrl(
      bridgeExplorerChain,
      bridgeHook.transactionHash,
    ) ?? undefined;
  const bridgeStatusMessage = bridgeHook.isBridging
    ? "Follow the wallet prompts to submit the bridge transaction."
    : bridgeHook.message ||
      (bridgeHook.status === "pending"
        ? "Bridge submitted and still settling across chains."
        : "Bridge transaction submitted.");
  const bridgeConfirmationTitle = bridgeHook.error
    ? "Bridge Failed"
    : bridgeHook.isBridging
      ? "Bridge In Progress"
      : bridgeHook.status === "pending"
        ? "Bridge Submitted"
        : bridgeHook.success
          ? "Bridge Confirmed"
          : "Preparing Bridge";

  useEffect(() => {
    if (showSwapConfirmation && swapConfirmationInsertIndex === null) {
      setSwapConfirmationInsertIndex(messages.length);
      return;
    }

    if (!showSwapConfirmation && swapConfirmationInsertIndex !== null) {
      setSwapConfirmationInsertIndex(null);
    }
  }, [messages.length, showSwapConfirmation, swapConfirmationInsertIndex]);

  useEffect(() => {
    if (showBridgeConfirmation && bridgeConfirmationInsertIndex === null) {
      setBridgeConfirmationInsertIndex(messages.length);
      return;
    }

    if (!showBridgeConfirmation && bridgeConfirmationInsertIndex !== null) {
      setBridgeConfirmationInsertIndex(null);
    }
  }, [
    messages.length,
    showBridgeConfirmation,
    bridgeConfirmationInsertIndex,
  ]);

  const swapConfirmationAnchorIndex = showSwapConfirmation
    ? Math.min(swapConfirmationInsertIndex ?? messages.length, messages.length)
    : null;
  const bridgeConfirmationAnchorIndex = showBridgeConfirmation
    ? Math.min(
        bridgeConfirmationInsertIndex ?? messages.length,
        messages.length,
      )
    : null;

  const renderSwapConfirmationRow = () =>
    swapExecution.status === "error" ? null : (
    <div className="flex justify-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
        <Image
          src={chatLogo}
          alt="Tower logo"
          width={28}
          height={28}
          className="object-contain"
        />
      </div>
      <div className="w-full max-w-[calc(100%-3.25rem)] sm:max-w-[28rem]">
        <TransactionConfirmation
          status={swapExecution.status}
          statusMessage={swapExecution.statusMessage}
          transactionHash={swapExecution.transactionHash}
          blockNumber={swapExecution.blockNumber}
          error={swapExecution.error}
          onClose={() => {
            setShowSwapConfirmation(false);
            swapExecution.resetState();
          }}
        />
      </div>
    </div>
    );

  const renderBridgeConfirmationRow = () =>
    bridgeHook.error ? null : (
    <div className="flex justify-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
        <Image
          src={chatLogo}
          alt="Tower logo"
          width={28}
          height={28}
          className="object-contain"
        />
      </div>
      <div className="w-full max-w-[calc(100%-3.25rem)] sm:max-w-[28rem]">
        <TransactionConfirmation
          status={bridgeConfirmationStatus}
          statusMessage={bridgeStatusMessage}
          transactionHash={bridgeHook.transactionHash}
          error={bridgeHook.error}
          title={bridgeConfirmationTitle}
          explorerUrl={bridgeExplorerUrl}
          onClose={() => {
            setShowBridgeConfirmation(false);
            setActiveBridgeRequest(null);
            bridgeHook.resetBridgeState();
          }}
        />
      </div>
    </div>
  );

  const renderConfirmationRowsAtIndex = (index: number) => (
    <>
      {showSwapConfirmation && swapConfirmationAnchorIndex === index
        ? renderSwapConfirmationRow()
        : null}
      {showBridgeConfirmation && bridgeConfirmationAnchorIndex === index
        ? renderBridgeConfirmationRow()
        : null}
    </>
  );

  useEffect(() => {
    if (
      !messagesContainerRef.current ||
      !hasConversationContent
    ) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [
    hasConversationContent,
    isLoading,
    messages.length,
    showBridgeConfirmation,
    showSwapConfirmation,
    bridgeHook.error,
    bridgeHook.isBridging,
    bridgeHook.status,
    bridgeHook.transactionHash,
    swapExecution.status,
    swapExecution.statusMessage,
  ]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden rounded-[24px] sm:rounded-[28px] border border-border bg-card/95 backdrop-blur-xl shadow-[0_22px_70px_rgba(0,0,0,0.08)] dark:shadow-[0_22px_70px_rgba(0,0,0,0.36)]">
      <AtlasAuthGate onAccessChange={setHasAtlasAccess} />
      <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_16%_82%,rgba(96,154,255,0.08),transparent_30%)] dark:bg-[radial-gradient(circle_at_16%_82%,rgba(96,154,255,0.16),transparent_30%),radial-gradient(circle_at_58%_100%,rgba(51,88,148,0.22),transparent_38%),linear-gradient(180deg,#090a0d_0%,#0b0d11_46%,#10161e_100%)] sm:block" />

      <motion.div
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -320 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-y-0 left-0 z-40 flex w-[min(88vw,18rem)] flex-col overflow-hidden border-r border-border bg-card/95 backdrop-blur-2xl sm:w-72"
      >
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Conversations
          </p>
          <button
            onClick={() => {
              handleReset();
              startNewChat();
            }}
            className="mt-4 flex w-full items-center justify-start gap-2.5 rounded-2xl bg-primary px-4 py-3 font-semibold text-[#081019] transition-colors hover:bg-primary/90"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {sessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            sessions.map((session) => (
              <motion.div
                key={session.id}
                whileHover={{ x: 4 }}
                className={`group relative cursor-pointer rounded-2xl border px-3 py-3 transition-colors ${
                  sessionId === session.id
                    ? "border-primary/45 bg-primary/10"
                    : "border-transparent bg-transparent hover:border-border hover:bg-secondary"
                }`}
                onClick={() => switchSession(session.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {session.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(session.timestamp).toLocaleDateString()}
                  </p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                  className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                  aria-label="Delete session"
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setSidebarOpen(false)}
          className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
        />
      )}

      <div className="relative z-10 flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center px-4 pt-4 sm:px-6 sm:pt-5 lg:px-7">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-[#7BB8FF] transition-colors hover:border-border hover:bg-accent sm:h-10 sm:w-10"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} className="text-white" />}
          </button>
        </div>


        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="chat-scrollbar absolute inset-0 overflow-y-scroll overscroll-contain pr-1"
          >
            {hasConversationContent ? (
              <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.5rem)] pt-5 sm:px-6 sm:pb-32 sm:pt-7 lg:px-7">
                {messages.map((msg, index) => (
                  <Fragment key={msg.id}>
                    {renderConfirmationRowsAtIndex(index)}
                    <div
                      className={`flex gap-3 ${
                        msg.isUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!msg.isUser && (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
                          <Image
                            src={chatLogo}
                            alt="Tower logo"
                            width={28}
                            height={28}
                            className="object-contain"
                          />
                        </div>
                      )}

                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`relative max-w-[calc(100%-3.25rem)] sm:max-w-[80%] ${
                          msg.isUser
                            ? "rounded-[20px] bg-primary px-4 py-3 text-[#081019] sm:rounded-[22px] sm:px-5 overflow-hidden wrap-break-word"
                            : msg.text === "Trading Volume"
                              ? "rounded-[20px] border border-border bg-card/92 p-4 text-foreground backdrop-blur-xl sm:rounded-[24px]"
                              : "rounded-[20px] border border-border bg-card/92 px-4 py-4 text-foreground backdrop-blur-xl sm:rounded-[24px] sm:px-5"
                        }`}
                      >
                        {msg.voiceNote ? (
                          msg.isUser ? (
                            <VoiceNoteBubble voiceNote={msg.voiceNote} />
                          ) : (
                            <div>
                              <VoiceNoteBubble
                                voiceNote={msg.voiceNote}
                                variant="assistant"
                              />
                              <details className="mt-2 text-xs text-muted-foreground">
                                <summary className="cursor-pointer select-none">
                                  Show text
                                </summary>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground wrap-break-word">
                                  {msg.text}
                                </p>
                              </details>
                            </div>
                          )
                        ) : msg.text === "Trading Volume" ? (
                          <div>
                            <div className="mb-4 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">
                                  Trading Volume
                                </span>
                                <div className="relative group">
                                  <button
                                    onClick={() =>
                                      isTouchDevice &&
                                      setShowInfoTooltip(!showInfoTooltip)
                                    }
                                    onMouseEnter={() =>
                                      !isTouchDevice &&
                                      setShowInfoTooltip(true)
                                    }
                                    onMouseLeave={() =>
                                      !isTouchDevice &&
                                      setShowInfoTooltip(false)
                                    }
                                    className="p-1 text-muted-foreground group-hover:text-foreground transition-colors"
                                    aria-label="Trading volume information"
                                  >
                                    <Info size={16} />
                                  </button>
                                  {showInfoTooltip && (
                                    <motion.div
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -10 }}
                                      className="absolute top-full mt-2 left-0 z-50 w-48 rounded-lg bg-popover/95 border border-border px-3 py-2 text-xs text-muted-foreground backdrop-blur-md"
                                    >
                                      Your total trading volume across 24H, 7D,
                                      30D, or all-time periods.
                                    </motion.div>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                {["24H", "7D", "30D", "ALL"].map((tf, idx) => (
                                  <button
                                    key={tf}
                                    className={`rounded-lg px-3 py-1 text-xs ${
                                      idx === 1
                                        ? "bg-primary text-[#081019]"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    {tf}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="mb-1 text-2xl font-bold">
                              $44,238 USD
                            </div>
                            <div className="mb-4 text-sm text-muted-foreground">
                              Jan, 2026 8:00 AM
                            </div>
                            <div className="relative h-32">
                              <svg
                                className="h-full w-full"
                                viewBox="0 0 400 100"
                              >
                                <polyline
                                  points="0,60 50,40 100,70 150,50 200,20 250,40 300,70 350,50 400,30"
                                  fill="none"
                                  stroke="#7bb8ff"
                                  strokeWidth="2"
                                />
                              </svg>
                            </div>
                          </div>
                        ) : (
                          <p
                            className={`text-sm leading-6 sm:leading-7 wrap-break-word ${
                              msg.isUser ? "" : "whitespace-pre-wrap"
                            }`}
                          >
                            {msg.text}
                          </p>
                        )}
                      </motion.div>

                      {msg.isUser && (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                          {profilePictureUrl && !profileImageError ? (
                            <Image
                              src={profilePictureUrl}
                              alt="User avatar"
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                              onError={() => {
                                console.error(
                                  "Failed to load profile image:",
                                  profilePictureUrl,
                                );
                                setProfileImageError(true);
                              }}
                              unoptimized={true}
                            />
                          ) : (
                            <span className="text-sm font-semibold text-foreground">
                              {user?.wallet?.address
                                ?.substring(0, 1)
                                .toUpperCase() || "U"}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </Fragment>
                ))}
                {renderConfirmationRowsAtIndex(messages.length)}

                {isLoading && (
                  <div className="flex justify-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
                      <Image
                        src={chatLogo}
                        alt="Tower logo"
                        width={28}
                        height={28}
                        className="object-contain"
                      />
                    </div>
                    <div className="rounded-[24px] border border-border bg-card/92 px-5 py-4 backdrop-blur-xl">
                      <div className="flex gap-1">
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: 0,
                          }}
                          className="h-2 w-2 rounded-full bg-gray-400"
                        />
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: 0.2,
                          }}
                          className="h-2 w-2 rounded-full bg-gray-400"
                        />
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: 0.4,
                          }}
                          className="h-2 w-2 rounded-full bg-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col justify-center px-4 pb-20 pt-4 sm:px-6 sm:pb-24 sm:pt-6 lg:px-7">
                <div className="w-full max-w-[32rem]">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.35 }}
                    className="mb-8 flex h-20 w-20 items-center justify-center"
                  >
                    <Image
                      src={chatLogo}
                      alt="Tower chat logo"
                      width={48}
                      height={48}
                      className="object-contain"
                    />
                  </motion.div>

                  <div className="flex flex-col gap-3">
                    {quickPrompts.map((prompt, index) => (
                      <motion.button
                        key={prompt}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.08, duration: 0.3 }}
                        whileHover={{ x: 4 }}
                        whileTap={{ scale: 0.98 }}
                        className={`w-full max-w-[22rem] rounded-[20px] border px-4 py-3 text-left text-[0.9rem] leading-6 transition-all sm:w-fit sm:min-w-[14rem] sm:max-w-none sm:whitespace-nowrap sm:rounded-full sm:px-5 sm:py-3.5 sm:text-[0.92rem] ${
                          activePrompt === prompt
                            ? "border-primary bg-primary/10 text-foreground shadow-sm"
                            : "border-primary/40 bg-card text-foreground hover:border-primary hover:bg-secondary"
                        }`}
                        onClick={() => handlePromptClick(prompt)}
                      >
                        {prompt}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/75 to-transparent sm:h-36 sm:block" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3 sm:px-6 sm:pb-6 sm:pt-8 lg:px-7">
          <div className="mx-auto w-full max-w-[52rem]">
            <div className="relative mx-auto w-full max-w-none sm:max-w-[44rem]">
              <AnimatePresence>
                {hasMessages && (!isAtBottom || !isAtTop) && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, y: 8, scale: 0.9, x: "-50%" }}
                    animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                    exit={{ opacity: 0, y: 8, scale: 0.9, x: "-50%" }}
                    transition={{ duration: 0.15 }}
                    onClick={isAtBottom ? scrollToTop : scrollToBottom}
                    className="pointer-events-auto absolute -top-11 sm:-top-12 left-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-colors hover:border-border hover:bg-accent"
                    aria-label={isAtBottom ? "Scroll to top" : "Scroll to bottom"}
                  >
                    {isAtBottom ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  </motion.button>
                )}
              </AnimatePresence>

              <div
                className="tower-chat-input-shell pointer-events-auto relative rounded-[20px] border border-border bg-secondary px-3.5 py-2 shadow-[0_16px_44px_rgba(0,0,0,0.08)] focus-within:border-primary/40 focus-within:outline-none focus-within:ring-0 sm:rounded-[22px] sm:px-4 sm:py-2.5 dark:shadow-[0_16px_44px_rgba(0,0,0,0.36)]"
                style={{
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div className="flex items-end gap-2">
                  <textarea
                    ref={messageInputRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Ask Tower anything..."
                    rows={1}
                    className="tower-chat-input min-h-[32px] flex-1 resize-none appearance-none border-0 bg-transparent py-1 text-[0.88rem] leading-5 text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 caret-foreground"
                    style={{
                      outline: "none",
                      boxShadow: "none",
                      borderRadius: 0,
                      WebkitAppearance: "none",
                      appearance: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  />
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => handleSendMessage(message)}
                    className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7bb8ff] text-[#0C0C0D]"
                    aria-label="Send message"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={handleVoiceButtonClick}
                    disabled={
                      voiceState === "transcribing" ||
                      (voiceState === "idle" && isLoading)
                    }
                    className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      voiceState === "recording"
                        ? "animate-pulse border-red-500 bg-red-500 text-white hover:bg-red-600"
                        : "border-border bg-card text-foreground hover:bg-accent"
                    }`}
                    aria-label={
                      voiceState === "recording"
                        ? "Stop recording and send voice note"
                        : voiceState === "transcribing"
                          ? "Transcribing voice note"
                          : "Record a voice note"
                    }
                  >
                    {voiceState === "recording" ? (
                      <Square className="h-3 w-3 fill-current" />
                    ) : voiceState === "transcribing" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" />
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};






