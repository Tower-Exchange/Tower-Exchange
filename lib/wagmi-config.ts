import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  bitgetWallet,
  coinbaseWallet,
  gateWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { blofinWallet } from "@/lib/wallets/blofinWallet";
import { createConfig, http } from "wagmi";
import {
  coinbaseWallet as coinbaseWalletConnector,
  injected,
} from "@wagmi/connectors";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  linea,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  sonic,
  unichain,
} from "viem/chains";

const rpcProxyUrl = (chainId: number) => `/api/rpc/${chainId}`;
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;
const appName = "Tower Exchange";

if (!walletConnectProjectId && process.env.NODE_ENV !== "production") {
  console.warn(
    "WalletConnect project ID is missing. RainbowKit will fall back to injected and Coinbase connectors, and mobile wallet selection will stay limited until NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is configured.",
  );
}

const ethereumMainnet = {
  ...mainnet,
  rpcUrls: {
    ...mainnet.rpcUrls,
    default: { http: ["https://ethereum.publicnode.com"] },
    public: { http: ["https://ethereum.publicnode.com"] },
  },
} as const;

// Arc Testnet Configuration
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Arc",
    symbol: "ARC",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
} as const;

const lineaSepolia = {
  id: 59141,
  name: "Linea Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: { http: ["https://rpc.sepolia.linea.build"] },
  },
  blockExplorers: {
    default: { name: "LineaScan", url: "https://sepolia.lineascan.build" },
  },
  testnet: true,
} as const;

const polygonAmoy = {
  id: 80002,
  name: "Polygon Amoy",
  nativeCurrency: {
    decimals: 18,
    name: "POL",
    symbol: "POL",
  },
  rpcUrls: {
    default: { http: ["https://rpc-amoy.polygon.technology"] },
  },
  blockExplorers: {
    default: { name: "PolygonScan", url: "https://amoy.polygonscan.com" },
  },
  testnet: true,
} as const;

const sonicTestnet = {
  id: 14601,
  name: "Sonic Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Sonic",
    symbol: "S",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.soniclabs.com"] },
  },
  blockExplorers: {
    default: { name: "SonicScan", url: "https://testnet.sonicscan.org" },
  },
  testnet: true,
} as const;

const unichainSepolia = {
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Uni",
    symbol: "UNI",
  },
  rpcUrls: {
    default: { http: ["https://sepolia.unichain.org"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://unichain-sepolia.blockscout.com",
    },
  },
  testnet: true,
} as const;

const arcMainnet = {
  id: 5042,
  name: "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.mainnet.arc.io",
        "https://rpc.blockdaemon.mainnet.arc.io",
        "https://rpc.drpc.mainnet.arc.io",
        "https://rpc.quicknode.mainnet.arc.io",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  testnet: false,
} as const;

const supportedChains = [
  ethereumMainnet,
  polygon,
  arbitrum,
  base,
  optimism,
  avalanche,
  linea,
  sonic,
  unichain,
  arcMainnet,
  sepolia,
  arcTestnet,
  baseSepolia,
  optimismSepolia,
  avalancheFuji,
  arbitrumSepolia,
  lineaSepolia,
  polygonAmoy,
  sonicTestnet,
  unichainSepolia,
] as const;

const connectors = walletConnectProjectId
  ? connectorsForWallets(
      [
        {
          groupName: "Default",
          wallets: [gateWallet],
        },
        {
          groupName: "Recommended",
          wallets: [bitgetWallet, blofinWallet, rabbyWallet, metaMaskWallet, coinbaseWallet],
        },
        {
          groupName: "Other wallets",
          wallets: [walletConnectWallet, injectedWallet, safeWallet],
        },
      ],
      {
        appName,
        projectId: walletConnectProjectId,
      },
    )
  : [
      injected({ shimDisconnect: true }),
      coinbaseWalletConnector({ appName }),
    ];

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors,
  multiInjectedProviderDiscovery: false,
  transports: {
    [ethereumMainnet.id]: http(rpcProxyUrl(ethereumMainnet.id)),
    [polygon.id]: http(rpcProxyUrl(polygon.id)),
    [arbitrum.id]: http(rpcProxyUrl(arbitrum.id)),
    [base.id]: http(rpcProxyUrl(base.id)),
    [optimism.id]: http(rpcProxyUrl(optimism.id)),
    [avalanche.id]: http(rpcProxyUrl(avalanche.id)),
    [linea.id]: http(rpcProxyUrl(linea.id)),
    [sonic.id]: http(rpcProxyUrl(sonic.id)),
    [unichain.id]: http(rpcProxyUrl(unichain.id)),
    [arcMainnet.id]: http(rpcProxyUrl(arcMainnet.id)),
    [sepolia.id]: http(rpcProxyUrl(sepolia.id)),
    [arcTestnet.id]: http(rpcProxyUrl(arcTestnet.id)),
    [baseSepolia.id]: http(rpcProxyUrl(baseSepolia.id)),
    [optimismSepolia.id]: http(rpcProxyUrl(optimismSepolia.id)),
    [avalancheFuji.id]: http(rpcProxyUrl(avalancheFuji.id)),
    [arbitrumSepolia.id]: http(rpcProxyUrl(arbitrumSepolia.id)),
    [lineaSepolia.id]: http(rpcProxyUrl(lineaSepolia.id)),
    [polygonAmoy.id]: http(rpcProxyUrl(polygonAmoy.id)),
    [sonicTestnet.id]: http(rpcProxyUrl(sonicTestnet.id)),
    [unichainSepolia.id]: http(rpcProxyUrl(unichainSepolia.id)),
  },
});
