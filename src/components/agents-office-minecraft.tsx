"use client";

import { Suspense, useMemo, useRef, Component, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ---- Error boundary so scene failures show a message instead of black void ----
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
}

const FLOOR_Y = 0;
const WALL_H = 3.4;
const WALL_T = 0.3;
// Building interior usable bounds (agents clamped inside these)
const BX = 12.5; // half-width  (x in [-12.5, 12.5])
const BZ = 7.5;  // half-depth  (z in [-7.5, 7.5])
// Interior divider walls at x = -8 (BREAK) and x = +8 (WAR); door gap z in [-1.5, 1.5]
const DIV_X = 8;
const DOOR_HALF = 1.5;

// ---- Local text texture (zero network) ----
function makeLabelTexture(text: string, fg = "#0f172a", bg = "rgba(255,255,255,0.92)") {
  const canvas = document.createElement("canvas");
  const scale = 3;
  const w = 512;
  const h = 128;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  if (bg !== "rgba(0,0,0,0)") {
    ctx.fillStyle = bg;
    const r = 22;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.fill();
  }
  ctx.font = "800 60px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function Label({ text, y = 3.5, color = "#0f172a" }: { text: string; y?: number; color?: string }) {
  const tex = useMemo(() => makeLabelTexture(text, color), [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={[0, y, 0]} scale={[3.4, 0.85, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// status beacon
function Beacon({ color, y = 3.05 }: { color: string; y?: number }) {
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[0.13, 16, 16]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

// ---- Minecraft-style agent ----
function MinecraftAgent({
  color,
  walking,
  typing,
  facing = 0,
  label,
  beacon,
}: {
  color: string;
  walking: boolean;
  typing: boolean;
  facing?: number;
  label: string;
  beacon: string;
}) {
  const t = useRef(0);
  const limb = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Mesh>(null);
  const rightArm = useRef<THREE.Mesh>(null);
  const leftLeg = useRef<THREE.Mesh>(null);
  const rightLeg = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    t.current += dt;
    const swing = walking ? Math.sin(t.current * 9) * 0.6 : 0;
    const tap = typing ? Math.sin(t.current * 22) * 0.25 : 0;
    if (leftArm.current) leftArm.current.rotation.x = swing - tap;
    if (rightArm.current) rightArm.current.rotation.x = -swing - tap;
    if (leftLeg.current) leftLeg.current.rotation.x = -swing;
    if (rightLeg.current) rightLeg.current.rotation.x = swing;
    if (body.current) body.current.position.y = walking ? 0.06 + Math.abs(Math.sin(t.current * 9)) * 0.04 : 0;
  });

  const skin = "#e8b98c";
  const shirt = color;
  const pants = "#2b3440";

  return (
    <group rotation={[0, facing, 0]}>
      {/* legs */}
      <mesh ref={leftLeg} position={[-0.22, 0.45, 0]}>
        <boxGeometry args={[0.34, 0.9, 0.34]} />
        <meshStandardMaterial color={pants} roughness={0.8} />
      </mesh>
      <mesh ref={rightLeg} position={[0.22, 0.45, 0]}>
        <boxGeometry args={[0.34, 0.9, 0.34]} />
        <meshStandardMaterial color={pants} roughness={0.8} />
      </mesh>
      {/* torso */}
      <group ref={body} position={[0, 0.9, 0]}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[0.8, 0.9, 0.42]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        {/* arms */}
        <mesh ref={leftArm} position={[-0.58, 0.45, 0]}>
          <boxGeometry args={[0.26, 0.82, 0.32]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        <mesh ref={rightArm} position={[0.58, 0.45, 0]}>
          <boxGeometry args={[0.26, 0.82, 0.32]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        {/* head */}
        <group position={[0, 1.25, 0]}>
          <mesh>
            <boxGeometry args={[0.7, 0.7, 0.7]} />
            <meshStandardMaterial color={skin} roughness={0.8} />
          </mesh>
          {/* cap / hair */}
          <mesh position={[0, 0.34, 0]}>
            <boxGeometry args={[0.74, 0.22, 0.74]} />
            <meshStandardMaterial color={shirt} roughness={0.7} />
          </mesh>
          {/* eyes */}
          <mesh position={[-0.17, 0.02, 0.355]}>
            <boxGeometry args={[0.14, 0.18, 0.04]} />
            <meshStandardMaterial color="#10141b" />
          </mesh>
          <mesh position={[0.17, 0.02, 0.355]}>
            <boxGeometry args={[0.14, 0.18, 0.04]} />
            <meshStandardMaterial color="#10141b" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---- Cubicle (desk + glowing monitor + chair + colored partition) ----
function Cubicle({ x, z, color }: { x: number; z: number; color: string }) {
  // desk at (x, z-0.4); agent sits at (x, z+0.9) facing -z
  return (
    <group position={[x, 0, z]}>
      {/* floor mat */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.2, 2.6]} />
        <meshStandardMaterial color={color} transparent opacity={0.18} roughness={1} />
      </mesh>
      {/* L-partition (back + left), colored & clearly visible */}
      <mesh position={[0, 0.65, -1.15]}>
        <boxGeometry args={[3, 1.3, 0.12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.6} />
      </mesh>
      <mesh position={[-1.45, 0.65, -0.2]}>
        <boxGeometry args={[0.12, 1.3, 1.9]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.6} />
      </mesh>
      {/* desk */}
      <mesh position={[0, 0.75, -0.5]}>
        <boxGeometry args={[2.4, 0.12, 1.0]} />
        <meshStandardMaterial color="#8a6a45" roughness={0.8} />
      </mesh>
      {/* desk legs */}
      {[[-1.05, -0.85], [1.05, -0.85], [-1.05, -0.15], [1.05, -0.15]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.37, lz]}>
          <boxGeometry args={[0.1, 0.75, 0.1]} />
          <meshStandardMaterial color="#5c4631" />
        </mesh>
      ))}
      {/* monitor */}
      <group position={[0, 1.55, -0.78]}>
        <mesh>
          <boxGeometry args={[1.0, 0.62, 0.08]} />
          <meshStandardMaterial color="#11141b" />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <boxGeometry args={[0.9, 0.52, 0.02]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      </group>
      {/* chair */}
      <group position={[0, 0, 0.9]}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[0.7, 0.12, 0.7]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[0, 0.95, -0.3]}>
          <boxGeometry args={[0.7, 0.8, 0.12]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      </group>
    </group>
  );
}

// ---- Building: floor, walls w/ doorways, lights, rooms ----
function WallBox({ pos, size, color = "#cbd5e1" }: { pos: [number, number, number]; size: [number, number, number]; color?: string }) {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

function DoorwayFrame({ x, z, axis, color = "#94a3b8" }: { x: number; z: number; axis: "x" | "z"; color?: string }) {
  const post = axis === "x" ? ([0.25, WALL_H, 0.25] as [number, number, number]) : ([0.25, WALL_H, 0.25] as [number, number, number]);
  const lintel = axis === "x"
    ? ([0.3, 0.4, DOOR_HALF * 2 + 0.5] as [number, number, number])
    : ([DOOR_HALF * 2 + 0.5, 0.4, 0.3] as [number, number, number]);
  return (
    <group position={[x, 0, z]}>
      {axis === "x" ? (
        <>
          <mesh position={[-DOOR_HALF - 0.12, WALL_H / 2, 0]}><boxGeometry args={post} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[DOOR_HALF + 0.12, WALL_H / 2, 0]}><boxGeometry args={post} /><meshStandardMaterial color={color} /></mesh>
        </>
      ) : (
        <>
          <mesh position={[0, WALL_H / 2, -DOOR_HALF - 0.12]}><boxGeometry args={post} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, WALL_H / 2, DOOR_HALF + 0.12]}><boxGeometry args={post} /><meshStandardMaterial color={color} /></mesh>
        </>
      )}
      <mesh position={[0, WALL_H - 0.2, 0]}><boxGeometry args={lintel} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

function LightFixture({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, WALL_H - 0.15, z]}>
      <mesh>
        <boxGeometry args={[1.3, 0.18, 1.3]} />
        <meshStandardMaterial color="#fef3c7" emissive="#fff4e6" emissiveIntensity={1.1} toneMapped={false} />
      </mesh>
      <pointLight position={[0, -0.4, 0]} intensity={22} distance={22} decay={1.4} color="#fff1da" />
    </group>
  );
}

function Building() {
  const wallColor = "#cdd6e4";
  // outer walls
  const walls: { pos: [number, number, number]; size: [number, number, number] }[] = [
    // north (z=+7.5)
    { pos: [0, WALL_H / 2, BZ], size: [26, WALL_H, WALL_T] },
    // south (z=-7.5) split for entrance door at x in [-1.5,1.5]
    { pos: [(-13 + -1.5) / 2, WALL_H / 2, -BZ], size: [11.5, WALL_H, WALL_T] },
    { pos: [(1.5 + 13) / 2, WALL_H / 2, -BZ], size: [11.5, WALL_H, WALL_T] },
    // east (x=+12.5)
    { pos: [BX, WALL_H / 2, 0], size: [WALL_T, WALL_H, 16] },
    // west (x=-12.5)
    { pos: [-BX, WALL_H / 2, 0], size: [WALL_T, WALL_H, 16] },
    // break divider (x=-8) split for door at z in [-1.5,1.5]
    { pos: [-DIV_X, WALL_H / 2, (-8 + -1.5) / 2], size: [WALL_T, WALL_H - 0.3, 6.5] },
    { pos: [-DIV_X, WALL_H / 2, (1.5 + 8) / 2], size: [WALL_T, WALL_H - 0.3, 6.5] },
    // war divider (x=+8)
    { pos: [DIV_X, WALL_H / 2, (-8 + -1.5) / 2], size: [WALL_T, WALL_H - 0.3, 6.5] },
    { pos: [DIV_X, WALL_H / 2, (1.5 + 8) / 2], size: [WALL_T, WALL_H - 0.3, 6.5] },
  ];
  return (
    <group>
      {/* floor */}
      <mesh position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[26, 16]} />
        <meshStandardMaterial color="#b08968" roughness={0.95} />
      </mesh>
      {/* floor grid */}
      <gridHelper args={[26, 26, "#7a6a52", "#5c4a37"]} position={[0, 0.02, 0]} scale={[1, 1, 16 / 26]} />
      {/* ceiling */}
      <mesh position={[0, WALL_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[26, 16]} />
        <meshStandardMaterial color="#1b2230" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* walls */}
      {walls.map((w, i) => (
        <WallBox key={i} pos={w.pos} size={w.size} color={wallColor} />
      ))}
      {/* baseboard accent */}
      <mesh position={[0, 0.2, BZ - WALL_T / 2]}><boxGeometry args={[26, 0.4, 0.06]} /><meshStandardMaterial color="#64748b" /></mesh>
      <mesh position={[0, 0.2, -BZ + WALL_T / 2]}><boxGeometry args={[26, 0.4, 0.06]} /><meshStandardMaterial color="#64748b" /></mesh>
      {/* doorways */}
      <DoorwayFrame x={0} z={-BZ} axis="z" />
      <DoorwayFrame x={-DIV_X} z={0} axis="x" />
      <DoorwayFrame x={DIV_X} z={0} axis="x" />
      {/* light fixtures */}
      <LightFixture x={-6} z={-4} />
      <LightFixture x={6} z={-4} />
      <LightFixture x={-6} z={4} />
      <LightFixture x={6} z={4} />
      {/* room rugs */}
      <mesh position={[-10, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7, 13]} /><meshStandardMaterial color="#3b4a63" roughness={1} />
      </mesh>
      <mesh position={[10, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7, 13]} /><meshStandardMaterial color="#4a3b63" roughness={1} />
      </mesh>
      {/* break-room sofa */}
      <group position={[-10.5, 0, 0]}>
        <mesh position={[0, 0.4, 0]}><boxGeometry args={[1.6, 0.5, 3]} /><meshStandardMaterial color="#475569" /></mesh>
        <mesh position={[0.8, 0.8, 0]}><boxGeometry args={[0.4, 0.8, 3]} /><meshStandardMaterial color="#475569" /></mesh>
      </group>
      {/* war-room meeting table */}
      <group position={[10, 0, 0]}>
        <mesh position={[0, 0.7, 0]}><boxGeometry args={[3, 0.18, 1.6]} /><meshStandardMaterial color="#8a6a45" /></mesh>
        {[[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]].map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 0.35, cz]}><boxGeometry args={[0.5, 0.7, 0.5]} /><meshStandardMaterial color="#334155" /></mesh>
        ))}
      </group>
    </group>
  );
}

// ---- Navigation helpers ----
type Region = "MAIN" | "BREAK" | "WAR";
function regionOf(x: number): Region {
  if (x < -DIV_X) return "BREAK";
  if (x > DIV_X) return "WAR";
  return "MAIN";
}
function doorFor(from: Region, to: Region) {
  // returns ordered waypoints [mainSide, gap, roomSide] to cross into `to`
  if (to === "BREAK") return [{ x: -7, z: 0 }, { x: -DIV_X, z: 0 }, { x: -10, z: 0 }];
  if (to === "WAR") return [{ x: 7, z: 0 }, { x: DIV_X, z: 0 }, { x: 10, z: 0 }];
  return [{ x: 0, z: 0 }];
}
function route(fromX: number, to: { x: number; z: number }): { x: number; z: number }[] {
  const from = regionOf(fromX);
  const toR = regionOf(to.x);
  if (from === toR) return [to];
  if ((from === "MAIN" && toR === "BREAK") || (from === "BREAK" && toR === "MAIN"))
    return [...doorFor(from, toR), to];
  if ((from === "MAIN" && toR === "WAR") || (from === "WAR" && toR === "MAIN"))
    return [...doorFor(from, toR), to];
  // BREAK <-> WAR via MAIN
  const mid = doorFor(from, "MAIN").slice(0, 2);
  const second = doorFor("MAIN", toR);
  return [...mid, ...second, to];
}

function clampInside(p: THREE.Vector3, prevX: number) {
  p.x = Math.max(-BX, Math.min(BX, p.x));
  p.z = Math.max(-BZ, Math.min(BZ, p.z));
  // divider guard: each divider (x = -8 and x = +8) may only be crossed
  // through its doorway gap (|z| < DOOR_HALF). Otherwise block on the side it came from.
  for (const D of [-DIV_X, DIV_X]) {
    const wasLeft = prevX < D;   // true = came from the x<D side
    const nowLeft = p.x < D;
    if (wasLeft !== nowLeft && Math.abs(p.z) > DOOR_HALF) {
      // didn't use the door -> keep on the side it came from
      p.x = wasLeft ? D - 0.4 : D + 0.4;
    }
  }
}

// ---- Per-agent controller ----
function AgentController({
  agent,
  index,
  cubicle,
  onSelect,
}: {
  agent: Agent;
  index: number;
  cubicle: { x: number; z: number };
  onSelect?: (a: Agent) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(cubicle.x, 0, cubicle.z + 1.0));
  const target = useRef({ x: cubicle.x, z: cubicle.z + 1.0 });
  const waypoints = useRef<{ x: number; z: number }[]>([]);
  const wpIndex = useRef(0);
  const mode = useRef<"working" | "idle" | "break">("idle");
  const facing = useRef(0);
  const idleTimer = useRef(0);
  const speed = 1.6 + Math.random() * 0.5;
  const [clickable, setClickable] = useState(false);

  const working = agent.status === "working" || agent.status === "active";
  const offline = agent.status === "offline" || agent.status === "error";

  useEffect(() => {
    if (working) {
      mode.current = "working";
      target.current = { x: cubicle.x, z: cubicle.z + 1.0 };
      waypoints.current = route(pos.current.x, target.current);
      wpIndex.current = 0;
    } else if (offline) {
      mode.current = "break";
      target.current = { x: -10, z: (index % 3) * 2 - 2 };
      waypoints.current = route(pos.current.x, target.current);
      wpIndex.current = 0;
    } else {
      mode.current = "idle";
    }
  }, [working, offline, cubicle.x, cubicle.z, index]);

  useFrame((_, dt) => {
    if (!group.current) return;
    const g = group.current;
    const p = pos.current;
    const moving = mode.current !== "idle" || waypoints.current.length > 0;

    if (mode.current === "idle") {
      idleTimer.current -= dt;
      if (idleTimer.current <= 0) {
        // 35% chance wander into a room via door, else stay in main area
        const goRoom = Math.random() < 0.35;
        const dest = goRoom
          ? (Math.random() < 0.5 ? { x: -10, z: (Math.random() * 8 - 4) } : { x: 10, z: (Math.random() * 8 - 4) })
          : { x: (Math.random() * 13 - 6.5), z: (Math.random() * 13 - 6.5) };
        waypoints.current = route(p.x, dest);
        wpIndex.current = 0;
        idleTimer.current = 4 + Math.random() * 4;
      }
    }

    // move along waypoints
    let walking = false;
    if (wpIndex.current < waypoints.current.length) {
      const wp = waypoints.current[wpIndex.current];
      const dx = wp.x - p.x;
      const dz = wp.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.08) {
        const step = Math.min(speed * dt, dist);
        const nx = p.x + (dx / dist) * step;
        const nz = p.z + (dz / dist) * step;
        const prevX = p.x;
        p.x = nx; p.z = nz;
        clampInside(p, prevX);
        facing.current = Math.atan2(dx, dz);
        walking = true;
      } else {
        wpIndex.current++;
        if (wpIndex.current >= waypoints.current.length) {
          if (mode.current === "working") facing.current = Math.PI;      // face -z desk/monitor
          else if (mode.current === "break") facing.current = -Math.PI / 2; // face -x sofa
        }
      }
    } else if (mode.current === "idle") {
      // arrived; pause then pick new
      idleTimer.current = Math.max(idleTimer.current, 0.6);
    }

    g.position.set(p.x, 0, p.z);
    // smooth facing
    let diff = facing.current - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    g.rotation.y += diff * Math.min(1, dt * 8);

    const typing = mode.current === "working";
    // render the agent via portal-less child
    (g as any).__walking = walking;
    (g as any).__typing = typing;
  });

  const beaconColor = working ? "#22c55e" : offline ? "#64748b" : "#3b82f6";
  return (
    <group ref={group} position={[pos.current.x, 0, pos.current.z]}>
      <Walker color={agent.color} beacon={beaconColor} label={agent.name} onSelect={onSelect ? () => onSelect(agent) : undefined} />
    </group>
  );
}

// separate component so useFrame for limbs is local
function Walker({
  color, beacon, label, onSelect,
}: {
  color: string; beacon: string; label: string; onSelect?: () => void;
}) {
  const walkingRef = useRef(false);
  const typingRef = useRef(false);
  const fig = useRef<THREE.Group>(null);
  useFrame(() => {
    // read flags set by controller on parent group
    const parent = fig.current?.parent as any;
    walkingRef.current = parent?.__walking ?? false;
    typingRef.current = parent?.__typing ?? false;
  });
  return (
    <group
      ref={fig}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
    >
      <MinecraftAgent color={color} walking={walkingRef.current} typing={typingRef.current} beacon={beacon} label={label} />
      <Beacon color={beacon} />
      <Label text={label} color="#0f172a" />
    </group>
  );
}

function OfficeScene({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect?: (a: Agent) => void;
}) {
  const cols = [-6, -2, 2, 6];
  const rows = [-4, 4];
  const cubicles = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    let i = 0;
    for (const cz of rows) for (const cx of cols) { out.push({ x: cx, z: cz }); i++; }
    return out;
  }, []);

  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#ffffff", "#b08968", 0.5]} />
      <Building />
      {cubicles.map((c, i) => (
        <Cubicle key={i} x={c.x} z={c.z} color={agents[i]?.color ?? "#64748b"} />
      ))}
      {agents.map((a, i) => (
        <AgentController key={a.id} agent={a} index={i} cubicle={cubicles[i % cubicles.length]} onSelect={onSelect} />
      ))}
      <Label text="BREAK ROOM" y={2.6} color="#e2e8f0" />
      <Label text="WAR ROOM" y={2.6} color="#e2e8f0" />
    </>
  );
}

export default function AgentsOffice({ agents, onSelect }: { agents: Agent[]; onSelect?: (a: Agent) => void }) {
  return (
    <ErrorBoundary fallback={<div style={{ padding: 24, color: "#f87171" }}>3D office failed to load. Check WebGL / browser support.</div>}>
      <Canvas
        shadows
        camera={{ position: [0, 14, 22], fov: 50 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#0a0d14"]} />
        <Suspense fallback={null}>
          <OfficeScene agents={agents} onSelect={onSelect} />
        </Suspense>
        <OrbitControls
          target={[0, 1, 0]}
          enablePan
          minDistance={8}
          maxDistance={48}
          maxPolarAngle={1.45}
        />
      </Canvas>
    </ErrorBoundary>
  );
}
