import { NextRequest, NextResponse } from 'next/server';
import { getSynthraDexInfo } from '@/lib/synthraDex';
import {
  getTowerDexInfo,
  isTowerDexEnabled,
  TOWER_DEX_ID,
  TOWER_DEX_NAME,
} from "@/lib/towerDex";
import { getAeroDexInfo, AERO_DEX_ID, AERO_DEX_NAME } from "@/lib/aeroDex";
import {
  getKyberDexInfo,
  isKyberEnabled,
  KYBER_DEX_ID,
  KYBER_DEX_NAME,
} from "@/lib/kyberDex";
import {
  getUniswapDexInfo,
  isUniswapEnabled,
  UNISWAP_DEX_ID,
  UNISWAP_DEX_NAME,
} from "@/lib/uniswapDex";
import { getUnitFlowDexInfo } from '@/lib/unitflowDex';
import { resolveSwapBackendUrl } from '@/lib/resolveSwapBackendUrl';
import { withFrontendOriginGate } from "@/lib/server/frontendRequestGuard";

type DexInfo = {
  id: string;
  name: string;
  enabled: boolean;
  routerAddress?: string;
  factoryAddress?: string;
  quoterAddress?: string;
  universalRouterAddress?: string;
  multicallAddress?: string;
  permit2Address?: string;
  type?: string;
  chainId?: number;
  supportedTokens?: readonly string[];
  feeTiers?: readonly number[];
  poolAddresses?: readonly string[];
};

const HIDDEN_DEX_IDS = new Set([
  "swaparc",
  "quantum-exchange",
  "xylonet",
  "xylonet-adapter",
  "lifi",
  "de1",
  "de1-exchange",
]);
const SWAPS_DISABLED = process.env.SWAPS_DISABLED !== "false";
const SWAPS_DISABLED_MESSAGE =
  "Tower swaps are paused while the TowerSwapExecutor migration is being verified.";
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const UNITFLOW_ADAPTER_ADDRESS =
  process.env.UNITFLOW_ADAPTER_ADDRESS ||
  process.env.TOWER_UNITFLOW_ADAPTER_ADDRESS ||
  process.env.NEXT_PUBLIC_UNITFLOW_ADAPTER_ADDRESS;
const UNITFLOW_EXECUTOR_ENABLED = EVM_ADDRESS_PATTERN.test(
  UNITFLOW_ADAPTER_ADDRESS || "",
);

const getCanonicalSynthraDex = (): DexInfo => ({
  ...getSynthraDexInfo(),
  id: "synthra",
  name: "Synthra",
});

const getCanonicalUnitFlowDex = (): DexInfo => {
  const unitFlowDexInfo = getUnitFlowDexInfo();

  return {
    ...unitFlowDexInfo,
    id: "unitflow",
    name: "UnitFlow",
    routerAddress: UNITFLOW_EXECUTOR_ENABLED
      ? UNITFLOW_ADAPTER_ADDRESS || unitFlowDexInfo.routerAddress
      : unitFlowDexInfo.routerAddress,
    enabled: UNITFLOW_EXECUTOR_ENABLED,
  };
};

const getCanonicalTowerDex = (): DexInfo => ({
  ...getTowerDexInfo(),
  id: TOWER_DEX_ID,
  name: TOWER_DEX_NAME,
  enabled: isTowerDexEnabled(),
});

const getCanonicalAeroDex = (): DexInfo => ({
  ...getAeroDexInfo(),
  id: AERO_DEX_ID,
  name: AERO_DEX_NAME,
  enabled: true,
});

const getCanonicalKyberDex = (): DexInfo => ({
  ...getKyberDexInfo(),
  id: KYBER_DEX_ID,
  name: KYBER_DEX_NAME,
  enabled: isKyberEnabled(),
});

const getCanonicalUniswapDex = (): DexInfo => ({
  ...getUniswapDexInfo(),
  id: UNISWAP_DEX_ID,
  name: UNISWAP_DEX_NAME,
  enabled: isUniswapEnabled(),
});

const isExecutorUnsupportedDexId = (id: string) =>
  id === "unitflow" && !UNITFLOW_EXECUTOR_ENABLED;

const normalizeDex = (dex: DexInfo): DexInfo => {
  const id = String(dex.id || "").toLowerCase();
  const name = String(dex.name || "").toLowerCase();

  if (id === "synthra-v3" || id === "synthra" || name.includes("synthra")) {
    return {
      ...dex,
      id: "synthra",
      name: "Synthra",
      enabled: dex.enabled !== false,
    };
  }

  if (id === "unitflow-v3" || id === "unitflow" || name.includes("unitflow")) {
    return {
      ...dex,
      id: "unitflow",
      name: "UnitFlow",
      enabled: dex.enabled !== false,
    };
  }

  if (id === TOWER_DEX_ID || id === "tower" || name.includes("tower")) {
    return {
      ...dex,
      id: TOWER_DEX_ID,
      name: TOWER_DEX_NAME,
      enabled: dex.enabled !== false,
    };
  }

  if (id === AERO_DEX_ID || id === "aerodrome" || name.includes("aero") || name.includes("aerodrome")) {
    return {
      ...dex,
      id: AERO_DEX_ID,
      name: AERO_DEX_NAME,
      enabled: dex.enabled !== false,
    };
  }

  if (
    id === KYBER_DEX_ID ||
    id === "kyber" ||
    name.includes("kyber")
  ) {
    return {
      ...dex,
      id: KYBER_DEX_ID,
      name: KYBER_DEX_NAME,
      enabled: dex.enabled !== false,
    };
  }

  if (
    id === UNISWAP_DEX_ID ||
    id === "uni" ||
    id === "uniswap-v4" ||
    name.includes("uniswap")
  ) {
    return {
      ...dex,
      id: UNISWAP_DEX_ID,
      name: UNISWAP_DEX_NAME,
      enabled: dex.enabled !== false,
    };
  }

  return dex;
};

const getVisibleDexes = (dexes: DexInfo[]) => {
  const visibleDexes = new Map<string, DexInfo>();

  for (const rawDex of dexes) {
    const dex = normalizeDex(rawDex);
    const id = String(dex.id || "").toLowerCase();
    const name = String(dex.name || "").toLowerCase();

    if (
      HIDDEN_DEX_IDS.has(id) ||
      name.includes("swaparc") ||
      name.includes("quantum") ||
      name.includes("xylonet") ||
      name.includes("xylo") ||
      name.includes("li.fi") ||
      name.includes("de1")
    ) {
      continue;
    }

    if (!visibleDexes.has(id)) {
      visibleDexes.set(id, dex);
    }
  }

  return Array.from(visibleDexes.values()).map((dex) => {
    const id = String(dex.id || "").toLowerCase();

    return isExecutorUnsupportedDexId(id)
      ? { ...dex, enabled: false }
      : dex;
  });
};

/**
 * GET /api/swap/dexes
 * Returns list of available DEX routers for swap operations
 */
export async function getSwapDexesResponse() {
  try {
    const synthraDex = getCanonicalSynthraDex();
    const unitFlowDex = getCanonicalUnitFlowDex();
    const towerDex = isTowerDexEnabled() ? getCanonicalTowerDex() : null;
    const aeroDex = getCanonicalAeroDex();
    const kyberDex = isKyberEnabled() ? getCanonicalKyberDex() : null;
    const uniswapDex = isUniswapEnabled() ? getCanonicalUniswapDex() : null;
    const localDexes = [
      synthraDex,
      unitFlowDex,
      ...(towerDex ? [towerDex] : []),
      aeroDex,
      ...(kyberDex ? [kyberDex] : []),
      ...(uniswapDex ? [uniswapDex] : []),
    ];

    if (SWAPS_DISABLED) {
      return NextResponse.json({
        success: true,
        disabled: true,
        message: SWAPS_DISABLED_MESSAGE,
        data: localDexes.map((dex) => ({
          ...dex,
          enabled: false,
        })),
      });
    }

    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({
        success: true,
        data: getVisibleDexes(localDexes),
      });
    }

    // Fetch routers from backend API
    const backendUrl = resolveSwapBackendUrl();
    const response = await fetch(`${backendUrl}/api/swap/dexes`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Backend DEX API error:', response.statusText);
      return NextResponse.json({
        success: true,
        data: localDexes,
      });
    }

    const backendResponse = await response.json();
    console.log('[API Route] Backend response:', backendResponse);

    // Extract the data array from backend response
    const dexesArray = Array.isArray(backendResponse?.data) ? backendResponse.data : [];

    return NextResponse.json({
      success: true,
      data: getVisibleDexes([
        ...dexesArray,
        ...localDexes,
      ]),
    });
  } catch (error) {
    console.error('Error fetching DEXes:', error);
    const towerDex = isTowerDexEnabled() ? [getCanonicalTowerDex()] : [];
    const kyberDex = isKyberEnabled() ? [getCanonicalKyberDex()] : [];
    const uniswapDex = isUniswapEnabled() ? [getCanonicalUniswapDex()] : [];
    return NextResponse.json({
      success: true,
      data: [
        getCanonicalSynthraDex(),
        getCanonicalUnitFlowDex(),
        ...towerDex,
        getCanonicalAeroDex(),
        ...kyberDex,
        ...uniswapDex,
      ],
    });
  }
}

export const GET = withFrontendOriginGate(async (_request: NextRequest) =>
  getSwapDexesResponse(),
);
