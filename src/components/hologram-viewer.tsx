"use client";

/* ───────────────────────────────────────────────────────────
   Hermy HQ · Holographic 3D Print Viewer (R3F)
   Renders a parametric JSON geometry spec as a glowing wireframe +
   faint translucent solid. OrbitControls for pan/zoom/rotate, auto
   spin, and a starfield + grid floor for the hologram look.

   IMPORTANT: this module imports three / @react-three/fiber / drei.
   It MUST be loaded via `dynamic(() => import(...), { ssr: false })`
   from the page (see src/app/3d-print/page.tsx) to avoid SSR crashes.
   ─────────────────────────────────────────────────────────── */

import { Suspense, useRef, Component, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, AdaptiveDpr, Stars, Grid } from "@react-three/drei";
import * as THREE from "three";

// ── Geometry spec types ───────────────────────────────────────
type Vec3 = [number, number, number];

export interface PartSpec {
  shape?: string;
  type?: string;
  size?: number[];
  pos?: number[];
  rot?: number[];
  color?: string;
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  height?: number;
  tube?: number;
  segments?: number;
  parts?: PartSpec[];
}

// ── Error boundary so a scene failure shows a message, not a void ──
class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ── Build a drei geometry element for a given shape ─────────────
function buildGeometry(shape: string, part: PartSpec): ReactNode {
  const size = part.size || [];
  const seg = part.segments || 48;
  switch (shape) {
    case "cylinder": {
      const rTop = part.radiusTop ?? part.radius ?? (size[0] ?? 1);
      const rBot = part.radiusBottom ?? part.radius ?? (size[1] ?? rTop);
      const h = part.height ?? (size[2] ?? 2);
      return <cylinderGeometry args={[rTop, rBot, h, seg]} />;
    }
    case "sphere": {
      const r = part.radius ?? size[0] ?? 1;
      return <sphereGeometry args={[r, seg, seg]} />;
    }
    case "torus": {
      const r = part.radius ?? size[0] ?? 1;
      const t = part.tube ?? size[1] ?? 0.35;
      return <torusGeometry args={[r, t, Math.min(24, seg), seg]} />;
    }
    case "cone": {
      const r = part.radius ?? size[0] ?? 1;
      const h = part.height ?? size[1] ?? 2;
      return <coneGeometry args={[r, h, seg]} />;
    }
    case "box":
    default: {
      const w = size[0] ?? 1;
      const h = size[1] ?? 1;
      const d = size[2] ?? 1;
      return <boxGeometry args={[w, h, d]} />;
    }
  }
}

// ── A single primitive (solid + wireframe overlay) ─────────────
function Primitive({ part, accent }: { part: PartSpec; accent: string }) {
  // Composite: render child parts in a group.
  if (part.parts && part.parts.length > 0) {
    return (
      <group>
        {part.parts.map((p, i) => (
          <Primitive key={i} part={p} accent={accent} />
        ))}
      </group>
    );
  }

  const shape = (part.shape || part.type || "box").toLowerCase();
  const color = part.color || accent;
  const pos = (part.pos || [0, 0, 0]) as Vec3;
  const rot = (part.rot || [0, 0, 0]) as Vec3;

  return (
    <group position={pos} rotation={rot}>
      {/* faint translucent solid */}
      <mesh>
        {buildGeometry(shape, part)}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.55}
          transparent
          opacity={0.32}
          metalness={0.1}
          roughness={0.35}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {/* glowing wireframe overlay */}
      <mesh>
        {buildGeometry(shape, part)}
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.9}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ── Spinning group (auto-rotate the model) ─────────────────────
function SpinGroup({ children, spin }: { children: ReactNode; spin: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin && ref.current) ref.current.rotation.y += dt * 0.4;
  });
  return <group ref={ref}>{children}</group>;
}

// ── The holographic scene ──────────────────────────────────────
function HoloScene({ spec, accent, spin }: { spec: PartSpec; accent: string; spin: boolean }) {
  return (
    <>
      <color attach="background" args={["#070b12"]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[6, 9, 6]} intensity={1.1} color={accent} />
      <pointLight position={[-6, -4, -6]} intensity={0.5} color={"#22D3EE"} />

      <Suspense fallback={null}>
        <Stars radius={60} depth={30} count={900} factor={3.5} saturation={0} fade speed={0.6} />
        <SpinGroup spin={spin}>
          <Primitive part={spec} accent={accent} />
        </SpinGroup>
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.6}
          cellColor={accent}
          sectionSize={5}
          sectionThickness={1}
          sectionColor={accent}
          fadeDistance={32}
          fadeStrength={1.5}
          infiniteGrid
          position={[0, -2.2, 0]}
        />
      </Suspense>

      <OrbitControls
        enablePan
        enableZoom
        autoRotate={false}
        minDistance={3}
        maxDistance={40}
        makeDefault
      />
      <AdaptiveDpr pixelated />
    </>
  );
}

export interface HologramViewerProps {
  geometry: string; // JSON spec
  accentColor?: string;
  spin?: boolean;
  className?: string;
}

export default function HologramViewer({
  geometry,
  accentColor = "#22D3EE",
  spin = true,
  className = "",
}: HologramViewerProps) {
  let spec: PartSpec;
  try {
    spec = JSON.parse(geometry);
  } catch {
    spec = { shape: "box", size: [1, 1, 1] };
  }
  // Normalize: a composite may carry top-level pos/rot/color.
  if (!spec.shape && !spec.type && !spec.parts) {
    spec = { shape: "box", size: [1, 1, 1] };
  }

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", background: "#070b12", borderRadius: "var(--r-lg, 14px)", overflow: "hidden" }}
    >
      <ErrorBoundary
        fallback={
          <div style={{ padding: 24, color: "#f87171", fontSize: 13 }}>
            Holographic model failed to render. Check the geometry spec.
          </div>
        }
      >
        <Canvas
          camera={{ position: [4, 3, 6], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
          style={{ width: "100%", height: "100%" }}
        >
          <HoloScene spec={spec} accent={accentColor} spin={spin} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
