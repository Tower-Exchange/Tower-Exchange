import { type StaticImageData } from "next/image";

import arcLogo from "@/public/assets/ARCSvg.svg";
import solanaLogo from "@/public/assets/solana.svg";
import baseLogo from "@/public/assets/Base Sepolia logo.svg";
import optimismLogo from "@/public/assets/Optimism Sepolia logo.svg";
import avalancheLogo from "@/public/assets/Avalanche Fuji logo.svg";
import arbitrumLogo from "@/public/assets/Arbitrum Sepolia logo (2).svg";
import ethereumLogo from "@/public/assets/EthLogo.svg";
import lineaLogo from "@/public/assets/Linea-Token_Round.svg";
import polygonLogo from "@/public/assets/polygon.svg";
import sonicLogo from "@/public/assets/S_token.svg";
import unichainLogo from "@/public/assets/Mainnet.svg";
import globeLogo from "@/public/assets/globe-removebg-preview.svg";

import {
  type BridgeNetworkMode,
  MAINNET_BRIDGE_CHAIN_IDS,
  TESTNET_BRIDGE_CHAIN_IDS,
} from "@/lib/bridgeNetworks";
import { isBridgeChainEnabled } from "@/lib/bridgeEnabled";

export type BridgeUiChain = {
  id: string;
  name: string;
  color: string;
  logo: StaticImageData;
  mode: BridgeNetworkMode;
};

export const ALL_CHAINS_OPTION: BridgeUiChain = {
  id: "all",
  name: "All Chains",
  color: "#4B5563",
  logo: globeLogo,
  mode: "testnet",
};

export const BRIDGE_UI_CHAINS: BridgeUiChain[] = [
  {
    id: "arc-testnet",
    name: "Arc Testnet",
    color: "#00AEEF",
    logo: arcLogo,
    mode: "testnet",
  },
  {
    id: "solana",
    name: "Solana Devnet",
    color: "#14F195",
    logo: solanaLogo,
    mode: "testnet",
  },
  {
    id: "base-sepolia",
    name: "Base Sepolia",
    color: "#0174F0",
    logo: baseLogo,
    mode: "testnet",
  },
  {
    id: "optimism-sepolia",
    name: "Optimism Sepolia",
    color: "#FF0420",
    logo: optimismLogo,
    mode: "testnet",
  },
  {
    id: "avalanche-fuji",
    name: "Avalanche Fuji",
    color: "#E84142",
    logo: avalancheLogo,
    mode: "testnet",
  },
  {
    id: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    color: "#2D374B",
    logo: arbitrumLogo,
    mode: "testnet",
  },
  {
    id: "ethereum-sepolia",
    name: "Ethereum Sepolia",
    color: "#627EEA",
    logo: ethereumLogo,
    mode: "testnet",
  },
  {
    id: "linea-sepolia",
    name: "Linea Sepolia",
    color: "#121212",
    logo: lineaLogo,
    mode: "testnet",
  },
  {
    id: "polygon-amoy",
    name: "Polygon Amoy",
    color: "#8247E5",
    logo: polygonLogo,
    mode: "testnet",
  },
  {
    id: "sonic-testnet",
    name: "Sonic Testnet",
    color: "#00D4AA",
    logo: sonicLogo,
    mode: "testnet",
  },
  {
    id: "unichain-sepolia",
    name: "Unichain Sepolia",
    color: "#FF007A",
    logo: unichainLogo,
    mode: "testnet",
  },
  {
    id: "arc",
    name: "Arc",
    color: "#00AEEF",
    logo: arcLogo,
    mode: "mainnet",
  },
  {
    id: "solana-mainnet",
    name: "Solana",
    color: "#14F195",
    logo: solanaLogo,
    mode: "mainnet",
  },
  {
    id: "base",
    name: "Base",
    color: "#0174F0",
    logo: baseLogo,
    mode: "mainnet",
  },
  {
    id: "optimism",
    name: "Optimism",
    color: "#FF0420",
    logo: optimismLogo,
    mode: "mainnet",
  },
  {
    id: "avalanche",
    name: "Avalanche",
    color: "#E84142",
    logo: avalancheLogo,
    mode: "mainnet",
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    color: "#2D374B",
    logo: arbitrumLogo,
    mode: "mainnet",
  },
  {
    id: "ethereum",
    name: "Ethereum",
    color: "#627EEA",
    logo: ethereumLogo,
    mode: "mainnet",
  },
  {
    id: "linea",
    name: "Linea",
    color: "#121212",
    logo: lineaLogo,
    mode: "mainnet",
  },
  {
    id: "polygon",
    name: "Polygon",
    color: "#8247E5",
    logo: polygonLogo,
    mode: "mainnet",
  },
  {
    id: "sonic",
    name: "Sonic",
    color: "#00D4AA",
    logo: sonicLogo,
    mode: "mainnet",
  },
  {
    id: "unichain",
    name: "Unichain",
    color: "#FF007A",
    logo: unichainLogo,
    mode: "mainnet",
  },
];

const CHAIN_ORDER: Record<BridgeNetworkMode, readonly string[]> = {
  testnet: TESTNET_BRIDGE_CHAIN_IDS,
  mainnet: MAINNET_BRIDGE_CHAIN_IDS,
};

export const getBridgeUiChains = (mode: BridgeNetworkMode) => {
  const order = CHAIN_ORDER[mode];
  return order
    .map((id) => BRIDGE_UI_CHAINS.find((chain) => chain.id === id))
    .filter(
      (chain): chain is BridgeUiChain =>
        chain !== undefined && isBridgeChainEnabled(chain.id),
    );
};

export const getBridgeSelectChains = (mode: BridgeNetworkMode) => {
  const chains = getBridgeUiChains(mode);
  return chains.length
    ? [{ ...ALL_CHAINS_OPTION, mode }, ...chains]
    : [];
};
