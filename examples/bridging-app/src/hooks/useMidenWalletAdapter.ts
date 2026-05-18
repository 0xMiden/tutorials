import { useCallback, useEffect, useMemo, useState } from "react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { useAssetMetadata, toBech32AccountId } from "@miden-sdk/react";
import { AccountId, Address } from "@miden-sdk/miden-sdk";
import type { Asset } from "@miden-sdk/miden-wallet-adapter-base";

export interface NormalizedMidenAccountId {
  hex: string;
}

export interface MidenWalletAsset {
  assetId: string; // faucet id
  assetIdDisplay: string;
  amount: bigint;
  symbol?: string;
  decimals?: number;
}

export interface UseMidenWalletAdapterOptions {
  enabled?: boolean;
}

export interface UseMidenWalletAdapterResult {
  connected: boolean;
  connect: () => Promise<void>;
  address: string | null;
  accountId: NormalizedMidenAccountId | null;
  assets: MidenWalletAsset[];
  isLoadingAssets: boolean;
  assetsError: string | null;
  refreshAssets: () => Promise<void>;
}

const normalizeAccountId = (rawAddress: string | null): NormalizedMidenAccountId | null => {
  if (!rawAddress) return null;
  const input = rawAddress.replace(/\s+/g, "").trim();
  if (!input) return null;

  let id: AccountId | null = null;
  try {
    if (input.startsWith("0x") || input.startsWith("0X")) {
      id = AccountId.fromHex(input);
    } else if (/^[0-9a-fA-F]+$/.test(input) && input.length % 2 === 0) {
      id = AccountId.fromHex(`0x${input}`);
    }
  } catch {
    id = null;
  }

  if (!id) {
    if (input.includes("_")) {
      try {
        id = Address.fromBech32(input).accountId();
      } catch {
        const accountBech32 = input.slice(0, input.indexOf("_"));
        try {
          id = AccountId.fromBech32(accountBech32);
        } catch {
          id = null;
        }
      }
    } else {
      try {
        id = AccountId.fromBech32(input);
      } catch {
        try {
          id = Address.fromBech32(input).accountId();
        } catch {
          id = null;
        }
      }
    }
  }

  if (!id) return null;
  try {
    return { hex: id.toString() };
  } catch {
    return null;
  }
};

export function useMidenWalletAdapter(
  options: UseMidenWalletAdapterOptions = {},
): UseMidenWalletAdapterResult {
  const { enabled = true } = options;
  const {
    connected,
    connect: adapterConnect,
    address,
    requestAssets,
  } = useMidenFiWallet();

  const accountId = useMemo(() => normalizeAccountId(address), [address]);
  const [rawAssets, setRawAssets] = useState<Asset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const refreshAssets = useCallback(async () => {
    if (!enabled || !connected) return;
    if (!requestAssets) {
      setRawAssets([]);
      setAssetsError("Connected wallet does not support requestAssets()");
      return;
    }
    setIsLoadingAssets(true);
    setAssetsError(null);
    try {
      const raw = await requestAssets();
      setRawAssets(raw ?? []);
    } catch (err) {
      setRawAssets([]);
      setAssetsError(err instanceof Error ? err.message : "Failed to load assets");
    } finally {
      setIsLoadingAssets(false);
    }
  }, [enabled, connected, requestAssets]);

  const faucetIds = useMemo(() => rawAssets.map((a) => a.faucetId), [rawAssets]);
  const { assetMetadata } = useAssetMetadata(faucetIds);

  const assets = useMemo<MidenWalletAsset[]>(
    () =>
      rawAssets.map((a) => {
        const meta = assetMetadata.get(a.faucetId);
        let display = a.faucetId;
        try {
          display = toBech32AccountId(a.faucetId);
        } catch {
          // keep raw faucetId
        }
        return {
          assetId: a.faucetId,
          assetIdDisplay: display,
          amount: BigInt(a.amount),
          symbol: meta?.symbol,
          decimals: meta?.decimals,
        };
      }),
    [rawAssets, assetMetadata],
  );

  const connect = useCallback(async () => {
    if (!connected) await adapterConnect();
    await refreshAssets();
  }, [connected, adapterConnect, refreshAssets]);

  useEffect(() => {
    if (!enabled || !connected) {
      setRawAssets([]);
      setAssetsError(null);
      setIsLoadingAssets(false);
      return;
    }
    void refreshAssets();
  }, [enabled, connected, refreshAssets]);

  return {
    connected,
    connect,
    address,
    accountId,
    assets,
    isLoadingAssets,
    assetsError,
    refreshAssets,
  };
}

