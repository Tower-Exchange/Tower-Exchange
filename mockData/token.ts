import { StaticImageData } from "next/image";
import usdcLogo from "@/public/assets/usdc.svg";
import eurcLogo from "@/public/assets/eurc.svg";
import gbpaLogo from "@/public/assets/gbpa.svg";
import usdtLogo from "@/public/assets/usdt.svg";
import cirbtcLogo from "@/public/assets/cirbtc.svg";
import cngnLogo from "@/public/assets/cNGN.svg";
import qcadLogo from "@/public/assets/QCAD.svg";
import mxnbLogo from "@/public/assets/mxnb.svg";
import audfLogo from "@/public/assets/audf.svg";
import { isStableFxCustomerVisibleCurrency } from "@/lib/stableFx";

export interface Token {
  symbol: string;
  price: string;
  change: string;
  icon: StaticImageData;
  color?: string;
  // optional fields for the hover overlay
  change24h?: string;
  marketCap?: string;
  chartData?: number[];
}

/**
 * Register all configured StableFX assets in one place. The customer-facing
 * currency gate keeps GBPA and AUDF off the marquee until launch; MXNB is the
 * only new StableFX ticker currently shown.
 */
const STABLEFX_MARQUEE_TOKENS: Token[] = [
  {
    symbol: "GBPA",
    price: "£1.00",
    change: "+0.0%",
    icon: gbpaLogo,
    color: "text-primary",
    change24h: "+0.0%",
    marketCap: "$--",
    chartData: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    symbol: "MXNB",
    price: "$0.055",
    change: "+0.0%",
    icon: mxnbLogo,
    color: "text-primary",
    change24h: "+0.0%",
    marketCap: "$--",
    chartData: [0.055, 0.055, 0.055, 0.055, 0.055, 0.055, 0.055, 0.055, 0.055],
  },
  {
    symbol: "AUDF",
    price: "$0.65",
    change: "+0.0%",
    icon: audfLogo,
    color: "text-primary",
    change24h: "+0.0%",
    marketCap: "$--",
    chartData: [0.65, 0.65, 0.65, 0.65, 0.65, 0.65, 0.65, 0.65, 0.65],
  },
].filter((token) =>
  isStableFxCustomerVisibleCurrency(
    token.symbol as "GBPA" | "MXNB" | "AUDF",
  ),
);

export const tokens: Token[] = [
  {
    symbol: "USDC",
    price: "$1.00",
    change: "+0.1%",
    icon: usdcLogo,
    color: "text-primary",
    change24h: "+0.1%",
    marketCap: "$32.5B",
    chartData: [0.99, 0.995, 1.0, 1.0, 1.0, 1.001, 1.0, 1.0, 1.0],
  },
  {
    symbol: "EURC",
    price: "$1.15",
    change: "-0.2%",
    icon: eurcLogo,
    color: "text-primary",
    change24h: "-0.2%",
    marketCap: "$500M",
    chartData: [1.152, 1.151, 1.15, 1.149, 1.148, 1.147, 1.15, 1.149, 1.15],
  },
  ...STABLEFX_MARQUEE_TOKENS,
  /*
  {
    symbol: "GBPA",
    price: "£1.00",
    change: "+0.0%",
    icon: gbpaLogo,
    color: "text-primary",
    change24h: "+0.0%",
    marketCap: "$--",
    chartData: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  */
  // {
  //   symbol: "USDT",
  //   price: "$1",
  //   change: "+0.0%",
  //   icon: usdtLogo,
  //   color: "text-primary",
  //   change24h: "+0.0%",
  //   marketCap: "$95.5B",
  //   chartData: [1.0, 1.0, 1.001, 1.0, 0.999, 1.0, 1.0, 1.001, 1.0],
  // },
  {
    symbol: "cirBTC",
    price: "$404,000",
    change: "+0.0%",
    icon: cirbtcLogo,
    color: "text-primary",
    change24h: "+0.0%",
    marketCap: "$--",
    chartData: [
      403000,
      404500,
      403800,
      404200,
      404000,
      404700,
      403900,
      404100,
      404000,
    ],
  },
  // {
  //   symbol: "cNGN",
  //   price: "$1.00",
  //   change: "+0.0%",
  //   icon: cngnLogo,
  //   color: "text-primary",
  //   change24h: "+0.0%",
  //   marketCap: "$--",
  //   chartData: [1.0, 1.0, 1.001, 1.0, 0.999, 1.0, 1.0, 1.001, 1.0],
  // },
  // {
  //   symbol: "QCAD",
  //   price: "$0.73",
  //   change: "+0.0%",
  //   icon: qcadLogo,
  //   color: "text-primary",
  //   change24h: "+0.0%",
  //   marketCap: "$--",
  //   chartData: [0.73, 0.731, 0.729, 0.73, 0.728, 0.73, 0.732, 0.73, 0.73],
  // },
  // {
  //   symbol: "SWPRC",
  //   price: "$0.85",
  //   change: "+3.5%",
  //   icon: swprcLogo,
  //   color: "text-success",
  //   change24h: "+3.5%",
  //   marketCap: "$250M",
  //   chartData: [0.80, 0.81, 0.82, 0.83, 0.82, 0.84, 0.85, 0.845, 0.85],
  // },
  // {
  //   symbol: "QTM",
  //   price: "$2.45",
  //   change: "+18.7%",
  //   icon: qtmLogo,
  //   color: "text-success",
  //   change24h: "+18.7%",
  //   marketCap: "$500M",
  //   chartData: [1.95, 2.05, 2.10, 2.20, 2.30, 2.35, 2.40, 2.43, 2.45],
  // },
  // {
  //   symbol: "WUSDC",
  //   price: "$1.00",
  //   change: "+0.2%",
  //   icon: usdcLogo, // Use USDC logo
  //   color: "text-primary",
  //   change24h: "+0.2%",
  //   marketCap: "$100M",
  //   chartData: [0.99, 0.995, 1.0, 1.0, 1.0, 1.001, 1.0, 1.0, 1.0],
  // },
  // {
  //   symbol: "USYC",
  //   price: "$1.05",
  //   change: "+2.3%",
  //   icon: usycLogo,
  //   color: "text-success",
  //   change24h: "+2.3%",
  //   marketCap: "$150M",
  //   chartData: [1.01, 1.02, 1.03, 1.02, 1.03, 1.04, 1.05, 1.04, 1.05],
  // },
];

export default tokens;
