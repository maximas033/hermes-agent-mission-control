"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

type VNode = { id: string; title: string; folder: string; path: string; preview: string };
type VEdge = { source: string; target: string };

const FOLDERS = ["01-Profile", "02-Projects", "03-Journal", "04-Jarvis-Meta", "05-Knowledge"];
const NEON: Record<string, string> = {
  "01-Profile": "#22d3ee",
  "02-Projects": "#c084fc",
  "03-Journal": "#34d399",
  "04-Jarvis-Meta": "#fbbf24",
  "05-Knowledge": "#fb7185",
};
const colorFor = (f: string) => NEON[f] || "#94a3b8";

// fibonacci sphere -> evenly distributed unit vectors
function fibSphere(n: number): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return pts;
}

export default function VaultPage() {
  const [nodes, setNodes] = useState<VNode[]>([]);
  const [edges, setEdges] = useState<VEdge[]>([]);
  const [selected, setSelected] = useState<VNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pos3 = useRef<{ x: number; y: number; z: number }[]>([]);
  const view = useRef({ rotY: 0, rotX: -0.25, zoom: 1, R: 230 });
  const drag = useRef<{ active: boolean; lx: number; ly: number; moved: boolean }>({ active: false, lx: 0, ly: 0, moved: false });
  const autoRot = useRef(true);
  const raf = useRef<number>(0);
  const W = useRef(1000);
  const H = useRef(640);
  const pick = useRef<{ id: number; d: number }>({ id: -1, d: 1e9 });

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

  useEffect(() => {
    if (nodes.length === 0) return;
    const N = nodes.length;
    pos3.current = fibSphere(N);

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

    const screenOf = (i: number) => {
      const p = pos3.current[i];
      const cy = Math.cos(view.current.rotX), sy = Math.sin(view.current.rotX);
      const cy2 = Math.cos(view.current.rotY), sy2 = Math.sin(view.current.rotY);
      // rotate Y then X
      let x = p.x * cy2 + p.z * sy2;
      let z = -p.x * sy2 + p.z * cy2;
      let y = p.y * cy - z * sy;
      z = p.y * sy + z * cy;
      const R = view.current.R * view.current.zoom;
      const persp = 1.15 / (1.15 + z); // simple perspective
      return {
        x: W.current / 2 + x * R * persp,
        y: H.current / 2 + y * R * persp,
        depth: z, // -1 back .. +1 front
        scale: persp,
      };
    };

    const hitTest = (sx: number, sy: number) => {
      let best = -1, bd = 1e9;
      for (let i = 0; i < N; i++) {
        const s = screenOf(i);
        if (s.depth < -0.15) continue; // back side harder to pick
        const dx = s.x - sx, dy = s.y - sy;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return bd < 900 ? best : -1;
    };

    const onMove = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (drag.current.active) {
        const dx = sx - drag.current.lx, dy = sy - drag.current.ly;
        view.current.rotY += dx * 0.006; view.current.rotX += dy * 0.006;
        drag.current.lx = sx; drag.current.ly = sy; drag.current.moved = true;
        autoRot.current = false;
      } else {
        const h = hitTest(sx, sy);
        setHovered(h >= 0 ? nodes[h].id : null);
        canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      }
    };
    const onDown = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      drag.current = { active: true, lx: ev.clientX - r.left, ly: ev.clientY - r.top, moved: false };
    };
    const onUp = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (drag.current.active && !drag.current.moved) {
        const h = hitTest(sx, sy);
        if (h >= 0) setSelected(nodes[h]);
      }
      drag.current.active = false;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      view.current.zoom = Math.max(0.45, Math.min(2.6, view.current.zoom * Math.exp(-ev.deltaY * 0.0012)));
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let t = 0;
    const draw = () => {
      t += 0.016;
      if (autoRot.current && !drag.current.active) view.current.rotY += 0.0022;
      ctx.clearRect(0, 0, W.current, H.current);
      ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, W.current, H.current);

      const nb = neighborsOf(selected?.id || hovered, edges);
      const sel = selected?.id || hovered;

      // edges (pulsing)
      edges.forEach((e, ei) => {
        const a = nodes.findIndex((n) => n.id === e.source);
        const b = nodes.findIndex((n) => n.id === e.target);
        if (a < 0 || b < 0) return;
        const sa = screenOf(a), sb = screenOf(b);
        const active = sel && (e.source === sel || e.target === sel);
        const pulse = 0.32 + 0.22 * Math.sin(t * 2.2 + ei * 0.7);
        const depthAvg = (sa.depth + sb.depth) / 2;
        let alpha = pulse * (0.45 + 0.55 * ((depthAvg + 1) / 2));
        if (sel && !active) alpha *= 0.18;
        if (active) alpha = Math.min(1, pulse + 0.4);
        const front = (sa.depth + sb.depth) / 2 > 0;
        ctx.strokeStyle = active
          ? `rgba(140,230,255,${alpha})`
          : front ? `rgba(90,150,200,${alpha})` : `rgba(70,100,140,${alpha * 0.6})`;
        ctx.lineWidth = active ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      });

      // nodes
      for (let i = 0; i < N; i++) {
        const s = screenOf(i);
        const c = colorFor(nodes[i].folder);
        const isSel = selected?.id === nodes[i].id;
        const isHov = hovered === nodes[i].id;
        const dim = (sel) && !nb.has(nodes[i].id);
        const depthN = (s.depth + 1) / 2; // 0 back .. 1 front
        const rad = (isSel ? 8 : 5.5) * (0.7 + 0.5 * depthN);
        let alpha = 0.35 + 0.65 * depthN;
        if (dim) alpha *= 0.25;
        // pulse glow on front nodes
        const glow = (isSel ? 24 : isHov ? 18 : 8 + 6 * (0.5 + 0.5 * Math.sin(t * 2 + i))) * (0.6 + 0.4 * depthN);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = c; ctx.shadowBlur = glow;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        if (isSel || isHov) {
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(s.x, s.y, rad + 3, 0, Math.PI * 2); ctx.stroke();
        }
        // labels for front/selected
        if (!dim && (s.depth > 0.15 || isSel || isHov || nb.has(nodes[i].id))) {
          const tt = nodes[i].title.length > 18 ? nodes[i].title.slice(0, 18) + "…" : nodes[i].title;
          ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = isSel || isHov ? "#eaffff" : "rgba(195,220,240,0.85)";
          ctx.fillText(tt, s.x + rad + 5, s.y + 3.5);
        }
        ctx.globalAlpha = 1;
      }

      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf.current); ro.disconnect();
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
            {nodes.length} notes · {edges.length} links · drag to spin · scroll to zoom · click to open
          </p>
        </div>
        <Link href="/" className="text-[12px] text-[var(--hq-text-dim)] hover:text-[var(--hq-text)]">← Dashboard</Link>
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-[var(--hq-text-ghost)]">Loading vault…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          <div className="panel p-0 overflow-hidden" style={{ borderColor: "rgba(80,220,255,0.18)" }}>
            <canvas ref={canvasRef} className="w-full block" style={{ height: 640, cursor: "grab", background: "#05060a" }} />
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
                <button onClick={() => setSelected(null)} className="mt-3 text-[12px] text-[var(--hq-text-dim)] hover:text-[var(--hq-text)]">✕ clear selection</button>
              </>
            ) : (
              <div className="text-[var(--hq-text-ghost)] text-[13px]">
                A rotating knowledge sphere. Drag to spin, scroll to zoom, click a node to read the note.
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
