"use client";

import { useQuery } from "@tanstack/react-query";
import { publicClient } from "./events";
import { ADDR } from "./chain";
import { zhiFactoryAbi } from "./generated";

const oracleAbi = [
  {
    type: "function",
    name: "oraclePricePairState",
    stateMutability: "view",
    inputs: [{ type: "uint8" }, { type: "string" }, { type: "string" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "pairPrice", type: "uint256" },
          { name: "basePrice", type: "uint256" },
          { name: "quotePrice", type: "uint256" },
          { name: "a", type: "uint256" },
          { name: "b", type: "uint256" },
          { name: "baseTimestamp", type: "uint64" },
          { name: "quoteTimestamp", type: "uint64" },
        ],
      },
    ],
  },
] as const;

/** BTC/USDC reference price straight from Injective's oracle precompile (0x67): the same number the vault checks. */
export function useBtcOracle() {
  return useQuery({
    queryKey: ["btc-oracle"],
    refetchInterval: 6_000,
    queryFn: async () => {
      const [s, block] = await Promise.all([
        publicClient.readContract({
          address: "0x0000000000000000000000000000000000000067",
          abi: oracleAbi,
          functionName: "oraclePricePairState",
          args: [13, "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57709d31e9971a5b439", "0x0003dc85e8b01946bf9dfd8b0db860129181eb6105a8c8981d9f28e00b6f60d9"],
        }),
        publicClient.getBlockNumber(),
      ]);
      return { price: Number(s.pairPrice) / 1e18, ts: Number(s.baseTimestamp), block: Number(block) };
    },
  });
}

export function useAgentCount() {
  return useQuery({
    queryKey: ["agent-count"],
    enabled: !!ADDR.factory,
    queryFn: async () => Number(await publicClient.readContract({ address: ADDR.factory!, abi: zhiFactoryAbi, functionName: "agentCount" })),
  });
}
