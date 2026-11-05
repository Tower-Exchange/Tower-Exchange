const https = require("https");
const { URL } = require("url");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const LICENSE_TYPES = {
  none: "none",
  MIT: "mit",
  mit: "mit",
  "GPL-3.0": "gnu_gpl_v3",
  "GPL-2.0": "gnu_gpl_v2",
  "LGPL-3.0": "gnu_lgpl_v3",
  "Apache-2.0": "apache_2_0",
  "BSL-1.1": "bsl_1_1",
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAlreadyVerified = (message) =>
  /already verified/i.test(String(message || ""));

const isCloudflareChallenge = (status, text) =>
  status === 403 &&
  /just a moment|cf-mitigated|challenge-platform|cloudflare/i.test(
    String(text || ""),
  );

function getExplorerConfig(networkName) {
  if (networkName !== "arc-mainnet" && process.env.ARC_EXPLORER_API_URL) {
    return {
      apiURL: process.env.ARC_EXPLORER_API_URL.replace(/\/$/, ""),
      browserURL: (process.env.ARC_EXPLORER_URL || "https://explorer.arc.io").replace(
        /\/$/,
        "",
      ),
    };
  }

  if (networkName === "arc-testnet") {
    return {
      apiURL: "https://explorer.testnet.arc.io/api",
      browserURL: "https://explorer.testnet.arc.io",
    };
  }

  return {
    apiURL: "https://api.etherscan.io/v2/api",
    browserURL: (process.env.ARC_ETHERSCAN_URL || "https://arc.etherscan.io").replace(
      /\/$/,
      "",
    ),
  };
}

function getEtherscanApiKey() {
  return process.env.ETHERSCAN_API_KEY || "";
}

function getArcscanApiUrl(networkName) {
  return getExplorerConfig(networkName).apiURL;
}

function explorerV2Url(apiURL, path) {
  const base = apiURL.replace(/\/$/, "");
  return `${base}/v2${path.startsWith("/") ? path : `/${path}`}`;
}

function request(method, urlString, { body, contentType, headers } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload =
      body == null
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body);
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          Origin: `${url.protocol}//${url.hostname}`,
          Referer: `${url.protocol}//${url.hostname}/`,
          ...(payload
            ? {
                "Content-Type": contentType || "application/json",
                "Content-Length": payload.length,
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            // Keep the raw body when the explorer does not return JSON.
          }
          resolve({
            status: response.statusCode || 0,
            data,
            text,
          });
        });
      },
    );
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function requestJson(method, urlString, body) {
  return request(method, urlString, {
    body: body == null ? null : JSON.stringify(body),
    contentType: "application/json",
  });
}

function cloudflareError(explorer, result) {
  return new Error(
    `Cloudflare blocked ${explorer.browserURL}. Open the contract there and verify with Solidity Standard JSON, or retry from a network that can reach ${explorer.apiURL}.`,
  );
}

async function getVerifyOptions(networkName) {
  const explorer = getExplorerConfig(networkName);
  return requestJson(
    "GET",
    explorerV2Url(explorer.apiURL, "/smart-contracts/verification/config"),
  );
}

function sourcifyIsReady() {
  return true;
}

async function encodeConstructorArguments(hre, contractFQN, constructorArguments) {
  if (!constructorArguments || constructorArguments.length === 0) {
    return "";
  }

  const artifact = await hre.artifacts.readArtifact(contractFQN);
  const iface = new hre.ethers.Interface(artifact.abi);
  return iface.encodeDeploy(constructorArguments);
}

async function getBuildInfo(hre, contractFQN) {
  const buildInfo = await hre.artifacts.getBuildInfo(contractFQN);
  if (!buildInfo) {
    throw new Error(`No Hardhat build-info found for ${contractFQN}. Compile first.`);
  }
  return buildInfo;
}

async function verifyWithHardhat(hre, { address, constructorArguments, contract }) {
  await hre.run("verify:verify", {
    address,
    constructorArguments: constructorArguments || [],
    contract,
    force: process.env.VERIFY_FORCE === "true",
  });
}

function compilerVersion(buildInfo) {
  const version = String(buildInfo.solcLongVersion || buildInfo.solcVersion || "");
  return version.startsWith("v") ? version : `v${version}`;
}

function toStandardJsonInput(buildInfo) {
  const input = buildInfo?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Hardhat build-info is missing compiler input.");
  }
  if (!input.sources || typeof input.sources !== "object" || Array.isArray(input.sources)) {
    throw new Error("Hardhat compiler input is missing a sources object.");
  }
  return {
    language: input.language || "Solidity",
    sources: input.sources,
    settings: input.settings || {},
  };
}

function constructorArgsHex(value) {
  const encoded = String(value || "").trim();
  if (!encoded || encoded === "0x") {
    return "";
  }
  return encoded.replace(/^0x/i, "");
}

function contractNameOnly(contractFQN) {
  const value = String(contractFQN || "");
  const idx = value.lastIndexOf(":");
  return idx >= 0 ? value.slice(idx + 1) : value;
}

function licenseType(license) {
  return LICENSE_TYPES[license] || LICENSE_TYPES.MIT;
}

function isVerifiedPayload(data) {
  if (!data || typeof data !== "object") {
    return false;
  }
  if (data.is_verified || data.is_fully_verified || data.verified) {
    return true;
  }
  const source = data.result?.[0]?.SourceCode;
  return Boolean(source && source !== "");
}

async function readVerifiedSource(apiURL, address) {
  const v2 = await requestJson(
    "GET",
    explorerV2Url(apiURL, `/smart-contracts/${address}`),
  );
  if (v2.status && v2.status < 500 && !isCloudflareChallenge(v2.status, v2.text)) {
    return v2;
  }
  return requestJson(
    "GET",
    `${apiURL.replace(/\/$/, "")}?module=contract&action=getsourcecode&address=${address}`,
  );
}

function buildMultipart(fields, files) {
  const boundary = `----TowerVerify${Date.now()}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") {
      continue;
    }
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    );
  }
  for (const file of files) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type || "application/json"}\r\n\r\n`,
    );
    chunks.push(file.content);
    chunks.push("\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(
      chunks.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))),
    ),
  };
}

async function submitBlockscoutStandardInput({
  explorer,
  address,
  buildInfo,
  constructorArgumentsHex,
  license,
  contractFQN,
}) {
  const stdJson = JSON.stringify(toStandardJsonInput(buildInfo));
  const encoded = constructorArgsHex(constructorArgumentsHex);
  const fields = {
    compiler_version: compilerVersion(buildInfo),
    license_type: licenseType(license),
    contract_name: contractNameOnly(contractFQN),
    autodetect_constructor_args: encoded ? "false" : "true",
    constructor_args: encoded,
  };
  const multipart = buildMultipart(fields, [
    {
      field: "files[0]",
      filename: "standard-input.json",
      type: "application/json",
      content: Buffer.from(stdJson),
    },
  ]);

  const url = explorerV2Url(
    explorer.apiURL,
    `/smart-contracts/${address}/verification/via/standard-input`,
  );
  return request("POST", url, {
    body: multipart.body,
    contentType: multipart.contentType,
  });
}

async function pollVerified(explorer, address, attempts = 18) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const source = await readVerifiedSource(explorer.apiURL, address);
    if (isCloudflareChallenge(source.status, source.text)) {
      throw cloudflareError(explorer, source);
    }
    if (isVerifiedPayload(source.data)) {
      return source.data;
    }
    console.log(
      `Waiting for ${explorer.browserURL} verification (${attempt}/${attempts})...`,
    );
    await sleepMs(Math.min(15_000, 1500 * attempt));
  }
  return null;
}

async function verifyOnArcscan(hre, {
  address,
  constructorArguments = [],
  contract,
  label = contract || address,
  license = "MIT",
}) {
  if (process.env.VERIFY_CONTRACTS === "false") {
    console.log(`Skipping verification for ${label} because VERIFY_CONTRACTS=false`);
    return "skipped";
  }

  const explorer = getExplorerConfig(hre.network.name);
  console.log(
    `Verifying ${label} at ${address} on ${hre.network.name} via ${explorer.browserURL}`,
  );

  try {
    await hre.run("compile");
  } catch (error) {
    console.warn(
      "Compile before verify failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // Arc mainnet is now supported by Etherscan V2 under chain ID 5042.
  // The legacy Arc explorer exposes Blockscout-like paths behind Cloudflare;
  // those endpoints are not compatible with Etherscan verification and must
  // never be used as a fallback for mainnet verification.
  if (hre.network.name === "arc-mainnet") {
    if (!getEtherscanApiKey()) {
      throw new Error(
        "Set ETHERSCAN_API_KEY to an Etherscan API key before verifying on Arc mainnet.",
      );
    }

    try {
      await verifyWithHardhat(hre, {
        address,
        constructorArguments,
        contract,
      });
      console.log(`Verified ${label} via Etherscan at ${explorer.browserURL}`);
      return "verified";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAlreadyVerified(message)) {
        console.log(`Already verified on ${explorer.browserURL}: ${address}`);
        return "verified";
      }
      throw new Error(
        `Etherscan verification failed for ${label}: ${message}`,
      );
    }
  }

  const existing = await readVerifiedSource(explorer.apiURL, address).catch(() => ({
    data: null,
    status: 0,
    text: "",
  }));
  if (isVerifiedPayload(existing.data)) {
    console.log(`Already verified on ${explorer.browserURL}: ${address}`);
    return "verified";
  }
  if (isCloudflareChallenge(existing.status, existing.text)) {
    console.warn(
      `Could not read ${explorer.browserURL} through Cloudflare. Submitting verification anyway.`,
    );
  }

  try {
    await verifyWithHardhat(hre, {
      address,
      constructorArguments,
      contract,
    });
    console.log(`Verified ${label} via Hardhat on ${explorer.browserURL}`);
    return "verified";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAlreadyVerified(message)) {
      console.log(`Already verified: ${address}`);
      return "verified";
    }
    console.warn(`Hardhat verify:verify failed for ${label}: ${message}`);
  }

  if (!contract) {
    throw new Error(
      `Set a fully qualified contract name to verify ${address} on ${explorer.browserURL}.`,
    );
  }

  const buildInfo = await getBuildInfo(hre, contract);
  const encoded = await encodeConstructorArguments(
    hre,
    contract,
    constructorArguments,
  );
  const submitted = await submitBlockscoutStandardInput({
    explorer,
    address,
    buildInfo,
    constructorArgumentsHex: encoded,
    license,
    contractFQN: contract,
  });
  console.log(
    `${explorer.browserURL} standard-input responded ${submitted.status}:`,
    typeof submitted.data === "string"
      ? submitted.text.slice(0, 500)
      : JSON.stringify(submitted.data),
  );

  if (isCloudflareChallenge(submitted.status, submitted.text)) {
    throw cloudflareError(explorer, submitted);
  }

  if (submitted.status >= 400) {
    const detail =
      submitted.data?.message ||
      submitted.data?.error ||
      submitted.text ||
      `HTTP ${submitted.status}`;
    throw new Error(
      `${explorer.browserURL} rejected verification for ${address}: ${detail}`,
    );
  }

  const verified = await pollVerified(explorer, address);
  if (verified) {
    console.log(`Verified ${label} on ${explorer.browserURL}`);
    return "verified";
  }

  if (
    submitted.status === 200 ||
    /already verified|smart-contract.*verified/i.test(
      JSON.stringify(submitted.data || submitted.text || ""),
    )
  ) {
    console.log(
      `Submitted ${label} to ${explorer.browserURL}. Confirm the Code tab at ${explorer.browserURL}/address/${address}?tab=contract`,
    );
    return "verified";
  }

  throw new Error(
    `${explorer.browserURL} accepted a verification payload for ${address} but the contract is still unverified.`,
  );
}

async function verifyContractWithRetry(hre, params, maxRetries = 3, delayMs = 5000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      console.log(`Verification attempt ${attempt}/${maxRetries}...`);
      const status = await verifyOnArcscan(hre, params);
      if (status === "unavailable") {
        return status;
      }
      return status;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (isAlreadyVerified(message)) {
        console.log(`Already verified: ${params.address}`);
        return "verified";
      }
      console.warn(`Verification attempt ${attempt} failed:`, message);
      if (attempt < maxRetries) {
        const waitMs = delayMs * attempt;
        console.log(`Waiting ${waitMs}ms before retry...`);
        await sleepMs(waitMs);
      }
    }
  }

  console.warn(
    `Verification failed after all retries for ${params.address}. Continue on-chain work; re-run the verify script later.`,
    lastError instanceof Error ? lastError.message : String(lastError || ""),
  );
  return "failed";
}

module.exports = {
  getArcscanApiUrl,
  getExplorerConfig,
  getVerifyOptions,
  sourcifyIsReady,
  verifyContractWithRetry,
  verifyOnArcscan,
};
