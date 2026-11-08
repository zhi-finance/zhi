"use client";

import { Wallet } from "lucide-react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { injectiveTestnet } from "@/lib/chain";
import { errMsg, short } from "@/lib/format";
import { Button } from "./ui";

export function ConnectButton() {
  const c = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const sw = useSwitchChain();

  if (c.isConnected && c.chainId !== injectiveTestnet.id) {
    return (
      <Button variant="secondary" onClick={() => sw.mutate({ chainId: injectiveTestnet.id })} loading={sw.isPending}>
        Switch to Injective testnet
      </Button>
    );
  }
  if (c.isConnected) {
    return (
      <Button variant="secondary" onClick={() => disconnect.mutate()} title="Disconnect">
        <span aria-hidden className="size-2 rounded-full bg-accent" />
        <span className="font-mono">{short(c.address)}</span>
      </Button>
    );
  }
  const injectedConnector = connectors[0];
  return (
    <div className="flex flex-col items-end">
      <Button
        onClick={() => injectedConnector && connect.mutate({ connector: injectedConnector, chainId: injectiveTestnet.id })}
        loading={connect.isPending}
        disabled={!injectedConnector}
      >
        <Wallet aria-hidden className="size-4" />
        Connect wallet
      </Button>
      {connect.error && <p className="mt-1 max-w-56 text-right text-xs text-danger">{errMsg(connect.error)}</p>}
    </div>
  );
}
