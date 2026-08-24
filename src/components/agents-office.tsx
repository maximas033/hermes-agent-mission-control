"use client";

import { Suspense, useMemo } from "react";
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
  status: "idle" | "working" | "error" | "offline";
  tasksCompleted?: number;
  color: string;
}

// ---- A simple, cheap agent figure: capsule body + sphere head ----
// We build it from primitive geometries so there are zero external model
// assets to download (keeps the build offline / free of asset hosting).
function AgentFigure({
  status,
  color,
  name,
}: {
  status: string;
  color: string;
  name: string;
}) {
  const group = useMemo(() => new THREE.Group(), []);
  const headPos = 0.95;
  const bodyPos = 0.45;

  // Animate: working = subtle vertical bounce + arm swing; idle/break = static
  useFrame((state) => {
    if (status === "working") {
      const t = state.clock.elapsedTime;
      group.position.y = Math.sin(t * 4) * 0.03; // idle bounce while "working"
    } else {
      group.position.y = 0;
    }
  });

  return (
    <group ref={group}>
      {/* Head */}
      <mesh position={[0, headPos, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Body (capsule-ish: cylinder + sphere base) */}
      <mesh position={[0, bodyPos, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.5, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Name tag floating above head */}
      <Text
        position={[0, headPos + 0.42, 0]}
        fontSize={0.16}
        color="#e5e7eb"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
      {/* Status glow */}
      <pointLight
        position={[0, bodyPos, 0]}
        color={status === "working" ? "#38bdf8" : status === "idle" ? "#f59e0b" : "#ef4444"}
        intensity={status === "working" ? 0.6 : 0.3}
        distance={1.2}
      />
    </group>
  );
}

// ---- Floor + simple office layout ----
function OfficeScene({ agents }: { agents: Agent[] }) {
  const { viewport } = useThree();
  const aspect = viewport.width / viewport.height;

  // Work pods arranged in an arc; break room at center-bottom
  const radius = 4.2;
  const workPositions = useMemo(() => {
    return agents
      .filter((a) => a.status === "working" || a.status === "idle")
      .map((a, i) => {
        // working agents sit in pod circle, idle agents in break room
        const onBreak = a.status === "idle";
        const angle = onBreak
          ? 0 // break room area (center-bottom)
          : ((i - 1.5) * 0.6) - Math.PI / 2; // work arc around left side
        const r = onBreak ? 0 : radius;
        return {
          x: Math.cos(angle) * r,
          z: Math.sin(angle) * r - (onBreak ? -radius + 0.5 : 0),
        };
      });
  }, [agents]);

  return (
    <>
      {/* Soft environment lighting */}
      <ambientLight intensity={0.6} color="#94a3b8" />
      <directionalLight
        position={[5, 10, 7]}
        intensity={0.8}
        color="#ffffff"
        castShadow
      />

      {/* Floor — dark with grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color="#0d1117"
          opacity={0.95}
          transparent
          roughness={0.8}
        />
      </mesh>
      {/* Grid lines (subtle) */}
      <gridHelper args={[20, 20, "#1e293b", "#1e293b", "#1e293b"] as any} position={[0, -0.005, 0]} />

      {/* Office walls (dark) */}
      <mesh position={[0, 2.5, -6]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial
          color="#0a0a0e"
          opacity={0.7}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Work pods — small transparent domes */}
      {[...Array(8)].map((_, i) => {
        const angle = ((i - 3.5) * 0.5);
        return (
          <mesh
            key={i}
            position={[
              Math.cos(angle) * (radius + 0.5),
              0.6,
              Math.sin(angle) * (radius + 0.5) - 0.3,
            ]}
            rotation={[0, -angle, 0]}
          >
            <cylinderGeometry args={[0.55, 0.55, 1.2, 32]} />
            <meshStandardMaterial
              color="#273449"
              opacity={0.18}
              transparent
              emissive="#0ea5e9"
              emissiveIntensity={0.08}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {/* Break room — a lounge area (table + chairs) at center-front */}
      <group position={[0, 0.2, -radius + 1.3]}>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.7, 0.7, 0.4, 32]} />
          <meshStandardMaterial color="#22304a" />
        </mesh>
        {[0, 90, 180, 270].map((rot, i) => {
          const r = (rot * Math.PI) / 180;
          return (
            <mesh key={i} position={[Math.cos(r) * 0.95, 0.2, Math.sin(r) * 0.95]} rotation={[0, r, 0 as any]}>
              <cylinderGeometry args={[0.16, 0.16, 0.6, 12]} />
              <meshStandardMaterial color="#38bdf8" opacity={0.6} transparent />
            </mesh>
          );
        })}
        <Text
          position={[0, 0.8, 0]}
          fontSize={0.28}
          color="#0ea5e9"
          anchorX="center"
          anchorY="middle"
        >
          BREAK ROOM
        </Text>
      </group>

      {/* Agent figures */}
      {agents.map((agent, i) => {
        const pos = workPositions[i] || { x: 0, z: 0 };
        return (
          <group key={agent.id} position={[pos.x, 0, pos.z]}>
            <AgentFigure status={agent.status} color={agent.color} name={agent.name} />
          </group>
        );
      })}

      {/* Camera frame for pan/zoom */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minPolarAngle={Math.PI / 2.4}
        maxPolarAngle={Math.PI / 2}
        maxDistance={10}
        minDistance={4}
      />
    </>
  );
}

// ---- Main export ----
export default function AgentsOffice({ agents }: { agents: Agent[] }) {
  return (
    <div className="relative h-[700px] w-full rounded-xl border border-slate-700/50 bg-slate-900/60">
      <Canvas
        camera={{ position: [0, 2.2, 6.5], fov: 50 }}
        shadows
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#0a0a0e"]} />
        <Suspense fallback={null}>
          <OfficeScene agents={agents} />
        </Suspense>
        <Environment preset="night" />
      </Canvas>
    </div>
  );
}

export type { Agent };