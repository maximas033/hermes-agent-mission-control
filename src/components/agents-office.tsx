"use client";

import { Suspense, useMemo, useRef } from "react";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Text,
} from "@react-three/drei";
import * as THREE from "three";

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline" | "online" | "active";
  tasksCompleted?: number;
  color: string;
}

// ---- Generate a small colored texture on the fly (no external assets) ----
function useTintTexture(hex: string) {
  return useMemo(() => {
    const c = new THREE.Color(hex);
    const buf = new Uint8Array([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255]);
    const tex = new THREE.DataTexture(buf, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, [hex]);
}

// ---- A nicer agent figure: rounded torso + colored head + name badge ----
function AgentFigure({
  status,
  color,
  name,
  emoji,
}: {
  status: string;
  color: string;
  name: string;
  emoji: string;
}) {
  const group = useRef<THREE.Group>(null);
  const tintTex = useTintTexture(color);

  // Animations: working = gentle walk-step + arm swing; idle = breathing; offline = dormant
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    if (status === "working") {
      group.current.position.y = Math.abs(Math.sin(t * 5)) * 0.02; // step bounce
      const arm = Math.sin(t * 6) * 0.04;
      // arms swing via children rotation if we had bones; we tilt the torso slightly
      group.current.rotation.z = Math.sin(t * 5) * 0.02;
    } else if (status === "idle") {
      group.current.position.y = Math.sin(t * 1.3) * 0.01; // slow breathing
      group.current.rotation.z = 0;
    } else {
      group.current.position.y = 0; // offline/error: still
      group.current.rotation.z = 0;
    }
  });

  return (
    <group ref={group}>
      {/* Torso — rounded capsule (cylinder + sphere cap) */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.16, 0.5, 12]} />
        <meshStandardMaterial map={tintTex} />
      </mesh>
      {/* Hip base */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.25, 12]} />
        <meshStandardMaterial map={tintTex} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.82, 0]} castShadow>
        <sphereGeometry args={[0.24, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} />
      </mesh>
      {/* Ears (small cylinders) to give profile */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.23, 0.82, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 0.33, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      {/* Name badge floating above head */}
      <Text
        position={[0, 0.82 + 0.48, 0]}
        fontSize={0.15}
        color="#e5e7eb"
        anchorX="center"
        anchorY="middle"
        font="/fonts/Inter-SemiBold.woff"
      >
        {name}
      </Text>
      {/* Status glow */}
      <pointLight
        position={[0, 0.45, 0]}
        color={status === "working" ? color : status === "idle" ? "#f59e0b" : "#ef4444"}
        intensity={status === "working" ? 0.7 : 0.35}
        distance={1.6}
        decay={2}
      />
      {/* Subtle hover halo for working */}
      {status === "working" && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.55, 32]} />
          <meshBasicMaterial color={color} opacity={0.35} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

// ---- The office: floor, walls, ceiling windows, desks, break room ----
function OfficeScene({ agents }: { agents: Agent[] }) {
  const { viewport } = useThree();

  // Floor material with a subtle grid texture (procedural, no asset)
  const floorTex = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(30,41,59,0.25)";
    ctx.lineWidth = 2;
    const step = size / 20;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step); ctx.lineTo(size, i * step);
    }
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
  }, []);

  // Wall texture (slightly grainy metal panel)
  const wallTex = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0a0a0e";
    ctx.fillRect(0, 0, size, size);
    // subtle panel lines
    ctx.strokeStyle = "rgba(10,20,45,0.5)";
    ctx.lineWidth = 3;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (size / 8) * i); ctx.lineTo(size, (size / 8) * i);
    }
    ctx.stroke();
    // noise
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const v = Math.random() * 30 + 20;
      ctx.fillStyle = `rgba(255,255,255,${v / 2550})`;
      ctx.fillRect(x, y, 1, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }, []);

  // Layout constants
  const WORK_RADIUS = 4.6;
  const FLOOR_SIZE = 20;

  // Place working agents at desks; idle/offline in break room (center-front)
  const positions = useMemo(() => {
    const out: { x: number; z: number; desk: boolean }[] = [];
    let deskIdx = 0;
    let breakIdx = 0;
    agents.forEach((a) => {
      if (a.status === "working" || a.status === "active" || a.status === "online") {
        const angle = (deskIdx / 8) * Math.PI - Math.PI / 2; // half-circle front
        out.push({
          x: Math.cos(angle) * WORK_RADIUS,
          z: Math.sin(angle) * WORK_RADIUS,
          desk: true,
        });
        deskIdx++;
      } else {
        // break room cluster near center
        const bAngle = (breakIdx / 3) * 0.8 - 0.4;
        out.push({
          x: Math.cos(bAngle) * (1.1 + breakIdx * 0.6),
          z: -(WORK_RADIUS - 2.4) + Math.sin(bAngle) * 0.3,
          desk: false,
        });
        breakIdx++;
      }
    });
    return out;
  }, [agents, WORK_RADIUS]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.55} color="#94a3b8" />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.1}
        color="#ffffff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={40}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      {/* Rim / fill lights for cinematic feel */}
      <pointLight position={[-5, 3, 5]} intensity={0.35} color="#0ea5e9" />
      <pointLight position={[5, 3, -5]} intensity={0.3} color="#a8b5dc" />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
        <meshStandardMaterial map={floorTex} />
      </mesh>

      {/* Back wall + two side walls + ceiling */}
      <mesh position={[0, 5, -9.9]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE, 10]} />
        <meshStandardMaterial map={wallTex} opacity={0.92} transparent />
      </mesh>
      <mesh position={[-9.9, 5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE, 10]} />
        <meshStandardMaterial map={wallTex} opacity={0.88} transparent />
      </mesh>
      <mesh position={[9.9, 5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE, 10]} />
        <meshStandardMaterial map={wallTex} opacity={0.88} transparent />
      </mesh>
      {/* Ceiling */}
      <mesh position={[0, 9.95, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
        <meshStandardMaterial color="#0a0a0e" />
      </mesh>
      {/* Ceiling windows — glowing strips */}
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * 5, 9.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.6, 0.3]} />
          <meshBasicMaterial color="#0ea5e9" opacity={0.55} transparent />
        </mesh>
      ))}

      {/* Work desks — 8 pods with monitor screens */}
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * WORK_RADIUS;
        const z = Math.sin(angle) * WORK_RADIUS;
        return (
          <group key={i} position={[x, 0, z]}>
            {/* desk */}
            <mesh position={[0, 0.4, 0]} receiveShadow castShadow>
              <boxGeometry args={[1.4, 0.7, 0.5]} />
              <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.3} />
            </mesh>
            {/* monitor stand */}
            <mesh position={[0, 0.95, -0.18]} castShadow>
              <boxGeometry args={[0.7, 0.1, 0.1]} />
              <meshStandardMaterial color="#334159" />
            </mesh>
            {/* monitor screen — emissive glow */}
            <mesh position={[0, 0.95, -0.13]}>
              <planeGeometry args={[0.6, 0.36]} />
              <meshBasicMaterial color="#3b82f6" opacity={0.5} transparent />
            </mesh>
          </group>
        );
      })}

      {/* Break room — lounge sofa + small table */}
      <group position={[0, 0, 0]}>
        {/* sofa (3 seats) */}
        <mesh position={[0, 0.35, -FLOOR_SIZE / 2 + 2.8]} receiveShadow castShadow>
          <boxGeometry args={[2.8, 0.4, 0.9]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <mesh position={[0, 0.65, -FLOOR_SIZE / 2 + 2.8]} receiveShadow castShadow>
          <boxGeometry args={[2.8, 0.4, 0.9]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        {/* seat cushions (2 visible) */}
        {[-0.7, 0.7].map((sx) => (
          <mesh key={sx} position={[sx, 0.45, -FLOOR_SIZE / 2 + 2.8 + 0.05]} receiveShadow>
            <boxGeometry args={[0.6, 0.13, 0.8]} />
            <meshStandardMaterial color="#0ea5e9" opacity={0.4} transparent />
          </mesh>
        ))}
        {/* coffee table */}
        <mesh position={[0, 0.45, -FLOOR_SIZE / 2 + 4.0]} receiveShadow castShadow>
          <boxGeometry args={[1.2, 0.3, 0.6]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        <Text
          position={[0, 0.9, -FLOOR_SIZE / 2 + 4.0]}
          fontSize={0.26}
          color="#0ea5e9"
          anchorX="center"
          anchorY="middle"
        >
          BREAK ROOM
        </Text>
      </group>

      {/* Agent figures at their positions */}
      {agents.map((agent, i) => {
        const pos = positions[i] || { x: 0, z: 0, desk: false };
        const y = pos.desk ? 0.5 : 0.0; // on desk vs floor
        return (
          <group key={agent.id} position={[pos.x, y, pos.z]}>
            <AgentFigure
              status={agent.status}
              color={agent.color}
              name={agent.name}
              emoji={agent.emoji}
            />
          </group>
        );
      })}

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        rotateSpeed={0.5}
        zoomSpeed={0.9}
        minPolarAngle={Math.PI / 2.6}
        maxPolarAngle={Math.PI / 2}
        maxDistance={14}
        minDistance={5}
      />
    </>
  );
}

export default function AgentsOffice({ agents }: { agents: Agent[] }) {
  return (
    <div className="relative h-[720px] w-full rounded-2xl border border-slate-700/50 bg-slate-900/60 overflow-hidden">
      <Canvas
        camera={{ position: [0, 2.6, 8.5], fov: 48 }}
        shadows
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#06080d"]} />
        <Suspense fallback={null}>
          <OfficeScene agents={agents} />
        </Suspense>
        <Environment preset="night" />
      </Canvas>
    </div>
  );
}

export type { Agent };
