// Token icon mapping utility
// Maps token tickers to their icon paths in /public/assets

import { StaticImageData } from "next/image";
import usdcLogo from "@/public/assets/usdc.svg";
import ethLogo from "@/public/assets/Eth_logo_3-removebg-preview.png";
import eurcLogo from "@/public/assets/eurc.svg";
import usycLogo from "@/public/assets/USYC_LOGO.svg";
import hypeLogo from "@/public/assets/hype.png";
import usdtLogo from "@/public/assets/usdt.svg";
import uniLogo from "@/public/assets/Mainnet.svg";
import qtmLogo from "@/public/assets/quantum-logo.png";
import cirbtcLogo from "@/public/assets/cirbtc.svg";
import cngnLogo from "@/public/assets/cNGN.svg";
import qcadLogo from "@/public/assets/QCAD.svg";
import mxnbLogo from "@/public/assets/mxnb.svg";
import audfLogo from "@/public/assets/audf.svg";
import gbpaLogo from "@/public/assets/gbpa.svg";

export const TOKEN_ICONS: Record<string, StaticImageData> = {
  USDC: usdcLogo,
  WUSDC: usdcLogo,
  ETH: ethLogo,
  EURC: eurcLogo,
  USYC: usycLogo,
  HYPE: hypeLogo,
  USDT: usdtLogo,
  CIRBTC: cirbtcLogo,
  cirBTC: cirbtcLogo,
  CNGN: cngnLogo,
  cNGN: cngnLogo,
  QCAD: qcadLogo,
  GBPA: gbpaLogo,
  MXNB: mxnbLogo,
  AUDF: audfLogo,
  UNI: uniLogo,
  QTM: qtmLogo,
  SWPRC: usdcLogo, // Default to USDC logo if SWPRC logo not available
  // Add more token icons as needed
};

export const getTokenIcon = (ticker: string): StaticImageData | null => {
  return TOKEN_ICONS[ticker.toUpperCase()] || null;
};
