"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { VaultNodeDatum, VaultEdgeDatum } from "@/components/vault-graph";

// WebGL + d3 physics — client-only
const VaultGraph = dynamic(() => import("@/components/vault-graph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[72vh] min-h-[520px] w-full items-center justify-center rounded-2xl border border-sky-400/10 bg-[#05060a]">
      <div className="flex items-center gap-3 text-[13px] text-slate-400">
        <span className="h-3 w-3 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9]" />
        spinning up the graph…
      </div>
    </div>
  ),
});

export default function VaultPage() {
  const [nodes, setNodes] = useState<VaultNodeDatum[]>([]);
  const [edges, setEdges] = useState<VaultEdgeDatum[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setNodes(d.nodes ?? []);
        setEdges(d.edges ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e?.message ?? e));
        setLoading(false);
      });
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-[28px] font-semibold tracking-[-0.02em]"
            style={{ color: "#aef3ff", textShadow: "0 0 18px rgba(80,220,255,0.45)" }}
          >
            Vault Memory Graph
          </h1>
          <p className="num mt-1 text-[12.5px] text-[var(--hq-text-ghost)]">
            {nodes.length} notes · {edges.length} thought-links · force-directed in 3D space
          </p>
        </div>
        <Link href="/" className="text-[12px] text-[var(--hq-text-dim)] hover:text-[var(--hq-text)]">
          ← Dashboard
        </Link>
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-[var(--hq-text-ghost)]">Loading vault…</div>
      ) : err ? (
        <div className="panel p-10 text-center text-rose-300/80">
          Couldn&apos;t load vault data: {err}
        </div>
      ) : nodes.length === 0 ? (
        <div className="panel p-10 text-center text-[var(--hq-text-ghost)]">
          No notes synced yet. The hermes-bridge pushes vault markdown to the bus every 30s.
        </div>
      ) : (
        <VaultGraph nodes={nodes} edges={edges} />
      )}
    </div>
  );
}
