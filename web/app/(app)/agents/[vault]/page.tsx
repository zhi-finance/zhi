import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentView } from "@/components/agent-view";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Agent" };

async function Resolve({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault)) notFound();
  return <AgentView vault={vault as `0x${string}`} />;
}

export default function AgentPage({ params }: PageProps<"/agents/[vault]">) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Resolve params={params} />
      </Suspense>
    </div>
  );
}
