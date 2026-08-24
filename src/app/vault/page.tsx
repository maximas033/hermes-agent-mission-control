"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type VNode = { id: string; title: string; folder: string; path: string; preview: string };
type VEdge = { source: string; target: string };

const FOLDER_COLORS: Record<string, string> = {
  "01-Profile": "#38bdf8",
  "02-Projects": "#a78bfa",
  "03-Journal": "#34d399",
  "04-Jarvis-Meta": "#fbbf24",
  "05-Knowledge": "#f87171",
};
const colorFor = (f: string) => FOLDER_COLORS[f] || "#94a3b8";

export default function VaultPage() {
  const [nodes, setNodes] = useState<VNode[]>([]);
  const [edges, setEdges] = useState<VEdge[]>([]);
  const [selected, setSelected] = useState<VNode | null>(null);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => { setNodes(d.nodes || []); setEdges(d.edges || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Simple force-directed layout (tick-based) kept in a ref so we don't re-render every frame heavily.
  const sim = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const W = 900, H = 620;

  const pos = useMemo(() => {
    if (nodes.length === 0) return [];
    // run a lightweight simulation synchronously for initial positions
    const N = nodes.length;
    const p = sim.current.length === N ? sim.current : nodes.map((_, i) => ({
      x: W / 2 + Math.cos((i / N) * Math.PI * 2) * 220,
      y: H / 2 + Math.sin((i / N) * Math.PI * 2) * 220,
      vx: 0, vy: 0,
    }));
    sim.current = p;
    const adj = new Map<number, number[]>();
    edges.forEach((e) => {
      const a = nodes.findIndex((n) => n.id === e.source);
      const b = nodes.findIndex((n) => n.id === e.target);
      if (a >= 0 && b >= 0) {
        (adj.get(a) || adj.set(a, []).get(a)!).push(b);
        (adj.get(b) || adj.set(b, []).get(b)!).push(a);
      }
    });
    for (let step = 0; step < 220; step++) {
      for (let i = 0; i < N; i++) {
        let fx = 0, fy = 0;
        // repulsion
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          let dx = p[i].x - p[j].x, dy = p[i].y - p[j].y;
          let d2 = dx * dx + dy * dy + 0.01;
          const f = 9000 / d2;
          fx += (dx / Math.sqrt(d2)) * f; fy += (dy / Math.sqrt(d2)) * f;
        }
        // attraction along edges
        for (const j of adj.get(i) || []) {
          let dx = p[j].x - p[i].x, dy = p[j].y - p[i].y;
          const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const f = (d - 90) * 0.02;
          fx += (dx / d) * f; fy += (dy / d) * f;
        }
        // center gravity
        fx += (W / 2 - p[i].x) * 0.005; fy += (H / 2 - p[i].y) * 0.005;
        p[i].vx = (p[i].vx + fx) * 0.85; p[i].vy = (p[i].vy + fy) * 0.85;
      }
      for (let i = 0; i < N; i++) {
        p[i].x = Math.max(40, Math.min(W - 40, p[i].x + p[i].vx * 0.15));
        p[i].y = Math.max(40, Math.min(H - 40, p[i].y + p[i].vy * 0.15));
      }
    }
    return p;
  }, [nodes, edges]);

  const selTok = selected?.id;
  const neighbors = useMemo(() => {
    if (!selTok) return new Set<string>();
    const s = new Set<string>([selTok]);
    edges.forEach((e) => {
      if (e.source === selTok) s.add(e.target);
      if (e.target === selTok) s.add(e.source);
    });
    return s;
  }, [selTok, edges]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Obsidian Vault</h1>
          <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-1">
            {nodes.length} notes · {edges.length} links · synced from ~/JarvisVault
          </p>
        </div>
        <Link href="/" className="text-[12px] text-[var(--hq-text-dim)] hover:text-[var(--hq-text)]">← Dashboard</Link>
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-[var(--hq-text-ghost)]">Loading vault…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          <div className="panel p-2 overflow-hidden">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-[620px]">
              {edges.map((e, i) => {
                const a = nodes.findIndex((n) => n.id === e.source);
                const b = nodes.findIndex((n) => n.id === e.target);
                if (a < 0 || b < 0) return null;
                const active = selTok && (e.source === selTok || e.target === selTok);
                return (
                  <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y}
                    stroke={active ? "#e2e8f0" : "#334155"} strokeWidth={active ? 1.6 : 0.8} opacity={selTok && !active ? 0.25 : 0.7} />
                );
              })}
              {nodes.map((n, i) => {
                const c = colorFor(n.folder);
                const dim = selTok && !neighbors.has(n.id);
                return (
                  <g key={n.id} transform={`translate(${pos[i].x},${pos[i].y})`} className="cursor-pointer"
                    opacity={dim ? 0.3 : 1} onClick={() => setSelected(n)}>
                    <circle r={selected?.id === n.id ? 9 : 6} fill={c}
                      stroke={selected?.id === n.id ? "#fff" : "transparent"} strokeWidth={2} />
                    {(selected === null || neighbors.has(n.id)) && (
                      <text x={10} y={4} className="fill-[var(--hq-text-dim)] text-[10px] pointer-events-none">
                        {n.title.length > 22 ? n.title.slice(0, 22) + "…" : n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="panel p-5 flex flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorFor(selected.folder) }} />
                  <span className="eyebrow">{selected.folder}</span>
                </div>
                <h2 className="text-[18px] font-semibold mb-3">{selected.title}</h2>
                <p className="text-[13px] text-[var(--hq-text-dim)] leading-relaxed whitespace-pre-wrap overflow-auto" style={{ maxHeight: 460 }}>
                  {selected.preview || "(no body)"}
                </p>
                <p className="num text-[10.5px] text-[var(--hq-text-ghost)] mt-3">{selected.path}</p>
              </>
            ) : (
              <div className="text-[var(--hq-text-ghost)] text-[13px]">
                Click a node to read the note. Edges are <code>[[wikilinks]]</code> between notes.
                <div className="mt-4 space-y-1">
                  {Object.entries(FOLDER_COLORS).map(([f, c]) => (
                    <div key={f} className="flex items-center gap-2 text-[12px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} /> {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
