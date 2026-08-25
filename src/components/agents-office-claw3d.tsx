"use client";

import { Suspense, useMemo, useRef, Component, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────────
//  SCI-FI AGENT OFFICE  (Claw3D-inspired, rebuilt as a neon ops floor)
//  Free · Vercel-safe · no API keys. Fed by /api/agents + /api/agent-chat.
//  A* nav (proven) · speech bubbles · click-to-chat · holographic styling.
// ─────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline" | "online" | "active";
  color: string;
  tasksCompleted?: number;
  currentTask?: string;
  lastActive?: string;
  recentActivity?: { timestamp: string; action: string; result?: string }[];
}

const FLOOR_W = 38, FLOOR_H = 30, WALL_H = 2.4;

function makeLabelTexture(text: string, fg = "#9fe9ff", bg = "rgba(6,12,20,0.0)") {
  const canvas = document.createElement("canvas");
  const s = 2, w = 512, h = 128;
  canvas.width = w * s; canvas.height = h * s;
  const ctx = canvas.getContext("2d")!; ctx.scale(s, s);
  if (bg !== "rgba(6,12,20,0.0)") { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.font = "700 62px ui-monospace, 'SF Mono', Menlo, monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = fg; ctx.shadowBlur = 18;
  ctx.fillStyle = fg; ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4; return tex;
}
function makeBubbleTexture(text: string, color = "#22d3ee") {
  const canvas = document.createElement("canvas");
  const s = 2, fs = 42;
  canvas.width = 512 * s; canvas.height = 200 * s;
  const ctx = canvas.getContext("2d")!; ctx.scale(s, s);
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const maxW = 440, words = text.split(" "); const lines: string[] = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  const lh = fs + 10, boxH = 46 + lines.length * lh, boxW = Math.min(maxW + 52, 484), bx = (512 - boxW) / 2, by = 8;
  ctx.fillStyle = "rgba(8,16,28,0.92)"; const r = 22;
  ctx.beginPath(); ctx.moveTo(bx + r, by); ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
  ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r); ctx.arcTo(bx, by + boxH, bx, by, r); ctx.arcTo(bx, by, bx + boxW, by, r); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(512 / 2 - 14, by + boxH); ctx.lineTo(512 / 2, by + boxH + 26); ctx.lineTo(512 / 2 + 14, by + boxH); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = color; ctx.fillRect(bx, by, boxW, 7);
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fillStyle = "#dff7ff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, 512 / 2, by + 22 + i * lh + lh / 2));
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4; return tex;
}
function Label({ text, y = 2.0, color = "#9fe9ff", position }: { text: string; y?: number; color?: string; position?: [number, number, number] }) {
  const tex = useMemo(() => makeLabelTexture(text, color), [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return <sprite position={position ?? [0, y, 0]} scale={[4.2, 1.05, 1]}><spriteMaterial map={tex} transparent depthWrite={false} /></sprite>;
}

// ── A* nav grid (proven) ───────────────────────────────────
class NavGrid {
  blocked: Uint8Array; cols: number; rows: number; cell = 1; ox = -FLOOR_W / 2; oz = -FLOOR_H / 2;
  constructor(walls: { x: number; z: number; w: number; d: number }[]) {
    this.cols = FLOOR_W; this.rows = FLOOR_H; this.blocked = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.cols; i++) { this.block(i, 0); this.block(i, this.rows - 1); }
    for (let j = 0; j < this.rows; j++) { this.block(0, j); this.block(this.cols - 1, j); }
    for (const w of walls) this.rect(w.x, w.z, w.x + w.w, w.z + w.d);
  }
  block(cx: number, cz: number) { if (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows) this.blocked[cz * this.cols + cx] = 1; }
  rect(x1: number, z1: number, x2: number, z2: number) {
    const c1 = this.toCell(x1, z1), c2 = this.toCell(x2, z2);
    for (let cz = Math.min(c1.cz, c2.cz); cz <= Math.max(c1.cz, c2.cz); cz++)
      for (let cx = Math.min(c1.cx, c2.cx); cx <= Math.max(c1.cx, c2.cx); cx++) this.block(cx, cz);
  }
  carve(x1: number, z1: number, x2: number, z2: number) {
    const c1 = this.toCell(x1, z1), c2 = this.toCell(x2, z2);
    for (let cz = Math.min(c1.cz, c2.cz); cz <= Math.max(c1.cz, c2.cz); cz++)
      for (let cx = Math.min(c1.cx, c2.cx); cx <= Math.max(c1.cx, c2.cx); cx++)
        if (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows) this.blocked[cz * this.cols + cx] = 0;
  }
  toCell(x: number, z: number) { return { cx: Math.round((x - this.ox) / this.cell), cz: Math.round((z - this.oz) / this.cell) }; }
  toWorld(cx: number, cz: number) { return { x: this.ox + cx * this.cell, z: this.oz + cz * this.cell }; }
  isBlocked(cx: number, cz: number) { return cx < 0 || cx >= this.cols || cz < 0 || cz >= this.rows || this.blocked[cz * this.cols + cx] === 1; }
  nearest(cx: number, cz: number) { if (!this.isBlocked(cx, cz)) return { cx, cz }; for (let r = 1; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const nx = cx + dx, nz = cz + dz; if (!this.isBlocked(nx, nz)) return { cx: nx, cz: nz }; } return { cx, cz }; }
  findPath(sx: number, sz: number, gx: number, gz: number): { x: number; z: number }[] {
    const s = this.nearest(...Object.values(this.toCell(sx, sz)) as [number, number]);
    const g = this.nearest(...Object.values(this.toCell(gx, gz)) as [number, number]);
    const start = s.cz * this.cols + s.cx, goal = g.cz * this.cols + g.cx;
    if (start === goal) return [];
    const open = [start], came = new Map<number, number>(), gS = new Map([[start, 0]]), fS = new Map([[start, this.h(start, goal)]]), closed = new Set<number>();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]; let guard = 0;
    while (open.length && guard++ < 8000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if ((fS.get(open[i]) ?? 1e9) < (fS.get(open[bi]) ?? 1e9)) bi = i;
      const cur = open.splice(bi, 1)[0]; if (cur === goal) return this.recon(came, cur);
      closed.add(cur); const ccx = cur % this.cols, ccz = Math.floor(cur / this.cols);
      for (const [dx, dz] of dirs) { const nx = ccx + dx, nz = ccz + dz; if (this.isBlocked(nx, nz)) continue; const n = nz * this.cols + nx; if (closed.has(n)) continue; const step = dx && dz ? 1.414 : 1; const t = (gS.get(cur) ?? 1e9) + step; if (t < (gS.get(n) ?? 1e9)) { came.set(n, cur); gS.set(n, t); fS.set(n, t + this.h(n, goal)); if (!open.includes(n)) open.push(n); } }
    }
    return [];
  }
  h(a: number, b: number) { const ax = a % this.cols, az = Math.floor(a / this.cols), bx = b % this.cols, bz = Math.floor(b / this.cols); return Math.abs(ax - bx) + Math.abs(az - bz); }
  recon(came: Map<number, number>, cur: number) { const p: { x: number; z: number }[] = []; let c: number | undefined = cur; while (c !== undefined && came.has(c)) { const cx = c % this.cols, cz = Math.floor(c / this.cols); p.unshift(this.toWorld(cx, cz)); c = came.get(c); } return p; }
}

// ── Sci-fi character ───────────────────────────────────────
function Char({ color, walking, talking }: { color: string; walking: boolean; talking: boolean }) {
  const t = useRef(0);
  const la = useRef<THREE.Mesh>(null), ra = useRef<THREE.Mesh>(null);
  const ll = useRef<THREE.Mesh>(null), rl = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    t.current += dt;
    const sw = walking ? Math.sin(t.current * 9) * 0.55 : 0;
    if (la.current) la.current.rotation.x = sw;
    if (ra.current) ra.current.rotation.x = -sw;
    if (ll.current) ll.current.rotation.x = -sw;
    if (rl.current) rl.current.rotation.x = sw;
    if (body.current) { body.current.position.y = walking ? Math.abs(Math.sin(t.current * 9)) * 0.05 : 0; body.current.rotation.y = talking ? Math.sin(t.current * 6) * 0.05 : 0; }
  });
  const dark = "#1a2230", trim = color;
  return (
    <group>
      <mesh ref={ll} position={[-0.2, 0.42, 0]}><boxGeometry args={[0.32, 0.84, 0.32]} /><meshBasicMaterial color={dark} /></mesh>
      <mesh ref={rl} position={[0.2, 0.42, 0]}><boxGeometry args={[0.32, 0.84, 0.32]} /><meshBasicMaterial color={dark} /></mesh>
      <group ref={body} position={[0, 0.84, 0]}>
        <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.74, 0.84, 0.4]} /><meshBasicMaterial color={dark} /></mesh>
        {/* neon chest strip */}
        <mesh position={[0, 0.5, 0.21]}><boxGeometry args={[0.5, 0.08, 0.02]} /><meshBasicMaterial color={trim} /></mesh>
        <mesh ref={la} position={[-0.54, 0.42, 0]}><boxGeometry args={[0.24, 0.76, 0.3]} /><meshBasicMaterial color={dark} /></mesh>
        <mesh ref={ra} position={[0.54, 0.42, 0]}><boxGeometry args={[0.24, 0.76, 0.3]} /><meshBasicMaterial color={dark} /></mesh>
        <group position={[0, 1.15, 0]}>
          <mesh><boxGeometry args={[0.6, 0.6, 0.6]} /><meshBasicMaterial color="#222b3a" /></mesh>
          {/* glowing visor */}
          <mesh position={[0, 0.06, 0.31]}><boxGeometry args={[0.46, 0.14, 0.04]} /><meshBasicMaterial color={trim} /></mesh>
          <mesh position={[0, 0.34, 0]}><boxGeometry args={[0.66, 0.18, 0.66]} /><meshBasicMaterial color={dark} /></mesh>
        </group>
      </group>
    </group>
  );
}

// ── Holographic workstation (desk) ─────────────────────────
function Desk({ x, z, color, label, facing = 0 }: { x: number; z: number; color: string; label: string; facing?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      {/* pedestal */}
      <mesh position={[0, 0.35, -0.2]}><boxGeometry args={[1.5, 0.7, 0.5]} /><meshBasicMaterial color="#141b27" /></mesh>
      {/* holographic monitor */}
      <group position={[0, 1.05, -0.55]}>
        <mesh><boxGeometry args={[1.0, 0.62, 0.05]} /><meshBasicMaterial color="#040a12" /></mesh>
        <mesh position={[0, 0, 0.03]}><boxGeometry args={[0.9, 0.52, 0.02]} /><meshBasicMaterial color={color} /></mesh>
      </group>
      {/* glowing base ring */}
      <mesh position={[0, 0.04, 0.1]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.9, 1.05, 32]} /><meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} /></mesh>
      <Label text={label} y={2.1} color={color} />
    </group>
  );
}

// ── Sci-fi office shell ────────────────────────────────────
function HWall({ pos, size }: { pos: [number, number, number]; size: [number, number, number] }) {
  return (
    <group position={pos}>
      {/* translucent holographic panel */}
      <mesh><boxGeometry args={size} /><meshBasicMaterial color="#0b3a5e" transparent opacity={0.12} /></mesh>
      {/* glowing top trim */}
      <mesh position={[0, size[1] / 2, 0]}><boxGeometry args={[size[0], 0.08, size[2]]} /><meshBasicMaterial color="#22d3ee" /></mesh>
      {/* glowing bottom trim */}
      <mesh position={[0, -size[1] / 2, 0]}><boxGeometry args={[size[0], 0.05, size[2]]} /><meshBasicMaterial color="#0e7490" /></mesh>
    </group>
  );
}
function Portal({ x, z, axis }: { x: number; z: number; axis: "x" | "z" }) {
  const post = axis === "x" ? ([0.18, WALL_H, 0.18] as [number, number, number]) : ([0.18, WALL_H, 0.18] as [number, number, number]);
  const lintel = axis === "x" ? ([0.3, 0.18, 3.6] as [number, number, number]) : ([3.6, 0.18, 0.3] as [number, number, number]);
  return (
    <group position={[x, 0, z]}>
      {axis === "x" ? (
        <><mesh position={[-1.9, WALL_H / 2, 0]}><boxGeometry args={post} /><meshBasicMaterial color="#22d3ee" /></mesh><mesh position={[1.9, WALL_H / 2, 0]}><boxGeometry args={post} /><meshBasicMaterial color="#22d3ee" /></mesh></>
      ) : (
        <><mesh position={[0, WALL_H / 2, -1.9]}><boxGeometry args={post} /><meshBasicMaterial color="#22d3ee" /></mesh><mesh position={[0, WALL_H / 2, 1.9]}><boxGeometry args={post} /><meshBasicMaterial color="#22d3ee" /></mesh></>
      )}
      <mesh position={[0, WALL_H - 0.1, 0]}><boxGeometry args={lintel} /><meshBasicMaterial color="#67e8f9" /></mesh>
      {/* faint energy curtain */}
      <mesh position={[0, WALL_H / 2, 0]} rotation={axis === "x" ? [0, 0, 0] : [0, Math.PI / 2, 0]}>
        <planeGeometry args={axis === "x" ? [3.6, WALL_H] : [3.6, WALL_H]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.06} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function OfficeShell() {
  const walls: { pos: [number, number, number]; size: [number, number, number] }[] = [
    { pos: [0, WALL_H / 2, FLOOR_H / 2], size: [FLOOR_W, WALL_H, 0.3] },
    { pos: [0, WALL_H / 2, -FLOOR_H / 2], size: [FLOOR_W, WALL_H, 0.3] },
    { pos: [-FLOOR_W / 2, WALL_H / 2, 0], size: [0.3, WALL_H, FLOOR_H] },
    { pos: [FLOOR_W / 2, WALL_H / 2, 0], size: [0.3, WALL_H, FLOOR_H] },
    // LOUNGE (back-left)
    { pos: [-10.5, WALL_H / 2, -9], size: [13, WALL_H, 0.3] },
    { pos: [-10.5, WALL_H / 2, -14], size: [13, WALL_H, 0.3] },
    { pos: [-17, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
    { pos: [-4, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
    // DATA CORE (back-mid)
    { pos: [0, WALL_H / 2, -9], size: [6, WALL_H, 0.3] },
    { pos: [0, WALL_H / 2, -14], size: [6, WALL_H, 0.3] },
    { pos: [-3, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
    { pos: [3, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
    // WAR ROOM (back-right)
    { pos: [10.5, WALL_H / 2, -9], size: [13, WALL_H, 0.3] },
    { pos: [10.5, WALL_H / 2, -14], size: [13, WALL_H, 0.3] },
    { pos: [4, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
    { pos: [17, WALL_H / 2, -11.5], size: [0.3, WALL_H, 5] },
  ];
  return (
    <group>
      {/* dark base floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[FLOOR_W, FLOOR_H]} /><meshBasicMaterial color="#05080f" /></mesh>
      {/* neon grid */}
      <gridHelper args={[FLOOR_W, FLOOR_W, "#1e90ff", "#0d3b66"]} position={[0, 0.02, 0]} />
      {walls.map((w, i) => <HWall key={i} pos={w.pos} size={w.size} />)}
      {/* portals (doorways) */}
      <Portal x={0} z={FLOOR_H / 2} axis="z" />
      <Portal x={-10.5} z={-9} axis="x" />
      <Portal x={0} z={-9} axis="x" />
      <Portal x={10.5} z={-9} axis="x" />
      {/* glowing room floor pads */}
      <mesh position={[-10.5, 0.015, -11.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 4.6]} /><meshBasicMaterial color="#08303f" transparent opacity={0.5} /></mesh>
      <mesh position={[0, 0.015, -11.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[5.4, 4.6]} /><meshBasicMaterial color="#0a2a3f" transparent opacity={0.5} /></mesh>
      <mesh position={[10.5, 0.015, -11.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 4.6]} /><meshBasicMaterial color="#08303a" transparent opacity={0.5} /></mesh>
      {/* room labels */}
      <Label text="LOUNGE" y={2.9} color="#38bdf8" position={[-10.5, 0, -13.4]} />
      <Label text="DATA CORE" y={2.9} color="#818cf8" position={[0, 0, -13.4]} />
      <Label text="WAR ROOM" y={2.9} color="#34d399" position={[10.5, 0, -13.4]} />
    </group>
  );
}

// ── Drifting particles (ambiance) ──────────────────────────
function Particles() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = 220; const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = (Math.random() - 0.5) * FLOOR_W; arr[i * 3 + 1] = Math.random() * 12 + 0.5; arr[i * 3 + 2] = (Math.random() - 0.5) * FLOOR_H; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3)); return g;
  }, []);
  useFrame((_, dt) => { if (ref.current) { ref.current.rotation.y += dt * 0.02; } });
  return <points ref={ref} geometry={geo}><pointsMaterial color="#38bdf8" size={0.08} transparent opacity={0.5} sizeAttenuation /></points>;
}

// ── Agent unit ─────────────────────────────────────────────
const THOUGHTS = ["Compiling context…", "Crunching data…", "Drafting reply…", "Syncing memory…", "Scanning logs…", "Planning step…", "Optimizing route…", "Checking alerts…"];
function AgentUnit({ agent, seat, color, speaking, onSelect }: { agent: Agent; seat: { x: number; z: number; facing: number }; color: string; speaking: boolean; onSelect?: (a: Agent) => void }) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(seat.x, 0, seat.z));
  const facing = useRef(seat.facing);
  const path = useRef<{ x: number; z: number }[]>([]);
  const wp = useRef(0);
  const state = useRef<"idle" | "walk" | "sit">("idle");
  const idleT = useRef(Math.random() * 4);
  const thoughtI = useRef(Math.floor(Math.random() * THOUGHTS.length));
  const speed = 2.2 + Math.random() * 0.4;
  const nav = useMemo(() => new NavGrid([
    { x: -17, z: -14, w: 13, d: 5 }, { x: -3, z: -14, w: 6, d: 5 }, { x: 4, z: -14, w: 13, d: 5 },
  ]), []);
  useEffect(() => {
    nav.carve(-12, -9.4, -9, -8.6); nav.carve(-1.5, -9.4, 1.5, -8.6); nav.carve(9, -9.4, 12, -8.6);
  }, [nav]);
  const bubbleRef = useRef<THREE.Sprite>(null);
  const bubbleTex = useRef<THREE.CanvasTexture | null>(null);
  const lastBubble = useRef("");
  const working = agent.status === "working" || agent.status === "active";
  const offline = agent.status === "offline" || agent.status === "error";
  useEffect(() => {
    if (working) { const p = nav.findPath(pos.current.x, pos.current.z, seat.x, seat.z); path.current = p; wp.current = 0; state.current = p.length ? "walk" : "sit"; }
    else if (offline) { const p = nav.findPath(pos.current.x, pos.current.z, -10.5, -11.5); path.current = p; wp.current = 0; state.current = p.length ? "walk" : "sit"; }
    else { state.current = "idle"; idleT.current = 1 + Math.random() * 3; }
  }, [working, offline, seat.x, seat.z, nav]);
  useFrame((_, dt) => {
    if (!group.current) return;
    const p = pos.current; let walking = false;
    if (state.current === "walk" && wp.current < path.current.length) {
      const w = path.current[wp.current]; const dx = w.x - p.x, dz = w.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 0.1) { const step = Math.min(speed * dt, dist); p.x += (dx / dist) * step; p.z += (dz / dist) * step; facing.current = Math.atan2(dx, dz); walking = true; }
      else wp.current++;
      if (wp.current >= path.current.length) state.current = working ? "sit" : "idle";
    } else if (state.current === "idle") {
      idleT.current -= dt;
      if (idleT.current <= 0) {
        const tx = Math.random() * (FLOOR_W - 4) - (FLOOR_W / 2 - 2), tz = Math.random() * (FLOOR_H - 6) - (FLOOR_H / 2 - 4);
        const r = nav.findPath(p.x, p.z, tx, tz); if (r.length) { path.current = r; wp.current = 0; state.current = "walk"; }
        idleT.current = 4 + Math.random() * 4;
      }
    }
    group.current.position.set(p.x, 0, p.z);
    let diff = facing.current - group.current.rotation.y; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    group.current.rotation.y += diff * Math.min(1, dt * 8);
    const txt = speaking ? "💬 " + (agent.currentTask || "Responding…") : (working ? THOUGHTS[thoughtI.current % THOUGHTS.length] : "");
    if (bubbleRef.current) {
      bubbleRef.current.visible = !!txt;
      if (txt && txt !== lastBubble.current) {
        if (bubbleTex.current) bubbleTex.current.dispose();
        bubbleTex.current = makeBubbleTexture(txt.length > 46 ? txt.slice(0, 44) + "…" : txt, color);
        (bubbleRef.current.material as THREE.SpriteMaterial).map = bubbleTex.current;
        (bubbleRef.current.material as THREE.SpriteMaterial).needsUpdate = true; lastBubble.current = txt;
      }
    }
  });
  const beacon = working ? "#34d399" : offline ? "#475569" : "#38bdf8";
  return (
    <group ref={group} position={[pos.current.x, 0, pos.current.z]}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onSelect?.(agent); }}>
      {/* ground glow ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.55, 0.72, 28]} /><meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} /></mesh>
      <Char color={color} walking={state.current === "walk"} talking={speaking || working} />
      <mesh position={[0, 2.75, 0]}><sphereGeometry args={[0.12, 16, 16]} /><meshBasicMaterial color={beacon} /></mesh>
      <sprite ref={bubbleRef} position={[0, 3.8, 0]} scale={[3.2, 1.25, 1]} visible={false}><spriteMaterial transparent depthWrite={false} /></sprite>
    </group>
  );
}

function SciFiScene({ agents, speakingId, onSelect }: { agents: Agent[]; speakingId?: string; onSelect?: (a: Agent) => void }) {
  const seats = useMemo(() => [
    { x: -13.5, z: 2, facing: 0 }, { x: -13.5, z: 6, facing: 0 }, { x: -13.5, z: 10, facing: 0 },
    { x: 13.5, z: 2, facing: Math.PI }, { x: 13.5, z: 6, facing: Math.PI }, { x: 13.5, z: 10, facing: Math.PI },
    { x: -4.5, z: 4, facing: 0 }, { x: 4.5, z: 4, facing: 0 },
  ], []);
  return (
    <>
      <OfficeShell />
      <Particles />
      {seats.map((s, i) => <Desk key={i} x={s.x} z={s.z} color={agents[i]?.color ?? "#38bdf8"} facing={s.facing} label={agents[i]?.name ?? `Unit ${i + 1}`} />)}
      {agents.map((a, i) => <AgentUnit key={a.id} agent={a} seat={seats[i % seats.length]} color={a.color} speaking={speakingId === a.id} onSelect={onSelect} />)}
    </>
  );
}

export default function AgentsOffice({ agents, speakingId, onSelect }: { agents: Agent[]; speakingId?: string; onSelect?: (a: Agent) => void }) {
  return (
    <ErrorBoundary fallback={<div style={{ padding: 24, color: "#f87171" }}>3D office failed to load. Check WebGL / browser support.</div>}>
      <Canvas camera={{ position: [0, 30, 22], fov: 46 }} gl={{ antialias: true, powerPreference: "high-performance" }} style={{ width: "100%", height: "100%" }}>
        <color attach="background" args={["#05070d"]} />
        <fog attach="fog" args={["#05070d", 34, 64]} />
        <Suspense fallback={null}><SciFiScene agents={agents} speakingId={speakingId} onSelect={onSelect} /></Suspense>
        <OrbitControls target={[0, 1, 0]} enablePan minDistance={12} maxDistance={52} maxPolarAngle={1.5} />
      </Canvas>
    </ErrorBoundary>
  );
}
