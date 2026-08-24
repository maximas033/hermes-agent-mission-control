"use client";

import { Suspense, useMemo, useRef, Component } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// ---- Error boundary so scene failures show a message instead of black void ----
class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline" | "online" | "active";
  tasksCompleted?: number;
  color: string;
}

// ---- Local text texture (zero network — replaces drei <Text> which needed fonts/HDR CDNs) ----
function makeLabelTexture(text: string, fg = "#e5e7eb", bg = "rgba(0,0,0,0)") {
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
    ctx.beginPath();
    const r = 18;
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.fill();
  }
  ctx.font = "600 64px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 8;
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function Label({
  text,
  color = "#e5e7eb",
  position,
  worldWidth = 1.6,
}: {
  text: string;
  color?: string;
  position: [number, number, number];
  worldWidth?: number;
}) {
  const tex = useMemo(() => makeLabelTexture(text, color), [text, color]);
  const aspect = 512 / 128;
  return (
    <sprite position={position} scale={[worldWidth, worldWidth / aspect, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// ---- Status ring under working agents ----
function StatusRing({ color, active }: { color: string; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const s = active ? 1 + Math.sin(t * 3) * 0.08 : 1;
    ref.current.scale.set(s, s, 1);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = active
      ? 0.25 + Math.sin(t * 3) * 0.1
      : 0.12;
  });
  return (
    <mesh ref={ref} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.42, 0.52, 40]} />
      <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ---- Agent figure: capsule torso, head with visor, arms, legs ----
function AgentFigure({
  status,
  color,
  name,
}: {
  status: string;
  color: string;
  name: string;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);

  const isWorking = status === "working" || status === "active" || status === "online";
  const isIdle = status === "idle";

  useFrame((state) => {
    if (!group.current || !bodyRef.current) return;
    const t = state.clock.elapsedTime;
    if (isWorking) {
      // typing motion: slight lean forward + bob
      group.current.position.y = Math.abs(Math.sin(t * 4)) * 0.02;
      bodyRef.current.rotation.x = 0.12 + Math.sin(t * 8) * 0.02;
    } else if (isIdle) {
      // relaxed breathing
      group.current.position.y = Math.sin(t * 1.4) * 0.008;
      bodyRef.current.rotation.x = 0;
    } else {
      group.current.position.y = 0;
      bodyRef.current.rotation.x = 0;
    }
  });

  const glowColor = isWorking ? "#34d399" : isIdle ? "#fbbf24" : "#64748b";
  const bodyMat = <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.2} />;
  const accentMat = <meshStandardMaterial color={color} roughness={0.35} metalness={0.45} emissive={color} emissiveIntensity={0.25} />;

  return (
    <group ref={group}>
      <group ref={bodyRef}>
        {/* Torso */}
        <mesh position={[0, 0.62, 0]} castShadow>
          <capsuleGeometry args={[0.16, 0.28, 6, 14]} />
          {accentMat}
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.06, 0]} castShadow>
          <sphereGeometry args={[0.17, 20, 20]} />
          <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.55} />
        </mesh>
        {/* Visor — glowing face */}
        <mesh position={[0, 1.07, 0.135]} rotation={[0.15, 0, 0]}>
          <sphereGeometry args={[0.115, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        {/* Arms */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.22, 0.62, isWorking ? 0.1 : 0]} rotation={[isWorking ? -0.9 : 0.15, 0, side * 0.12]} castShadow>
            <capsuleGeometry args={[0.05, 0.26, 4, 10]} />
            {bodyMat}
          </mesh>
        ))}
      </group>
      {/* Legs */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.09, 0.19, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.22, 4, 10]} />
          {bodyMat}
        </mesh>
      ))}
      {/* Status light on chest */}
      <mesh position={[0, 0.72, 0.155]}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <StatusRing color={glowColor} active={isWorking} />
      <Label text={name} color="#f1f5f9" position={[0, 1.55, 0]} worldWidth={1.35} />
      <pointLight position={[0, 0.8, 0.4]} color={glowColor} intensity={isWorking ? 0.5 : 0.2} distance={1.8} decay={2} />
    </group>
  );
}

// ---- Desk with chair, monitor, keyboard ----
function Workstation({ angle, radius }: { angle: number; radius: number }) {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const facing = angle + Math.PI / 2; // face center
  return (
    <group position={[x, 0, z]} rotation={[0, -angle - Math.PI, 0]}>
      {/* Desk top */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.05, 0.7]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.35} />
      </mesh>
      {/* Desk legs */}
      {[[-0.65, -0.28], [0.65, -0.28], [-0.65, 0.28], [0.65, 0.28]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.36, lz]} castShadow>
          <boxGeometry args={[0.06, 0.72, 0.06]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 1.05, -0.24]} castShadow>
        <boxGeometry args={[0.72, 0.44, 0.03]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0, 1.05, -0.222]}>
        <planeGeometry args={[0.66, 0.38]} />
        <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.85} toneMapped={false} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.78, -0.24]}>
        <cylinderGeometry args={[0.03, 0.05, 0.1, 10]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 0.755, 0.12]} rotation={[0.06, 0, 0]}>
        <boxGeometry args={[0.42, 0.02, 0.14]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      {/* Chair */}
      <group position={[0, 0, 0.55]}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.42, 0.06, 0.42]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.68, 0.18]} castShadow>
          <boxGeometry args={[0.4, 0.46, 0.06]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.21, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.42, 10]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* chair base */}
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.16, 0.03, Math.sin(a) * 0.16]} rotation={[0, -a, 0]}>
              <boxGeometry args={[0.22, 0.03, 0.05]} />
              <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

// ---- Procedural floor texture (grid, local) ----
function useFloorTexture() {
  return useMemo(() => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    // base
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#10151f");
    grad.addColorStop(1, "#0b0f16");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // large tiles
    ctx.strokeStyle = "rgba(56,80,120,0.35)";
    ctx.lineWidth = 3;
    const tiles = 8;
    const step = size / tiles;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step); ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    // fine grid
    ctx.strokeStyle = "rgba(56,80,120,0.14)";
    ctx.lineWidth = 1;
    const fine = size / 32;
    for (let i = 0; i <= 32; i++) {
      ctx.beginPath();
      ctx.moveTo(i * fine, 0); ctx.lineTo(i * fine, size);
      ctx.moveTo(0, i * fine); ctx.lineTo(size, i * fine);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.anisotropy = 8;
    return tex;
  }, []);
}

// ---- Main scene ----
function OfficeScene({ agents }: { agents: Agent[] }) {
  const FLOOR = 22;
  const WORK_RADIUS = 5.2;
  const floorTex = useFloorTexture();

  const workingAgents = agents.filter(
    (a) => a.status === "working" || a.status === "active" || a.status === "online"
  );

  // seat working agents at desks around half-circle facing center
  const deskSlots = useMemo(() => {
    const n = Math.max(workingAgents.length, 1);
    return workingAgents.map((a, i) => {
      const spread = Math.min(Math.PI * 0.9, (n / 8) * Math.PI * 0.9);
      const angle = -Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1)) * spread - spread / 2);
      return { agent: a, angle };
    });
  }, [workingAgents]);

  const idleAgents = agents.filter((a) => !deskSlots.some((d) => d.agent.id === a.id));

  return (
    <>
      {/* Lighting rig — no HDR env needed */}
      <ambientLight intensity={0.5} color="#8fa3bf" />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.15}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={45}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight position={[-8, 4, 6]} intensity={18} color="#0ea5e9" distance={20} decay={2} />
      <pointLight position={[8, 4, -6]} intensity={14} color="#a855f7" distance={20} decay={2} />
      <pointLight position={[0, 3.2, 0]} intensity={10} color="#fbbf24" distance={12} decay={2} />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR, FLOOR]} />
        <meshStandardMaterial map={floorTex} roughness={0.85} metalness={0.15} />
      </mesh>

      {/* Walls */}
      <Wall position={[0, 3, -FLOOR / 2]} width={FLOOR} />
      <Wall position={[-FLOOR / 2, 3, 0]} width={FLOOR} rotY={Math.PI / 2} />
      <Wall position={[FLOOR / 2, 3, 0]} width={FLOOR} rotY={-Math.PI / 2} />

      {/* Ceiling light strips */}
      {[-6, -2, 2, 6].map((x) => (
        <mesh key={x} position={[x, 5.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.5, FLOOR * 0.7]} />
          <meshStandardMaterial color="#dbeafe" emissive="#e0f2fe" emissiveIntensity={1.4} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {[-8, -4, 4, 8].map((x) => (
        <pointLight key={`cl-${x}`} position={[x, 5.5, 0]} intensity={22} color="#cfe8ff" distance={16} decay={2} />
      ))}

      {/* Workstations ring */}
      {[...Array(8)].map((_, i) => {
        const angle = -Math.PI / 2 + (i / 8) * Math.PI * 1.75 + Math.PI * 0.12;
        return <Workstation key={i} angle={angle} radius={WORK_RADIUS} />;
      })}

      {/* Working agents at desks */}
      {deskSlots.map(({ agent, angle }) => (
        <group
          key={agent.id}
          position={[
            Math.cos(angle) * WORK_RADIUS,
            0,
            Math.sin(angle) * WORK_RADIUS,
          ]}
          rotation={[0, -angle - Math.PI, 0]}
        >
          {/* sit slightly toward chair, behind desk facing monitor */}
          <group position={[0, 0, 0.62]}>
            <AgentFigure status={agent.status} color={agent.color} name={agent.name} />
          </group>
        </group>
      ))}

      {/* BREAK ROOM — corner lounge with rug, sofa, table */}
      <group position={[FLOOR / 2 - 4.2, 0, FLOOR / 2 - 4.2]}>
        {/* rug */}
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[2.6, 48]} />
          <meshStandardMaterial color="#1e2a45" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.35, 2.5, 48]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.5} toneMapped={false} />
        </mesh>
        {/* L-sofa */}
        <group position={[-0.6, 0, -0.9]}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.6, 0.5, 0.95]} />
            <meshStandardMaterial color="#273349" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.62, -0.42]} castShadow>
            <boxGeometry args={[2.6, 0.65, 0.22]} />
            <meshStandardMaterial color="#2d3b54" roughness={0.9} />
          </mesh>
        </group>
        <group position={[1.35, 0, 0.5]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.2, 0.5, 0.95]} />
            <meshStandardMaterial color="#273349" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.62, -0.42]} castShadow>
            <boxGeometry args={[2.2, 0.65, 0.22]} />
            <meshStandardMaterial color="#2d3b54" roughness={0.9} />
          </mesh>
        </group>
        {/* coffee table */}
        <mesh position={[0.1, 0.32, 0.35]} castShadow receiveShadow>
          <cylinderGeometry args={[0.55, 0.55, 0.06, 28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.55} />
        </mesh>
        <mesh position={[0.1, 0.16, 0.35]}>
          <cylinderGeometry args={[0.08, 0.12, 0.3, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* water cooler */}
        <group position={[-2.2, 0, 1.6]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.4, 1.1, 0.4]} />
            <meshStandardMaterial color="#334155" roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.22, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.16, 0.35, 16]} />
            <meshStandardMaterial color="#7dd3fc" transparent opacity={0.75} roughness={0.2} />
          </mesh>
        </group>
        {/* plant */}
        <group position={[2.3, 0, -1.9]}>
          <mesh position={[0, 0.22, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.16, 0.44, 14]} />
            <meshStandardMaterial color="#7c4a21" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.75, 0]} castShadow>
            <icosahedronGeometry args={[0.42, 1]} />
            <meshStandardMaterial color="#2f9e57" roughness={0.9} flatShading />
          </mesh>
        </group>
        <Label text="☕ BREAK ROOM" color="#7dd3fc" position={[0, 1.7, 1.9]} worldWidth={2.4} />
      </group>

      {/* Idle/offline agents in break room */}
      {idleAgents.map((agent, i) => {
        const seats: [number, number, number][] = [
          [-1.5, 0.42, -0.35],
          [-0.4, 0.42, -0.35],
          [1.15, 0.42, 1.15],
          [1.15, 0.42, 0.05],
        ];
        const s = seats[i % seats.length];
        const baseX = FLOOR / 2 - 4.2;
        const baseZ = FLOOR / 2 - 4.2;
        return (
          <group key={agent.id} position={[baseX + s[0], s[1] - 0.36, baseZ + s[2]]}>
            <AgentFigure status={agent.status} color={agent.color} name={agent.name} />
          </group>
        );
      })}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        target={[0, 0.6, 0]}
        rotateSpeed={0.55}
        zoomSpeed={0.9}
        panSpeed={0.8}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2.05}
        maxDistance={18}
        minDistance={4}
      />
    </>
  );
}

function Wall({ position, width, rotY = 0 }: { position: [number, number, number]; width: number; rotY?: number }) {
  const wallTex = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#131a26";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(70,100,150,0.25)";
    ctx.lineWidth = 4;
    for (let y = 0; y <= 4; y++) {
      ctx.beginPath();
      ctx.moveTo(0, (size / 4) * y);
      ctx.lineTo(size, (size / 4) * y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(70,100,150,0.12)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= 8; x++) {
      ctx.beginPath();
      ctx.moveTo((size / 8) * x, 0);
      ctx.lineTo((size / 8) * x, size);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 1);
    return tex;
  }, []);

  return (
    <mesh position={position} rotation={[0, rotY, 0]} receiveShadow>
      <planeGeometry args={[width, 6]} />
      <meshStandardMaterial map={wallTex} roughness={0.9} metalness={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function AgentsOffice({ agents }: { agents: Agent[] }) {
  return (
    <div className="relative h-[720px] w-full overflow-hidden rounded-2xl border border-slate-700/50 bg-[#06080d]">
      <Canvas
        camera={{ position: [0, 4.2, 11.5], fov: 50 }}
        shadows
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#06080d"]} />
        <fog attach="fog" args={["#06080d", 18, 34]} />
        <ErrorBoundary fallback={
          <div className="flex h-full items-center justify-center text-slate-400">
            3D scene failed to load — check browser console.
          </div>
        }>
          <Suspense fallback={
            <Html center>
              <div className="rounded-full bg-black/60 px-4 py-2 text-xs text-slate-300">Loading office…</div>
            </Html>
          }>
            <OfficeScene agents={agents} />
          </Suspense>
        </ErrorBoundary>
      </Canvas>
      {/* HUD hint */}
      <div className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-black/50 px-3 py-1 text-[11px] text-slate-300 backdrop-blur">
        drag to orbit · scroll to zoom · right-drag to pan
      </div>
    </div>
  );
}

export type { Agent };
