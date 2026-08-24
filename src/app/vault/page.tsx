"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

type VNode = { id: string; title: string; folder: string; path: string; preview: string };
type VEdge = { source: string; target: string };

const FOLDERS = ["01-Profile", "02-Projects", "03-Journal", "04-Jarvis-Meta", "05-Knowledge"];
const NEON: Record<string, string> = {
  "01-Profile": "#22d3ee",     // cyan
  "02-Projects": "#c084fc",    // purple
  "03-Journal": "#34d399",     // green
  "04-Jarvis-Meta": "#fbbf24", // amber
  "05-Knowledge": "#fb7185",  // pink
};
const colorFor = (f: string) => NEON[f] || "#94a3b8";

export default function VaultPage() {
  const [nodes, setNodes] = useState<VNode[]>([]);
  const [edges, setEdges] = useState<VEdge[]>([]);
  const [selected, setSelected] = useState<VNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const view = useRef({ scale: 0.25, ox: 0, oy: 0, tx: 1, ty: 1, tox: 0, toy: 0 });
  const targetScale = useRef(1);
  const drag = useRef<{ node: number | null; panning: boolean; lx: number; ly: number }>(
    { node: null, panning: false, lx: 0, ly: 0 }
  );
  const raf = useRef<number>(0);
  const W = useRef(1000);
  const H = useRef(640);

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => (r.ok ? r.json() : { nodes: [], edges: [] }))
      .then((d) => { setNodes(d.nodes || []); setEdges(d.edges || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const neighborsOf = useCallback((id: string | null, es: VEdge[]) => {
    const s = new Set<string>();
    if (id) { s.add(id); es.forEach((e) => { if (e.source === id) s.add(e.target); if (e.target === id) s.add(e.source); }); }
    return s;
  }, []);

  // Main render + simulation loop
  useEffect(() => {
    if (nodes.length === 0) return;
    const N = nodes.length;
    const p = sim.current.length === N ? sim.current : nodes.map((_, i) => ({
      x: Math.cos((i / N) * Math.PI * 2) * 260,
      y: Math.sin((i / N) * Math.PI * 2) * 260,
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

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W.current = r.width; H.current = r.height;
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // initial "Simpson zoom" — start zoomed in, ease out to fit
    view.current.scale = 0.2; targetScale.current = 1;
    view.current.tx = 0.2; view.current.ty = 1; view.current.tox = 1; view.current.toy = 0;

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - W.current / 2 - view.current.ox) / view.current.scale,
      y: (sy - H.current / 2 - view.current.oy) / view.current.scale,
    });

    const hitTest = (sx: number, sy: number) => {
      const w = screenToWorld(sx, sy);
      for (let i = N - 1; i >= 0; i--) {
        const dx = p[i].x - w.x, dy = p[i].y - w.y;
        if (dx * dx + dy * dy < 400) return i;
      }
      return null;
    };

    const onMove = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (drag.current.node !== null) {
        const w = screenToWorld(sx, sy);
        p[drag.current.node].x = w.x; p[drag.current.node].y = w.y;
        p[drag.current.node].vx = 0; p[drag.current.node].vy = 0;
      } else if (drag.current.panning) {
        view.current.ox += sx - drag.current.lx; view.current.oy += sy - drag.current.ly;
        view.current.tox = view.current.scale; // pause zoom anim while panning
        drag.current.lx = sx; drag.current.ly = sy;
      } else {
        const h = hitTest(sx, sy);
        setHovered(h !== null ? nodes[h].id : null);
        canvas.style.cursor = h !== null ? "pointer" : "grab";
      }
    };
    const onDown = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const h = hitTest(sx, sy);
      if (h !== null) { drag.current.node = h; drag.current.lx = sx; drag.current.ly = sy; }
      else { drag.current.panning = true; drag.current.lx = sx; drag.current.ly = sy; }
    };
    const onUp = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (drag.current.node !== null) {
        const h = hitTest(sx, sy);
        if (h !== null) setSelected(nodes[h]);
      }
      drag.current.node = null; drag.current.panning = false;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const before = screenToWorld(sx, sy);
      const factor = Math.exp(-ev.deltaY * 0.0015);
      targetScale.current = Math.max(0.2, Math.min(3.5, targetScale.current * factor));
      view.current.scale = targetScale.current;
      // keep cursor point stable
      view.current.ox = sx - W.current / 2 - before.x * targetScale.current;
      view.current.oy = sy - H.current / 2 - before.y * targetScale.current;
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const draw = () => {
      // ease zoom + pan
      view.current.scale += (targetScale.current - view.current.scale) * 0.12;
      view.current.ox += (view.current.tox - view.current.ox) * 0.12;
      view.current.oy += (view.current.toy - view.current.oy) * 0.12;

      ctx.clearRect(0, 0, W.current, H.current);
      // bg grid glow
      ctx.fillStyle = "#06070a"; ctx.fillRect(0, 0, W.current, H.current);

      const s = view.current.scale;
      const toScreen = (x: number, y: number) => ({
        x: W.current / 2 + view.current.ox + x * s,
        y: H.current / 2 + view.current.oy + y * s,
      });

      const nb = neighborsOf(selected?.id || hovered, edges);

      // edges
      ctx.lineWidth = 1;
      edges.forEach((e) => {
        const a = nodes.findIndex((n) => n.id === e.source);
        const b = nodes.findIndex((n) => n.id === e.target);
        if (a < 0 || b < 0) return;
        const pa = toScreen(p[a].x, p[a].y), pb = toScreen(p[b].x, p[b].y);
        const active = (selected || hovered) && (e.source === (selected?.id || hovered) || e.target === (selected?.id || hovered));
        ctx.strokeStyle = active ? "rgba(120,220,255,0.55)" : "rgba(80,120,160,0.18)";
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      });

      // nodes
      for (let i = 0; i < N; i++) {
        const ps = toScreen(p[i].x, p[i].y);
        const c = colorFor(nodes[i].folder);
        const isSel = selected?.id === nodes[i].id;
        const isHov = hovered === nodes[i].id;
        const dim = (selected || hovered) && !nb.has(nodes[i].id);
        const rad = isSel ? 9 : 6;
        ctx.globalAlpha = dim ? 0.28 : 1;
        // glow
        ctx.shadowColor = c; ctx.shadowBlur = isSel ? 22 : isHov ? 16 : 9;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(ps.x, ps.y, rad, 0, Math.PI * 2); ctx.fill();
        // halo ring
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isSel ? "#ffffff" : c; ctx.lineWidth = isSel ? 2 : 1;
        ctx.beginPath(); ctx.arc(ps.x, ps.y, rad + 3, 0, Math.PI * 2); ctx.stroke();
        // label
        if (!dim && (s > 0.5 || isSel || isHov || nb.has(nodes[i].id))) {
          const t = nodes[i].title.length > 20 ? nodes[i].title.slice(0, 20) + "…" : nodes[i].title;
          ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = isSel || isHov ? "#e6f6ff" : "rgba(190,210,230,0.8)";
          ctx.fillText(t, ps.x + rad + 5, ps.y + 3.5);
        }
        ctx.globalAlpha = 1;
      }

      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);

    // physics tick (separate interval for stability)
    const phys = setInterval(() => {
      for (let i = 0; i < N; i++) {
        if (drag.current.node === i) continue;
        let fx = 0, fy = 0;
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          let dx = p[i].x - p[j].x, dy = p[i].y - p[j].y;
          let d2 = dx * dx + dy * dy + 0.01;
          const f = 7000 / d2; fx += (dx / Math.sqrt(d2)) * f; fy += (dy / Math.sqrt(d2)) * f;
        }
        for (const j of adj.get(i) || []) {
          let dx = p[j].x - p[i].x, dy = p[j].y - p[i].y;
          const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const f = (d - 95) * 0.02; fx += (dx / d) * f; fy += (dy / d) * f;
        }
        fx += -p[i].x * 0.004; fy += -p[i].y * 0.004;
        p[i].vx = (p[i].vx + fx) * 0.86; p[i].vy = (p[i].vy + fy) * 0.86;
      }
      for (let i = 0; i < N; i++) {
        if (drag.current.node === i) continue;
        p[i].x = Math.max(-900, Math.min(900, p[i].x + p[i].vx * 0.12));
        p[i].y = Math.max(-700, Math.min(700, p[i].y + p[i].vy * 0.12));
      }
    }, 32);

    return () => {
      cancelAnimationFrame(raf.current); clearInterval(phys);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [nodes, edges, selected, hovered, neighborsOf]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]" style={{ color: "#aef3ff", textShadow: "0 0 18px rgba(80,220,255,0.45)" }}>
            Obsidian Vault
          </h1>
          <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-1">
            {nodes.length} notes · {edges.length} links · drag nodes · scroll to zoom · click to open
          </p>
        </div>
        <Link href="/" className="text-[12px] text-[var(--hq-text-dim)] hover:text-[var(--hq-text)]">← Dashboard</Link>
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-[var(--hq-text-ghost)]">Loading vault…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          <div className="panel p-0 overflow-hidden" style={{ borderColor: "rgba(80,220,255,0.18)" }}>
            <canvas ref={canvasRef} className="w-full block" style={{ height: 640, cursor: "grab", background: "#06070a" }} />
          </div>

          <div className="panel p-5 flex flex-col" style={{ borderColor: "rgba(80,220,255,0.18)" }}>
            {selected ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorFor(selected.folder), boxShadow: `0 0 10px ${colorFor(selected.folder)}` }} />
                  <span className="eyebrow" style={{ color: colorFor(selected.folder) }}>{selected.folder}</span>
                </div>
                <h2 className="text-[18px] font-semibold mb-3" style={{ color: "#dff6ff" }}>{selected.title}</h2>
                <p className="text-[13px] text-[var(--hq-text-dim)] leading-relaxed whitespace-pre-wrap overflow-auto" style={{ maxHeight: 460 }}>
                  {selected.preview || "(no body)"}
                </p>
                <p className="num text-[10.5px] text-[var(--hq-text-ghost)] mt-3">{selected.path}</p>
              </>
            ) : (
              <div className="text-[var(--hq-text-ghost)] text-[13px]">
                Click a node to read the note. Drag to rearrange, scroll to zoom.
                <div className="mt-4 space-y-1.5">
                  {FOLDERS.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-[12px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorFor(f), boxShadow: `0 0 8px ${colorFor(f)}` }} /> {f}
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
