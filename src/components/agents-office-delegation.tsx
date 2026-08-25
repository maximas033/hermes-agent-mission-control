"use client";

import { Suspense, useMemo, useRef, Component, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────────
//  FAITHFUL DELEGATION-STYLE OFFICE
//  - grid "navmesh" A* pathfinding (no external .glb assets)
//  - emissive colored agent pods, lit rooms
//  - idle / walk / sit_work / talk state machine
//  - 3D speech bubbles
//  Free, Vercel-safe, no API keys.
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

// ── Office geometry constants ────────────────────────────────
const OX = -13, OZ = -8, CELL = 1;
const COLS = 27, ROWS = 17; // x:[-13,13], z:[-8,8]
const WALL_H = 3.2, WALL_T = 0.4;

// ── Canvas text/label helpers (zero network) ─────────────────
function makeLabelTexture(text: string, fg = "#0f172a", bg = "rgba(255,255,255,0.92)") {
  const canvas = document.createElement("canvas");
  const s = 3, w = 512, h = 128;
  canvas.width = w * s; canvas.height = h * s;
  const ctx = canvas.getContext("2d")!; ctx.scale(s, s);
  if (bg !== "rgba(0,0,0,0)") {
    ctx.fillStyle = bg; const r = 22;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.fill();
  }
  ctx.font = "800 60px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4; return tex;
}

function makeBubbleTexture(text: string, color = "#0ea5e9") {
  const canvas = document.createElement("canvas");
  const s = 2, pad = 24, fs = 44;
  canvas.width = 512 * s; canvas.height = 200 * s;
  const ctx = canvas.getContext("2d")!; ctx.scale(s, s);
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const maxW = 440;
  // wrap text
  const words = text.split(" "); const lines: string[] = []; let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const lh = fs + 10;
  const boxH = pad * 2 + lines.length * lh;
  const boxW = Math.min(maxW + pad * 2, 480);
  const bx = (512 - boxW) / 2, by = 8;
  // bubble
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(bx + r, by); ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
  ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r); ctx.arcTo(bx, by + boxH, bx, by, r);
  ctx.arcTo(bx, by, bx + boxW, by, r); ctx.fill();
  // tail
  ctx.beginPath(); ctx.moveTo(512 / 2 - 14, by + boxH); ctx.lineTo(512 / 2, by + boxH + 26); ctx.lineTo(512 / 2 + 14, by + boxH); ctx.closePath(); ctx.fill();
  // accent bar
  ctx.fillStyle = color; ctx.fillRect(bx, by, boxW, 8);
  // text
  ctx.fillStyle = "#0f172a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, 512 / 2, by + pad + i * lh + lh / 2));
  const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4; return tex;
}

function Label({ text, y = 3.4, color = "#0f172a" }: { text: string; y?: number; color?: string }) {
  const tex = useMemo(() => makeLabelTexture(text, color), [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return <sprite position={[0, y, 0]} scale={[3.2, 0.8, 1]}><spriteMaterial map={tex} transparent depthWrite={false} /></sprite>;
}

// ── Navigation grid ("navmesh" via A*) ───────────────────────
class NavGrid {
  blocked: Uint8Array;
  constructor() {
    this.blocked = new Uint8Array(COLS * ROWS);
    this.build();
  }
  idx(cx: number, cz: number) { return cz * COLS + cx; }
  inBounds(cx: number, cz: number) { return cx >= 0 && cx < COLS && cz >= 0 && cz < ROWS; }
  isBlockedCell(cx: number, cz: number) { return !this.inBounds(cx, cz) || this.blocked[this.idx(cx, cz)] === 1; }
  worldToCell(x: number, z: number) {
    return { cx: Math.round((x - OX) / CELL), cz: Math.round((z - OZ) / CELL) };
  }
  cellToWorld(cx: number, cz: number) { return { x: OX + cx * CELL, z: OZ + cz * CELL }; }
  private rect(x1: number, z1: number, x2: number, z2: number) {
    const c1 = this.worldToCell(x1, z1), c2 = this.worldToCell(x2, z2);
    for (let cz = Math.min(c1.cz, c2.cz); cz <= Math.max(c1.cz, c2.cz); cz++)
      for (let cx = Math.min(c1.cx, c2.cx); cx <= Math.max(c1.cx, c2.cx); cx++)
        if (this.inBounds(cx, cz)) this.blocked[this.idx(cx, cz)] = 1;
  }
  private build() {
    // perimeter walls
    this.rect(-13, 7.6, 13, 8);        // back (z=8)
    this.rect(-13, -8, 13, -7.6);      // front (z=-8)
    this.rect(-13, -8, -12.6, 8);      // left
    this.rect(12.6, -8, 13, 8);        // right
    // front entrance door gap x[-2.5,2.5] on front wall kept open (default blocked; carve):
    this.carve(-2.5, -8, 2.5, -7.6);
    // break room (back-left) walls: front + right
    this.rect(-12.3, -4.8, -7.3, -4.5); this.carve(-9.8, -4.8, -8.3, -4.5); // front wall w/ door
    this.rect(-7.3, -7.7, -7.0, -4.8);
    // war room (back-right) walls: front + left
    this.rect(7.3, -4.8, 12.3, -4.5); this.carve(8.8, -4.8, 10.3, -4.5);
    this.rect(7.0, -7.7, 7.3, -4.8);
  }
  private carve(x1: number, z1: number, x2: number, z2: number) {
    const c1 = this.worldToCell(x1, z1), c2 = this.worldToCell(x2, z2);
    for (let cz = Math.min(c1.cz, c2.cz); cz <= Math.max(c1.cz, c2.cz); cz++)
      for (let cx = Math.min(c1.cx, c2.cx); cx <= Math.max(c1.cx, c2.cx); cx++)
        if (this.inBounds(cx, cz)) this.blocked[this.idx(cx, cz)] = 0;
  }
  nearestWalkable(cx: number, cz: number) {
    if (!this.isBlockedCell(cx, cz)) return { cx, cz };
    for (let r = 1; r < 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (!this.isBlockedCell(nx, nz)) return { cx: nx, cz: nz };
        }
    return { cx, cz };
  }
  // A* -> array of world waypoints (excluding the start cell)
  findPath(sx: number, sz: number, gx: number, gz: number): { x: number; z: number }[] {
    const s = this.nearestWalkable(...Object.values(this.worldToCell(sx, sz)) as [number, number]);
    const g = this.nearestWalkable(...Object.values(this.worldToCell(gx, gz)) as [number, number]);
    const start = this.idx(s.cx, s.cz), goal = this.idx(g.cx, g.cz);
    if (start === goal) return [];
    const open: number[] = [start];
    const came = new Map<number, number>();
    const gScore = new Map<number, number>([[start, 0]]);
    const fScore = new Map<number, number>([[start, this.h(start, goal)]]);
    const closed = new Set<number>();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let guard = 0;
    while (open.length && guard++ < 5000) {
      // pop lowest f
      let bi = 0; for (let i = 1; i < open.length; i++) if ((fScore.get(open[i]) ?? 1e9) < (fScore.get(open[bi]) ?? 1e9)) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) return this.reconstruct(came, cur);
      closed.add(cur);
      const ccx = cur % COLS, ccz = Math.floor(cur / COLS);
      for (const [dx, dz] of dirs) {
        const nx = ccx + dx, nz = ccz + dz;
        if (this.isBlockedCell(nx, nz)) continue;
        const n = this.idx(nx, nz);
        if (closed.has(n)) continue;
        const step = dx && dz ? 1.414 : 1;
        const tentative = (gScore.get(cur) ?? 1e9) + step;
        if (tentative < (gScore.get(n) ?? 1e9)) {
          came.set(n, cur); gScore.set(n, tentative);
          fScore.set(n, tentative + this.h(n, goal));
          if (!open.includes(n)) open.push(n);
        }
      }
    }
    return [];
  }
  private h(a: number, b: number) {
    const ax = a % COLS, az = Math.floor(a / COLS), bx = b % COLS, bz = Math.floor(b / COLS);
    return Math.abs(ax - bx) + Math.abs(az - bz);
  }
  private reconstruct(came: Map<number, number>, cur: number) {
    const path: { x: number; z: number }[] = [];
    let c: number | undefined = cur;
    while (c !== undefined && came.has(c)) {
      const cx = c % COLS, cz = Math.floor(c / COLS);
      const w = this.cellToWorld(cx, cz); path.unshift(w); c = came.get(c);
    }
    return path;
  }
}

const THOUGHTS = [
  "Reviewing the queue…", "Crunching data…", "Drafting a reply…", "Syncing memory…",
  "Scanning logs…", "Planning next step…", "Optimizing route…", "Checking alerts…",
];

// ── Character ────────────────────────────────────────────────
function Character({ color, walking, sitting, talking }: { color: string; walking: boolean; sitting: boolean; talking: boolean }) {
  const t = useRef(0);
  const la = useRef<THREE.Mesh>(null), ra = useRef<THREE.Mesh>(null);
  const ll = useRef<THREE.Mesh>(null), rl = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    t.current += dt;
    const sw = walking ? Math.sin(t.current * 9) * 0.6 : 0;
    if (la.current) la.current.rotation.x = sw;
    if (ra.current) ra.current.rotation.x = -sw;
    if (ll.current) ll.current.rotation.x = -sw;
    if (rl.current) rl.current.rotation.x = sw;
    if (body.current) {
      body.current.position.y = walking ? Math.abs(Math.sin(t.current * 9)) * 0.05 : 0;
      body.current.rotation.y = talking ? Math.sin(t.current * 6) * 0.04 : 0;
    }
  });
  const skin = "#e8b98c", shirt = color, pants = "#2b3440";
  return (
    <group>
      <mesh ref={ll} position={[-0.22, 0.45, 0]}><boxGeometry args={[0.34, 0.9, 0.34]} /><meshStandardMaterial color={pants} roughness={0.8} /></mesh>
      <mesh ref={rl} position={[0.22, 0.45, 0]}><boxGeometry args={[0.34, 0.9, 0.34]} /><meshStandardMaterial color={pants} roughness={0.8} /></mesh>
      <group ref={body} position={[0, 0.9, 0]}>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[0.8, 0.9, 0.42]} /><meshStandardMaterial color={shirt} roughness={0.7} /></mesh>
        <mesh ref={la} position={[-0.58, 0.45, 0]}><boxGeometry args={[0.26, 0.82, 0.32]} /><meshStandardMaterial color={shirt} roughness={0.7} /></mesh>
        <mesh ref={ra} position={[0.58, 0.45, 0]}><boxGeometry args={[0.26, 0.82, 0.32]} /><meshStandardMaterial color={shirt} roughness={0.7} /></mesh>
        <group position={[0, 1.25, 0]}>
          <mesh><boxGeometry args={[0.7, 0.7, 0.7]} /><meshStandardMaterial color={skin} roughness={0.8} /></mesh>
          <mesh position={[0, 0.34, 0]}><boxGeometry args={[0.74, 0.22, 0.74]} /><meshStandardMaterial color={shirt} roughness={0.7} /></mesh>
          <mesh position={[-0.17, 0.02, 0.355]}><boxGeometry args={[0.14, 0.18, 0.04]} /><meshStandardMaterial color="#10141b" /></mesh>
          <mesh position={[0.17, 0.02, 0.355]}><boxGeometry args={[0.14, 0.18, 0.04]} /><meshStandardMaterial color="#10141b" /></mesh>
        </group>
      </group>
    </group>
  );
}

// ── Office geometry ──────────────────────────────────────────
function Wall({ pos, size, color = "#d4dcea" }: { pos: [number, number, number]; size: [number, number, number]; color?: string }) {
  return <mesh position={pos} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.95} /></mesh>;
}

function OfficeShell() {
  const walls: { pos: [number, number, number]; size: [number, number, number] }[] = [
    { pos: [0, WALL_H / 2, 7.8], size: [26, WALL_H, WALL_T] },
    { pos: [0, WALL_H / 2, -7.8], size: [26, WALL_H, WALL_T] },
    { pos: [-12.8, WALL_H / 2, 0], size: [WALL_T, WALL_H, 16] },
    { pos: [12.8, WALL_H / 2, 0], size: [WALL_T, WALL_H, 16] },
    // front entrance jambs (gap x[-2.5,2.5])
    { pos: [-7.75, WALL_H / 2, 7.8], size: [10.5, WALL_H, WALL_T] },
    { pos: [7.75, WALL_H / 2, 7.8], size: [10.5, WALL_H, WALL_T] },
    // break room (back-left)
    { pos: [-9.8, WALL_H / 2, -4.65], size: [5, WALL_H - 0.4, WALL_T] },
    { pos: [-7.15, WALL_H / 2, -6.25], size: [WALL_T, WALL_H - 0.4, 3.5] },
    // war room (back-right)
    { pos: [9.8, WALL_H / 2, -4.65], size: [5, WALL_H - 0.4, WALL_T] },
    { pos: [7.15, WALL_H / 2, -6.25], size: [WALL_T, WALL_H - 0.4, 3.5] },
  ];
  return (
    <group>
      {/* floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[26, 16]} /><meshStandardMaterial color="#1b2230" roughness={0.85} />
      </mesh>
      {/* floor grid */}
      <gridHelper args={[26, 26, "#2b3a55", "#1e2940"]} position={[0, 0.02, 0]} />
      {/* ceiling */}
      <mesh position={[0, WALL_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[26, 16]} /><meshStandardMaterial color="#10151f" side={THREE.DoubleSide} />
      </mesh>
      {walls.map((w, i) => <Wall key={i} pos={w.pos} size={w.size} />)}
      {/* light fixtures */}
      {[[-6, -4], [6, -4], [-6, 4], [6, 4]].map(([x, z], i) => (
        <group key={i} position={[x, WALL_H - 0.15, z]}>
          <mesh><boxGeometry args={[1.4, 0.18, 1.4]} /><meshStandardMaterial color="#fef3c7" emissive="#fff4e6" emissiveIntensity={1.1} toneMapped={false} /></mesh>
          <pointLight position={[0, -0.4, 0]} intensity={20} distance={22} decay={1.4} color="#fff1da" />
        </group>
      ))}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#cdd9ff", "#1b2230", 0.4]} />
    </group>
  );
}

// emissive colored pod (per-agent "room"/desk)
function Pod({ x, z, color, facing, label }: { x: number; z: number; color: string; facing: number; label: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      {/* glowing floor disc */}
      <mesh position={[0, 0.03, 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6, 32]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      {/* desk */}
      <mesh position={[0, 0.75, -0.4]} castShadow><boxGeometry args={[2.0, 0.12, 0.9]} /><meshStandardMaterial color="#8a6a45" roughness={0.8} /></mesh>
      {[[-0.85, -0.7], [0.85, -0.7], [-0.85, -0.1], [0.85, -0.1]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.37, lz]}><boxGeometry args={[0.1, 0.75, 0.1]} /><meshStandardMaterial color="#5c4631" /></mesh>
      ))}
      {/* monitor */}
      <group position={[0, 1.5, -0.6]}>
        <mesh><boxGeometry args={[0.95, 0.6, 0.07]} /><meshStandardMaterial color="#11141b" /></mesh>
        <mesh position={[0, 0, 0.05]}><boxGeometry args={[0.85, 0.5, 0.02]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} toneMapped={false} /></mesh>
      </group>
      {/* chair */}
      <mesh position={[0, 0.45, 0.6]}><boxGeometry args={[0.7, 0.12, 0.7]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh position={[0, 0.95, 0.35]}><boxGeometry args={[0.7, 0.7, 0.12]} /><meshStandardMaterial color="#334155" /></mesh>
      {/* accent pillar */}
      <mesh position={[0, 1.2, -1.0]}><boxGeometry args={[0.25, 2.4, 0.25]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} toneMapped={false} /></mesh>
      <Label text={label} y={2.7} color="#0f172a" />
    </group>
  );
}

// ── Agent controller (state machine + pathAgent + bubble) ────
function AgentUnit({
  agent, index, seat, color, speaking, onSelect,
}: {
  agent: Agent; index: number; seat: { x: number; z: number; facing: number };
  color: string; speaking: boolean; onSelect?: (a: Agent) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(seat.x, 0, seat.z));
  const facing = useRef(seat.facing);
  const path = useRef<{ x: number; z: number }[]>([]);
  const wp = useRef(0);
  const state = useRef<"idle" | "walk" | "sit" | "talk">("idle");
  const idleT = useRef(Math.random() * 4);
  const thoughtI = useRef(Math.floor(Math.random() * THOUGHTS.length));
  const speed = 2.0 + Math.random() * 0.4;
  const nav = useMemo(() => new NavGrid(), []);
  const bubbleRef = useRef<THREE.Sprite>(null);
  const bubbleTex = useRef<THREE.CanvasTexture | null>(null);
  const lastBubbleText = useRef("");

  const working = agent.status === "working" || agent.status === "active";
  const offline = agent.status === "offline" || agent.status === "error";

  // assign destination when status changes
  useEffect(() => {
    if (working) {
      const p = nav.findPath(pos.current.x, pos.current.z, seat.x, seat.z);
      path.current = p; wp.current = 0; state.current = p.length ? "walk" : "sit";
    } else if (offline) {
      // park in break room
      const p = nav.findPath(pos.current.x, pos.current.z, -9.8, -6.2);
      path.current = p; wp.current = 0; state.current = p.length ? "walk" : "sit";
    } else {
      state.current = "idle"; idleT.current = 1 + Math.random() * 3;
    }
  }, [working, offline, seat.x, seat.z, nav]);

  useFrame((_, dt) => {
    if (!group.current) return;
    const p = pos.current;
    let walking = false;
    if (state.current === "walk" && wp.current < path.current.length) {
      const w = path.current[wp.current];
      const dx = w.x - p.x, dz = w.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        const step = Math.min(speed * dt, dist);
        p.x += (dx / dist) * step; p.z += (dz / dist) * step;
        facing.current = Math.atan2(dx, dz);
        walking = true;
      } else wp.current++;
      if (wp.current >= path.current.length) state.current = (working ? "sit" : "idle");
    } else if (state.current === "idle") {
      idleT.current -= dt;
      if (idleT.current <= 0) {
        // wander to a random walkable cell in the open area
        const tx = (Math.random() * 22 - 11), tz = (Math.random() * 13 - 6.5);
        const route = nav.findPath(p.x, p.z, tx, tz);
        if (route.length) { path.current = route; wp.current = 0; state.current = "walk"; }
        idleT.current = 4 + Math.random() * 4;
      }
    }
    group.current.position.set(p.x, 0, p.z);
    let diff = facing.current - group.current.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    group.current.rotation.y += diff * Math.min(1, dt * 8);

    // bubble
    const showTalk = speaking || (working && Math.floor(performance.now() / 2600) % THOUGHTS.length === thoughtI.current % THOUGHTS.length);
    const txt = speaking ? "💬 " + (agent.currentTask || "Responding…") : (working ? THOUGHTS[thoughtI.current % THOUGHTS.length] : "");
    if (bubbleRef.current) {
      bubbleRef.current.visible = !!txt;
      if (txt && txt !== lastBubbleText.current) {
        if (bubbleTex.current) bubbleTex.current.dispose();
        bubbleTex.current = makeBubbleTexture(txt.length > 46 ? txt.slice(0, 44) + "…" : txt, color);
        (bubbleRef.current.material as THREE.SpriteMaterial).map = bubbleTex.current;
        (bubbleRef.current.material as THREE.SpriteMaterial).needsUpdate = true;
        lastBubbleText.current = txt;
      }
    }
  });

  const beacon = working ? "#22c55e" : offline ? "#64748b" : "#3b82f6";
  return (
    <group
      ref={group}
      position={[pos.current.x, 0, pos.current.z]}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onSelect?.(agent); }}
    >
      <Character color={color} walking={state.current === "walk"} sitting={state.current === "sit"} talking={speaking || working} />
      <mesh position={[0, 3.0, 0]}><sphereGeometry args={[0.13, 16, 16]} /><meshBasicMaterial color={beacon} toneMapped={false} /></mesh>
      <sprite ref={bubbleRef} position={[0, 4.0, 0]} scale={[3.0, 1.2, 1]} visible={false}>
        <spriteMaterial transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

// ── Scene assembler ──────────────────────────────────────────
function DelegationScene({ agents, speakingId, onSelect }: { agents: Agent[]; speakingId?: string; onSelect?: (a: Agent) => void }) {
  // seats: 8 pods around perimeter
  const seats = useMemo(() => [
    { x: -10.5, z: -2.5, facing: Math.PI / 2 }, { x: -10.5, z: 1, facing: Math.PI / 2 }, { x: -10.5, z: 4.5, facing: Math.PI / 2 },
    { x: 10.5, z: -2.5, facing: -Math.PI / 2 }, { x: 10.5, z: 1, facing: -Math.PI / 2 }, { x: 10.5, z: 4.5, facing: -Math.PI / 2 },
    { x: -3, z: 6.2, facing: Math.PI }, { x: 3, z: 6.2, facing: Math.PI },
  ], []);
  return (
    <>
      <OfficeShell />
      {seats.map((s, i) => (
        <Pod key={i} x={s.x} z={s.z} color={agents[i]?.color ?? "#64748b"} facing={s.facing} label={agents[i]?.name ?? `Agent ${i + 1}`} />
      ))}
      {agents.map((a, i) => (
        <AgentUnit key={a.id} agent={a} index={i} seat={seats[i % seats.length]} color={a.color} speaking={speakingId === a.id} onSelect={onSelect} />
      ))}
      {/* room labels */}
      <Label text="BREAK ROOM" y={2.4} color="#0f172a" />
      <Label text="WAR ROOM" y={2.4} color="#0f172a" />
    </>
  );
}

export default function AgentsOffice({ agents, speakingId, onSelect }: { agents: Agent[]; speakingId?: string; onSelect?: (a: Agent) => void }) {
  return (
    <ErrorBoundary fallback={<div style={{ padding: 24, color: "#f87171" }}>3D office failed to load. Check WebGL / browser support.</div>}>
      <Canvas shadows camera={{ position: [0, 16, 20], fov: 50 }} gl={{ antialias: true, powerPreference: "high-performance" }} style={{ width: "100%", height: "100%" }}>
        <color attach="background" args={["#0a0d14"]} />
        <Suspense fallback={null}>
          <DelegationScene agents={agents} speakingId={speakingId} onSelect={onSelect} />
        </Suspense>
        <OrbitControls target={[0, 1, 0]} enablePan minDistance={8} maxDistance={46} maxPolarAngle={1.45} />
      </Canvas>
    </ErrorBoundary>
  );
}
