"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Box, Plus, Check, X, Trash2, GitCompare, Cpu, Printer, Layers } from "lucide-react";
import { Panel, Pill, Button, Skeleton, EmptyState, rise } from "@/components/ui/kit";

// CRITICAL: three.js scene MUST be client-only, never SSR'd.
const HologramViewer = dynamic(() => import("@/components/hologram-viewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-[var(--text-3)] text-[12px]">
      Initializing hologram…
    </div>
  ),
});

interface PrintDesign {
  id: string;
  name: string;
  description: string | null;
  author: string;
  status: string;
  geometry: string;
  thumbnail: string | null;
  accentColor: string;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

const STATUS_CONFIG: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "accent" },
  approved: { label: "Approved", tone: "up" },
  rejected: { label: "Rejected", tone: "down" },
  printing: { label: "Printing", tone: "warn" },
  done: { label: "Done", tone: "up" },
};

const inputCls =
  "w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[var(--r-sm)] px-4 py-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--line-strong)] transition-colors";

// ── Seed designs (used only if the library is empty) ──────────
const SAMPLE_BRACKET = `{"type":"composite","parts":[
  {"shape":"box","size":[2,0.3,1],"pos":[0,0,0],"color":"#22D3EE"},
  {"shape":"box","size":[0.3,1,1],"pos":[0.85,0.35,0],"color":"#22D3EE"}
]}`;

const SEED_DESIGNS: { name: string; description: string; geometry: string; accentColor: string }[] = [
  {
    name: "L-Bracket",
    description: "Simple composite bracket — two boxes forming an L. Good first test print.",
    geometry: SAMPLE_BRACKET,
    accentColor: "#22D3EE",
  },
  {
    name: "Gear Stack",
    description: "Stacked torus gears — tests concentric rotational geometry + hologram depth.",
    geometry: `{"type":"composite","parts":[
      {"shape":"torus","radius":1.2,"tube":0.28,"pos":[0,0.4,0],"color":"#A78BFA"},
      {"shape":"torus","radius":0.8,"tube":0.2,"pos":[0,-0.4,0],"color":"#A78BFA"},
      {"shape":"cylinder","radius":0.25,"radiusTop":0.25,"radiusBottom":0.25,"height":1.8,"pos":[0,0,0],"color":"#A78BFA"}
    ]}`,
    accentColor: "#A78BFA",
  },
  {
    name: "Phone Stand",
    description: "Tilted wedge + base support — a practical desk stand.",
    geometry: `{"type":"composite","parts":[
      {"shape":"box","size":[3,0.3,2],"pos":[0,-1,0],"color":"#34D399"},
      {"shape":"box","size":[3,2,0.3],"pos":[0,0,-0.85],"rot":[-0.35,0,0],"color":"#34D399"},
      {"shape":"box","size":[0.3,1.2,2],"pos":[-1.35,0.3,0],"color":"#34D399"}
    ]}`,
    accentColor: "#34D399",
  },
];

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ── Single design card in the library ──────────────────────────
function DesignCard({
  design,
  selected,
  onSelect,
  onUpdate,
}: {
  design: PrintDesign;
  selected: boolean;
  onSelect: () => void;
  onUpdate: () => void;
}) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const status = design.status || "pending";
  const statusConf = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const isDead = status === "rejected" || status === "done";
  const isApproved = status === "approved";

  const patchStatus = async (s: string, feedback?: string) => {
    await fetch(`/api/print-designs/${design.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback ? { status: s, feedback } : { status: s }),
    });
    onUpdate();
  };

  const handleDelete = async () => {
    await fetch(`/api/print-designs/${design.id}`, { method: "DELETE" });
    onUpdate();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    await patchStatus("rejected", rejectReason.trim());
    setIsRejecting(false);
    setRejectReason("");
  };

  return (
    <div onClick={onSelect} className="cursor-pointer">
      <Panel
        interactive
        className={`p-4 ${selected ? "ring-1" : ""}`}
        style={selected ? { borderColor: design.accentColor } : undefined}
      >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: design.accentColor, boxShadow: `0 0 8px ${design.accentColor}` }}
          />
          <h3 className="text-[13.5px] font-semibold text-[var(--text)] truncate">{design.name}</h3>
        </div>
        <Pill tone={statusConf.tone}>{statusConf.label}</Pill>
      </div>

      {design.description && (
        <p className="text-[var(--text-2)] text-[12px] leading-relaxed mb-2 line-clamp-2">
          {design.description}
        </p>
      )}

      <div className="flex items-center gap-3 text-[10.5px] num text-[var(--text-4)] mb-3">
        <span className="flex items-center gap-1">
          <Layers className="w-3 h-3" />
          {design.author}
        </span>
        {design.createdAt && <span>{formatDate(design.createdAt)}</span>}
      </div>

      {status === "rejected" && design.feedback && (
        <div
          className="rounded-[var(--r-sm)] px-2.5 py-1.5 mb-2"
          style={{
            background: "color-mix(in srgb, var(--down) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--down) 22%, transparent)",
          }}
        >
          <p className="text-[11px]" style={{ color: "var(--down)" }}>
            <span className="font-medium">Rejected:</span> {design.feedback}
          </p>
        </div>
      )}

      {!isDead && !isApproved && !isRejecting && (
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              patchStatus("approved");
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors"
            style={{ color: "var(--up)", borderColor: "color-mix(in srgb, var(--up) 24%, transparent)" }}
          >
            <Check className="w-3 h-3" /> Approve
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsRejecting(true);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 24%, transparent)" }}
          >
            <X className="w-3 h-3" /> Reject
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--text-3)] hover:text-[var(--down)] border border-[var(--line)] hover:border-[var(--down)] transition-colors"
            aria-label="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isRejecting && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReject()}
            placeholder="Why reject? (helps Jarvis learn)"
            className="flex-1 bg-[var(--surface-2)] border rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none"
            style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
            autoFocus
          />
          <button
            onClick={handleReject}
            disabled={!rejectReason.trim()}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border disabled:opacity-40"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
          >
            Reject
          </button>
          <button
            onClick={() => {
              setIsRejecting(false);
              setRejectReason("");
            }}
            className="px-3 py-1.5 rounded-full text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
        </div>
      )}

      {isApproved && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--up)" }}>
          <Check className="w-3 h-3" /> Approved — ready for queue
        </div>
      )}
      </Panel>
    </div>
  );
}

// ── New design modal ───────────────────────────────────────────
function NewDesignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [geometry, setGeometry] = useState(SAMPLE_BRACKET);
  const [accentColor, setAccentColor] = useState("#22D3EE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewGeo, setPreviewGeo] = useState(SAMPLE_BRACKET);

  const validateJson = (s: string) => {
    try {
      JSON.parse(s);
      setError("");
      return true;
    } catch {
      setError("Invalid JSON geometry spec");
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!validateJson(geometry)) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/print-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, geometry, accentColor }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to create design");
        setSubmitting(false);
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="eyebrow">New Design</span>
          <button
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text)] p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Design name *"
              required
            />
            <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--line)] rounded-[var(--r-sm)] px-3">
              <span className="text-[11px] text-[var(--text-3)]">Accent</span>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-8 h-8 bg-transparent border-0 cursor-pointer"
              />
            </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
            placeholder="Description (optional)"
            rows={2}
          />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] text-[var(--text-3)]">Geometry spec (JSON)</label>
              <button
                type="button"
                onClick={() => {
                  setGeometry(SAMPLE_BRACKET);
                  setPreviewGeo(SAMPLE_BRACKET);
                }}
                className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
              >
                Reset sample
              </button>
            </div>
            <textarea
              value={geometry}
              onChange={(e) => {
                setGeometry(e.target.value);
                if (e.target.value !== previewGeo) setPreviewGeo(e.target.value);
              }}
              onBlur={() => validateJson(geometry)}
              className={`${inputCls} resize-none font-mono text-[11px] leading-relaxed`}
              rows={8}
              spellCheck={false}
            />
          </div>

          {error && <p className="text-[12px]" style={{ color: "var(--down)" }}>{error}</p>}

          {/* Live preview */}
          <div>
            <label className="text-[11px] text-[var(--text-3)]">Preview</label>
            <div className="h-44 mt-1 rounded-[var(--r-sm)] border border-[var(--line)] overflow-hidden">
              {validateJsonSilent(previewGeo) ? (
                <HologramViewer geometry={previewGeo} accentColor={accentColor} spin={false} className="h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--down)] text-[12px]">
                  Invalid JSON
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Creating…" : "Create Design"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function validateJsonSilent(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// ── Mock printer status panel ──────────────────────────────────
function MockPrinterPanel() {
  return (
    <Panel className="p-5 relative" style={{ borderColor: "color-mix(in srgb, var(--warn) 24%, transparent)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Printer className="w-4 h-4 text-[var(--text-2)]" />
          <h3 className="text-[13.5px] font-semibold text-[var(--text)]">Printer Status</h3>
        </div>
        <Pill tone="warn">MOCK</Pill>
      </div>

      <div
        className="rounded-[var(--r-sm)] px-3 py-2 mb-3 flex items-center gap-2"
        style={{ background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}
      >
        <Cpu className="w-3.5 h-3.5" style={{ color: "var(--warn)" }} />
        <span className="text-[11.5px]" style={{ color: "var(--warn)" }}>
          Bambu Lab X1C — not connected (Phase 2)
        </span>
      </div>

      <div className="space-y-2.5 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-3)]">Bed Temp</span>
          <span className="num text-[var(--text-2)]">—°C</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-3)]">Nozzle</span>
          <span className="num text-[var(--text-2)]">—°C</span>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-3)]">Progress</span>
            <span className="num text-[var(--text-2)]">0%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full w-0 bg-[var(--warn)]" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-3)]">Queue</span>
          <span className="num text-[var(--text-2)]">empty</span>
        </div>
      </div>

      <p className="text-[10.5px] text-[var(--text-4)] mt-3 leading-relaxed">
        Simulated telemetry only. No live printer connection. Real Bambu Lab MQTT/LAN printing
        arrives in Phase 2.
      </p>
    </Panel>
  );
}

// ── Main page ───────────────────────────────────────────────────
export default function ThreeDPrintPage() {
  const [designs, setDesigns] = useState<PrintDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);

  const fetchDesigns = useCallback(async (seedIfEmpty = false) => {
    try {
      const res = await fetch("/api/print-designs");
      const data = await res.json();
      const list = data.designs || [];
      setDesigns(list);

      // Phase-1 seed: if empty and requested, populate a few examples.
      if (seedIfEmpty && list.length === 0) {
        await Promise.all(
          SEED_DESIGNS.map((d) =>
            fetch("/api/print-designs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(d),
            })
          )
        );
        const res2 = await fetch("/api/print-designs");
        const data2 = await res2.json();
        setDesigns(data2.designs || []);
        return;
      }

      // auto-select first on initial load
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
        if (list.length > 1) setCompareId(list[1].id);
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    fetchDesigns(true);
  }, [fetchDesigns]);

  const selected = useMemo(
    () => designs.find((d) => d.id === selectedId) || designs[0] || null,
    [designs, selectedId]
  );
  const compareDesign = useMemo(
    () => (compare ? designs.find((d) => d.id === compareId) || null : null),
    [designs, compare, compareId]
  );

  const handleCompareToggle = () => {
    if (!compare && designs.length > 1 && !compareId) {
      const other = designs.find((d) => d.id !== (selected?.id));
      setCompareId(other?.id || null);
    }
    setCompare((c) => !c);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of designs) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }, [designs]);

  if (loading) {
    return (
      <div className="w-full mx-auto p-6 pb-16">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-9 w-32 !rounded-full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 pb-24">
      {/* Header */}
      <div className="hq-rise flex items-end justify-between gap-4 pt-2 pb-7" style={rise(0)}>
        <div>
          <div className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5" />
            3D Print
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            3D Print Studio
          </h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">
            {designs.length} designs · {counts.pending || 0} pending · {counts.approved || 0} approved
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          New Design
        </Button>
      </div>

      {/* Layout: library (left) + viewer + printer (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-6 items-start">
        {/* Library */}
        <div className="space-y-3 lg:sticky lg:top-6">
          <div className="flex items-center justify-between mb-1">
            <span className="eyebrow">Design Library</span>
            <span className="num text-[10px] text-[var(--text-4)]">{designs.length}</span>
          </div>
          <div className="space-y-3 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
            {designs.map((d) => (
              <DesignCard
                key={d.id}
                design={d}
                selected={d.id === selectedId}
                onSelect={() => setSelectedId(d.id)}
                onUpdate={() => fetchDesigns(false)}
              />
            ))}
            {designs.length === 0 && (
              <Panel className="p-4">
                <EmptyState
                  icon={<Box className="w-7 h-7" />}
                  title="No designs yet"
                  hint="Create a new design with a JSON geometry spec to get started."
                />
              </Panel>
            )}
          </div>
        </div>

        {/* Viewer + controls */}
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {selected && (
                <Pill tone="accent">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: selected.accentColor }}
                  />
                  {selected.name}
                </Pill>
              )}
              {compareDesign && (
                <Pill tone="accent">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: compareDesign.accentColor }}
                  />
                  {compareDesign.name}
                </Pill>
              )}
            </div>
            <button
              onClick={handleCompareToggle}
              disabled={designs.length < 2}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                compare
                  ? "text-[var(--text)] bg-[var(--surface-2)]"
                  : "text-[var(--text-3)] hover:text-[var(--text)]"
              }`}
              style={
                compare
                  ? { borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)" }
                  : undefined
              }
            >
              <GitCompare className="w-3.5 h-3.5" />
              {compare ? "Compare: On" : "Compare"}
            </button>
          </div>

          {/* Holographic viewer(s) */}
          <Panel className="p-0 overflow-hidden" style={{ borderColor: "var(--line)" }}>
            <div className="flex flex-col md:flex-row">
              {/* Primary viewer */}
              <div className={`flex-1 h-[26rem] ${compare ? "md:border-r border-[var(--line)]" : ""}`}>
                {selected ? (
                  <HologramViewer geometry={selected.geometry} accentColor={selected.accentColor} className="h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-3)] text-[12px]">
                    No design selected
                  </div>
                )}
              </div>
              {/* Compare viewer (independent canvas) */}
              {compare && (
                <div className="flex-1 h-[26rem]">
                  {compareDesign ? (
                    <HologramViewer
                      geometry={compareDesign.geometry}
                      accentColor={compareDesign.accentColor}
                      className="h-full"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--text-3)] text-[12px]">
                      Pick a second design
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* Compare picker */}
          {compare && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[var(--text-3)]">Compare with:</span>
              {designs
                .filter((d) => d.id !== selected?.id)
                .map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setCompareId(d.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      d.id === compareId
                        ? "text-[var(--text)] bg-[var(--surface-2)]"
                        : "text-[var(--text-3)] hover:text-[var(--text)]"
                    }`}
                    style={
                      d.id === compareId
                        ? { borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)" }
                        : undefined
                    }
                  >
                    {d.name}
                  </button>
                ))}
            </div>
          )}

          {/* Mock printer panel */}
          <MockPrinterPanel />
        </div>
      </div>

      {showModal && (
        <NewDesignModal onClose={() => setShowModal(false)} onCreated={() => fetchDesigns(false)} />
      )}
    </div>
  );
}
