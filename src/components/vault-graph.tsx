"use client";

/**
 * VaultGraph — immersive 3D graph of Max's Obsidian vault.
 *
 * React Three Fiber + three r185. Deterministic cluster layout (folder = cluster,
 * fibonacci-sphere seeded) with idle breathing/float animation, glowing node
 * sprites colored by folder, animated light pulses travelling along wikilink
 * edges, hover-dimming of unconnected nodes, click-to-focus camera + inspector.
 *
 * NOTE: intentionally no force-simulation — positions are bounded by construction,
 * so the graph always frames correctly regardless of node count or link sparsity.
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { X, Link2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface VaultNodeDatum {
  id: string;
  title: string;
  folder: string;
  path: string;
  preview: string;
}

export interface VaultEdgeDatum {
  source: string;
  target: string;
}

interface LaidNode extends VaultNodeDatum {
  degree: number;
  bx: number; // base position (cluster layout)
  by: number;
  bz: number;
  phase: number; // idle-motion phase offset
  radius: number;
}

/* ------------------------------------------------------------------ */
/* Palette / helpers                                                   */
/* ------------------------------------------------------------------ */

const FOLDER_COLORS: Record<string, string> = {
  "00-Inbox": "#94a3b8",
  "01-Profile": "#22d3ee",
  "02-Projects": "#c084fc",
  "03-Journal": "#34d399",
  "04-Jarvis-Meta": "#fbbf24",
  "05-Knowledge": "#fb7185",
  "06-Errors": "#f472b6",
  "07-Archive": "#a3a3a3",
  "08-Business": "#4ade80",
};
const FALLBACK = ["#38bdf8", "#a78bfa", "#facc15", "#fb923c", "#2dd4bf", "#e879f9"];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function folderColor(folder: string): string {
  return FOLDER_COLORS[folder] ?? FALLBACK[hashStr(folder) % FALLBACK.length];
}
const prettyFolder = (f: string) => f.replace(/^\d+-/, "");

/** Evenly distributed unit vectors on a sphere. */
function fibSphere(n: number): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  const count = Math.max(1, n);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return pts;
}

let glowTex: THREE.Texture | null = null;
function getGlow(): THREE.Texture {
  if (glowTex) return glowTex;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const labelCache = new Map<string, THREE.Texture>();
const LABEL_FONT = "600 44px ui-sans-serif, system-ui, sans-serif";
function labelTexture(title: string): THREE.Texture {
  const hit = labelCache.get(title);
  if (hit) return hit;
  const text = title.length > 30 ? title.slice(0, 29) + "…" : title;
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = LABEL_FONT;
  const w = Math.ceil(meas.measureText(text).width) + 56;
  const h = 84;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.font = LABEL_FONT;
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "rgba(242,251,255,1)";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 28, h / 2);
  // dark gradient backing (behind text) so labels stay readable over bright glows
  ctx.globalCompositeOperation = "destination-over";
  const grd = ctx.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, "rgba(3,6,12,0)");
  grd.addColorStop(0.07, "rgba(3,6,12,0.6)");
  grd.addColorStop(0.93, "rgba(3,6,12,0.6)");
  grd.addColorStop(1, "rgba(3,6,12,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  (tex as unknown as { userData: { w: number; h: number } }).userData = { w, h };
  labelCache.set(title, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Layout: folder clusters on a sphere of clusters                     */
/* ------------------------------------------------------------------ */

const R_HUB = 22; // folder hubs pushed further apart on the sphere

function buildLayout(nodes: VaultNodeDatum[], edges: VaultEdgeDatum[]) {
  const degreeOf = new Map<string, number>();
  for (const e of edges) {
    degreeOf.set(e.source, (degreeOf.get(e.source) ?? 0) + 1);
    degreeOf.set(e.target, (degreeOf.get(e.target) ?? 0) + 1);
  }

  const byFolder = new Map<string, VaultNodeDatum[]>();
  for (const n of nodes) {
    const arr = byFolder.get(n.folder) ?? [];
    arr.push(n);
    byFolder.set(n.folder, arr);
  }
  const folders = Array.from(byFolder.keys()).sort();
  const hubDirs = fibSphere(folders.length);

  const laid: LaidNode[] = [];
  const posById = new Map<string, LaidNode>();

  folders.forEach((folder, fi) => {
    const dir = hubDirs[fi];
    const hx = dir.x * R_HUB;
    const hy = dir.y * R_HUB;
    const hz = dir.z * R_HUB;

    const kids = (byFolder.get(folder) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title));
    const clusterR = 5.2 + Math.min(4.4, Math.sqrt(kids.length) * 0.95);
    const kidDirs = fibSphere(kids.length);

    kids.forEach((v, ki) => {
      const kd = kidDirs[ki];
      // small deterministic jitter so identical-size clusters don't look gridded
      const jx = ((hashStr(v.id) % 100) / 100 - 0.5) * 3.2;
      const jy = ((hashStr(v.path) % 100) / 100 - 0.5) * 3.2;
      const jz = ((hashStr(v.id + v.title) % 100) / 100 - 0.5) * 3.2;
      const node: LaidNode = {
        ...v,
        degree: degreeOf.get(v.id) ?? 0,
        bx: hx * 0.82 + kd.x * clusterR + jx,
        by: hy * 0.82 + kd.y * clusterR + jy,
        bz: hz * 0.82 + kd.z * clusterR + jz,
        phase: (hashStr(v.id) % 628) / 100,
        radius: 0.34 + ((hashStr(v.title) % 60) / 60) * 0.16,
      };
      laid.push(node);
      posById.set(v.id, node);
    });
  });

  return { laid, posById };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

interface SceneProps {
  laid: LaidNode[];
  edges: VaultEdgeDatum[];
  posById: Map<string, LaidNode>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function GraphScene({ laid, edges, posById, selectedId, onSelect }: SceneProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /* adjacency for hover highlight */
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of edges) {
      if (!posById.has(e.source) || !posById.has(e.target)) continue;
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [edges, posById]);

  const focusId = hoveredId ?? selectedId;
  const isActive = useCallback(
    (id: string) => {
      if (!focusId) return true;
      if (id === focusId) return true;
      return neighbors.get(focusId)?.has(id) ?? false;
    },
    [focusId, neighbors]
  );

  /* edge endpoint index pairs */
  const idxOf = useMemo(() => {
    const m = new Map<string, number>();
    laid.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [laid]);

  const edgePairs = useMemo(
    () =>
      edges
        .map((e) => ({
          a: idxOf.get(e.source) ?? -1,
          b: idxOf.get(e.target) ?? -1,
        }))
        .filter((p) => p.a >= 0 && p.b >= 0),
    [edges, idxOf]
  );

  /* shared per-frame displayed positions (nodes + edges + pulses all read this) */
  const dispPos = useMemo(() => new Float32Array(Math.max(laid.length, 1) * 3), [laid.length]);

  /* geometry buffers */
  const lineGeo = useRef<THREE.BufferGeometry>(null);
  const linePos = useMemo(() => new Float32Array(Math.max(edgePairs.length, 1) * 6), [edgePairs.length]);
  const lineCol = useMemo(() => new Float32Array(Math.max(edgePairs.length, 1) * 6), [edgePairs.length]);

  const pulseGeo = useRef<THREE.BufferGeometry>(null);
  const pulsePos = useMemo(() => new Float32Array(Math.max(edgePairs.length, 1) * 3), [edgePairs.length]);
  const pulsePhase = useMemo(() => edgePairs.map((_, i) => (i * 0.61803) % 1), [edgePairs]);

  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    /* node idle motion → shared buffer */
    for (let i = 0; i < laid.length; i++) {
      const n = laid[i];
      dispPos[i * 3 + 0] = n.bx + Math.cos(t * 0.62 + n.phase * 1.3) * 0.22;
      dispPos[i * 3 + 1] = n.by + Math.sin(t * 0.85 + n.phase) * 0.3;
      dispPos[i * 3 + 2] = n.bz + Math.sin(t * 0.5 + n.phase * 0.7) * 0.22;
    }

    /* edges */
    const lg = lineGeo.current;
    if (lg) {
      const dimK = focusId ? 0.18 : 1;
      for (let ei = 0; ei < edgePairs.length; ei++) {
        const { a, b } = edgePairs[ei];
        const ax = dispPos[a * 3], ay = dispPos[a * 3 + 1], az = dispPos[a * 3 + 2];
        const bx = dispPos[b * 3], by = dispPos[b * 3 + 1], bz = dispPos[b * 3 + 2];
        linePos[ei * 6 + 0] = ax; linePos[ei * 6 + 1] = ay; linePos[ei * 6 + 2] = az;
        linePos[ei * 6 + 3] = bx; linePos[ei * 6 + 4] = by; linePos[ei * 6 + 5] = bz;

        const active = !focusId || laid[a].id === focusId || laid[b].id === focusId;
        tmpColor.set(active ? "#bff3ff" : folderColor(laid[a].folder));
        const k = (active ? 1 : dimK) * (active ? 1 : 0.75);
        lineCol[ei * 6 + 0] = tmpColor.r * k;
        lineCol[ei * 6 + 1] = tmpColor.g * k;
        lineCol[ei * 6 + 2] = tmpColor.b * k;
        lineCol[ei * 6 + 3] = tmpColor.r * k;
        lineCol[ei * 6 + 4] = tmpColor.g * k;
        lineCol[ei * 6 + 5] = tmpColor.b * k;
      }
      lg.attributes.position.needsUpdate = true;
      lg.attributes.color.needsUpdate = true;
    }

    /* travelling light pulses */
    const pg = pulseGeo.current;
    if (pg) {
      for (let ei = 0; ei < edgePairs.length; ei++) {
        const { a, b } = edgePairs[ei];
        const ph = (pulsePhase[ei] + t * 0.16) % 1;
        pulsePos[ei * 3 + 0] = dispPos[a * 3] + (dispPos[b * 3] - dispPos[a * 3]) * ph;
        pulsePos[ei * 3 + 1] = dispPos[a * 3 + 1] + (dispPos[b * 3 + 1] - dispPos[a * 3 + 1]) * ph;
        pulsePos[ei * 3 + 2] = dispPos[a * 3 + 2] + (dispPos[b * 3 + 2] - dispPos[a * 3 + 2]) * ph;
      }
      pg.attributes.position.needsUpdate = true;
      pg.setDrawRange(0, edgePairs.length);
    }
  });

  const maxDeg = Math.max(1, ...laid.map((n) => n.degree));

  return (
    <>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.72}
        zoomSpeed={1.15}
        panSpeed={0.7}
        minDistance={2.2}
        maxDistance={160}
        autoRotate
        autoRotateSpeed={0.35}
      />
      <ambientLight intensity={0.8} />
      <pointLight position={[14, 16, 14]} intensity={90} distance={90} />

      {/* wikilink edges */}
      <lineSegments frustumCulled={false}>
        <bufferGeometry ref={lineGeo}>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
          <bufferAttribute attach="attributes-color" args={[lineCol, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.66}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      {/* light pulses flowing along edges */}
      <points frustumCulled={false}>
        <bufferGeometry ref={pulseGeo} drawRange={{ start: 0, count: edgePairs.length }}>
          <bufferAttribute attach="attributes-position" args={[pulsePos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={getGlow()}
          color="#aef3ff"
          size={1.05}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      {/* nodes */}
      {laid.map((node, i) => (
        <VaultNodeMesh
          key={node.id}
          node={node}
          index={i}
          dispPos={dispPos}
          active={isActive(node.id)}
          hovered={hoveredId === node.id}
          selected={selectedId === node.id}
          showLabel={
            hoveredId === node.id ||
            selectedId === node.id ||
            node.degree >= Math.max(2, maxDeg * 0.67)
          }
          onHover={(h) => setHoveredId(h ? node.id : null)}
          onSelect={(id) => onSelect(id === selectedId ? null : id)}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One node                                                            */
/* ------------------------------------------------------------------ */

interface NodeMeshProps {
  node: LaidNode;
  index: number;
  dispPos: Float32Array;
  active: boolean;
  hovered: boolean;
  selected: boolean;
  showLabel: boolean;
  onHover: (hovering: boolean) => void;
  onSelect: (id: string) => void;
  dimmed?: boolean;
}

const VaultNodeMesh = memo(function VaultNodeMesh({
  node, index, dispPos, dimmed = false, hovered, selected, showLabel, onHover, onSelect,
}: NodeMeshProps) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null!);
  const glow = useRef<THREE.Sprite>(null!);
  const label = useRef<THREE.Sprite>(null!);
  const matCore = useRef<THREE.MeshBasicMaterial>(null!);
  const matGlow = useRef<THREE.SpriteMaterial>(null!);

  const colBase = useMemo(() => new THREE.Color(folderColor(node.folder)), [node.folder]);
  const labelScale = useMemo(() => {
    // proportional world-size from texture pixels → no stretch at any aspect
    const ud = (labelTexture(node.title) as unknown as { userData?: { w: number; h: number } }).userData;
    if (!ud) return [3, 1] as const;
    const worldH = 0.62; // on-screen label height in world units
    return [(worldH * ud.w) / ud.h, worldH] as const;
  }, [node.title]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const g = group.current;
    if (!g) return;

    g.position.set(dispPos[index * 3], dispPos[index * 3 + 1], dispPos[index * 3 + 2]);

    const breathe = 1 + 0.09 * Math.sin(t * 1.7 + node.phase);
    const boost = hovered ? 1.32 : selected ? 1.42 : 1;
    const s = node.radius * breathe * boost;
    core.current.scale.setScalar(s);
    glow.current.scale.setScalar(s * (hovered || selected ? 7.6 : 5.2));

    const targetCore = dimmed ? 0.13 : 1;
    matCore.current.opacity += (targetCore - matCore.current.opacity) * 0.16;
    const targetGlow = dimmed ? 0.05 : hovered ? 0.88 : selected ? 0.98 : 0.52;
    matGlow.current.opacity += (targetGlow - matGlow.current.opacity) * 0.16;

    if (label.current) {
      const lm = label.current.material as THREE.SpriteMaterial;
      lm.opacity += ((showLabel && !dimmed ? 0.97 : 0) - lm.opacity) * 0.15;
      label.current.scale.set(labelScale[0], labelScale[1], 1);
    }
  });

  return (
    <group ref={group}>
      <mesh
        ref={core}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
        }}
        onPointerOut={() => onHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
      >
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial ref={matCore} color={colBase} toneMapped={false} transparent />
      </mesh>

      <sprite ref={glow}>
        <spriteMaterial
          ref={matGlow}
          map={getGlow()}
          color={colBase}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <sprite ref={label} center={[0.5, 0]} position={[0, 1.15, 0]}>
        <spriteMaterial map={labelTexture(node.title)} transparent depthWrite={false} opacity={0} />
      </sprite>
    </group>
  );
});

/* ------------------------------------------------------------------ */
/* Camera focus rig                                                    */
/* ------------------------------------------------------------------ */

function FocusRig({ selected }: { selected: LaidNode | null }) {
  const { camera, controls } = useThree() as any;
  const goalTarget = useRef(new THREE.Vector3(0, 0, 0));
  const goalDist = useRef(58);

  useEffect(() => {
    if (selected) {
      goalTarget.current.set(selected.bx, selected.by, selected.bz);
      goalDist.current = 11;
    } else {
      goalTarget.current.set(0, 0, 0);
      goalDist.current = 58;
    }
  }, [selected]);

  useFrame(() => {
    if (!controls) return;
    controls.target.lerp(goalTarget.current, 0.05);
    const dir = camera.position.clone().sub(controls.target);
    const curDist = dir.length() || 0.001;
    const next = curDist + (goalDist.current - curDist) * 0.04;
    camera.position.copy(controls.target).add(dir.setLength(next));
    controls.update();
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Top-level component                                                 */
/* ------------------------------------------------------------------ */

export default function VaultGraph({
  nodes,
  edges,
}: {
  nodes: VaultNodeDatum[];
  edges: VaultEdgeDatum[];
}) {
  const { laid, posById } = useMemo(() => buildLayout(nodes, edges), [nodes, edges]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => laid.find((n) => n.id === selectedId) ?? null, [laid, selectedId]);

  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return [];
    const ids = new Set<string>();
    for (const e of edges) {
      if (e.source === selectedId && posById.has(e.target)) ids.add(e.target);
      if (e.target === selectedId && posById.has(e.source)) ids.add(e.source);
    }
    return laid.filter((n) => ids.has(n.id));
  }, [edges, laid, posById, selectedId]);

  const foldersInGraph = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of laid) m.set(n.folder, (m.get(n.folder) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [laid]);

  return (
    <div className="relative">
      <div
        className="relative h-[76vh] min-h-[560px] w-full overflow-hidden rounded-2xl border"
        style={{
          borderColor: "rgba(80,220,255,0.18)",
          background:
            "radial-gradient(1200px 720px at 50% 42%, #0a1220 0%, #05060a 60%, #030407 100%)",
        }}
      >
        <Canvas
          camera={{ position: [0, 14, 56], fov: 50 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#05060a"]} />
          <fog attach="fog" args={["#05060a", 80, 240]} />
          <GraphScene
            laid={laid}
            edges={edges}
            posById={posById}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <FocusRig selected={selected} />
        </Canvas>

        {/* legend */}
        <div className="pointer-events-none absolute left-4 top-4 flex max-w-[300px] flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-white/5 bg-black/35 px-4 py-3 backdrop-blur-md">
          {foldersInGraph.map(([folder, count]) => (
            <span key={folder} className="flex items-center gap-1.5 text-[11px]" style={{ color: folderColor(folder) }}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: folderColor(folder), boxShadow: `0 0 8px ${folderColor(folder)}` }}
              />
              {prettyFolder(folder)} <span className="text-slate-500">·{count}</span>
            </span>
          ))}
        </div>

        {/* hint */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/5 bg-black/40 px-4 py-1.5 text-[11px] text-slate-400 backdrop-blur-md">
          drag to orbit · scroll to zoom · hover to trace links · click a node to focus
        </div>

        {/* inspector */}
        {selected && (
          <aside
            className="absolute right-4 top-4 flex max-h-[calc(100%-2rem)] w-[340px] flex-col overflow-hidden rounded-xl border backdrop-blur-xl"
            style={{ borderColor: "rgba(80,220,255,0.25)", background: "rgba(5,10,18,0.84)" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{
                      background: folderColor(selected.folder),
                      boxShadow: `0 0 10px ${folderColor(selected.folder)}`,
                    }}
                  />
                  <span className="text-[11px] uppercase tracking-wider" style={{ color: folderColor(selected.folder) }}>
                    {prettyFolder(selected.folder)}
                  </span>
                </div>
                <h2 className="truncate text-[16px] font-semibold text-sky-50">{selected.title}</h2>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Close inspector"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">
                {selected.preview || "(empty note)"}
              </p>
            </div>

            {selectedNeighbors.length > 0 && (
              <div className="border-t border-white/5 px-5 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <Link2 size={12} /> {selectedNeighbors.length} linked thought{selectedNeighbors.length === 1 ? "" : "s"}
                </div>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {selectedNeighbors.map((nb) => (
                    <button
                      key={nb.id}
                      onClick={() => setSelectedId(nb.id)}
                      className="rounded-full border px-2.5 py-1 text-[11px] transition hover:brightness-125"
                      style={{
                        borderColor: `${folderColor(nb.folder)}55`,
                        color: folderColor(nb.folder),
                        background: `${folderColor(nb.folder)}11`,
                      }}
                    >
                      {nb.title.length > 22 ? nb.title.slice(0, 21) + "…" : nb.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
