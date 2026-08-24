"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { Agent as OfficeAgent } from "@/components/agents-office";

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline" | "online" | "active";
  currentTask?: string;
  lastActive?: string;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: { timestamp: string; action: string; result?: string }[];
}

// color per agent for the 3D figures
const agentColor: Record<string, string> = {
  jarvis: "#fbbf24", // amber
  "1540945637946687498": "#38bdf8", // sky
  "1540945774165233774": "#a78bfa", // indigo
  "1540960420838510752": "#34d399", // emerald
  "1541170172167987353": "#a8b5dc", // purple
  "1541138550299566123": "#60a5fa", // blue
  "1541138552358965348": "#f0abfc", // fuchsia
  "1541138553243697296": "#22d3ee", // cyan
};

// Map API status → normalized office status
function normalizeStatus(s: string): "working" | "idle" | "offline" {
  if (s === "working" || s === "active" || s === "online") return "working";
  if (s === "error" || s === "offline") return "offline";
  return "idle";
}

// Lazy-load the 3D canvas only on the client (heavy deps).
const AgentsOffice = dynamic(() => import("@/components/agents-office"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[600px] text-[var(--text-3)]">
      Loading 3D office…
    </div>
  ),
});

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusDot({ status }: { status: Agent["status"] }) {
  const cfg: Record<string, { color: string; pulse?: boolean }> = {
    working: { color: "bg-emerald-400", pulse: true },
    online: { color: "bg-emerald-400", pulse: true },
    active: { color: "bg-emerald-400", pulse: true },
    idle: { color: "bg-sky-400" },
    offline: { color: "bg-slate-500" },
    error: { color: "bg-red-400", pulse: true },
  };
  const c = cfg[status] || { color: "bg-slate-500" };
  return (
    <span className="relative flex w-3 h-3 shrink-0">
      {c.pulse && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${c.color}`} />}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${c.color}`} />
    </span>
  );
}

function AgentChat({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user" as const, content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      const r = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, message: text, history: msgs }),
      });
      const d = await r.json();
      setMsgs([...newMsgs, { role: "assistant", content: d.reply }]);
    } catch {
      setMsgs([...newMsgs, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="elevated w-full max-w-lg overflow-hidden rounded-[18px] border border-slate-700"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)", background: "rgba(15,23,45,0.7)" }}>
          <span className="text-2xl">{agent.emoji}</span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</div>
            <div className="text-[12px] text-[var(--text-3)]">{agent.role}</div>
          </div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text)] text-xl leading-none">×</button>
        </div>
        <div className="h-80 overflow-y-auto p-4 space-y-3 flex flex-col" style={{ background: "var(--surface-1)" }}>
          {msgs.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--text-3)] text-[13px] text-center">
                Ask {agent.name} anything.<br />They're ready.
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] rounded-[14px] px-3.5 py-2 text-[13px] leading-relaxed"
                style={m.role === "user"
                  ? { background: "var(--surface-3)", color: "var(--text)" }
                  : { background: "rgba(15,23,45,0.6)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                {m.role === "assistant" && <span className="text-xs mr-1">{agent.emoji}</span>}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[14px] px-3.5 py-2" style={{ background: "rgba(15,23,45,0.6)", border: "1px solid var(--line)" }}>
                <span className="text-[var(--text-3)] text-[13px]">{agent.emoji} thinking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 p-3" style={{ borderTop: "1px solid var(--line)" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={`Message ${agent.name}…`}
            className="flex-1 rounded-full px-4 py-2 text-[13px] text-[var(--text)] focus:outline-none transition-colors"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          <button onClick={send} disabled={!input.trim() || loading} className="btn-primary px-4 py-2 text-[13px] rounded-full">Send</button>
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);

  const loadAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      const normalized = (Array.isArray(data) ? data : []).map((a: any) => ({
        ...a,
        // derive a stable color + normalized status for the 3D office
      }));
      setAgents(normalized);
    } catch {
      setAgents([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  const working = agents.filter((a) => a.status === "working" || a.status === "active" || a.status === "online").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const offline = agents.filter((a) => a.status === "offline" || a.status === "error").length;

  if (loading) {
    return (
      <div className="relative min-h-screen p-8 bg-[#05050a]">
        <div className="relative z-10 w-full mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="sk h-36 rounded-[18px]" />)}
        </div>
      </div>
    );
  }

  // shape for the 3D office component
  const officeAgents: OfficeAgent[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    role: a.role,
    status: normalizeStatus(a.status),
    color: agentColor[a.id] || "#64748a",
    tasksCompleted: a.tasksCompleted,
  }));

  return (
    <>
      <div className="relative min-h-screen bg-[#05050a] text-[var(--text)] p-8 pb-16 overflow-hidden">
        {/* Starfield background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.04)_0%,transparent_70%)]" />
          {[...Array(80)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-white/10"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                width: `${Math.random() * 2 + 0.5}px`,
                height: `${Math.random() * 2 + 0.5}px`,
                opacity: Math.random() * 0.5 + 0.1,
              }} />
          ))}
        </div>

        <div className="relative z-10 w-full mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow mb-2.5 text-cyan-300/60">Agent HQ — Orbit Terminal</div>
              <h1 className="text-[32px] font-semibold tracking-[-0.025em] bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-white to-slate-400">
                Jarvis Agent Fleet
              </h1>
              <p className="text-[13px] text-[var(--text-3)] mt-3">
                8 agents · <span className="text-emerald-400">{working} working</span> · <span className="text-sky-400">{idle} idling</span> · <span className="text-slate-500">{offline} offline</span>
              </p>
            </div>
            <div className="flex items-center gap-6 text-center">
              <div className="flex gap-7">
                <div>
                  <div className="num text-[24px] font-semibold text-emerald-400 leading-none">{working}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Working</div>
                </div>
                <div>
                  <div className="num text-[24px] font-semibold text-sky-400 leading-none">{idle}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Idling</div>
                </div>
                <div>
                  <div className="num text-[24px] font-semibold text-slate-500 leading-none">{offline}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Offline</div>
                </div>
              </div>
            </div>
          </div>

          {/* 3D Office */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 overflow-hidden">
            <AgentsOffice agents={officeAgents} />
          </div>

          {/* Mini roster legend — idle agents in break room (2D summary for quick chat) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            {agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => setChatAgent(agent)}
                className="flex items-center gap-2.5 p-2.5 rounded-[12px] bg-[var(--surface-1)]/60 border border-slate-700 hover:border-cyan-400/40 cursor-pointer transition-colors">
                <StatusDot status={agent.status} />
                <span className="text-xl">{agent.emoji}</span>
                <div>
                  <div className="font-medium text-[var(--text)]">{agent.name}</div>
                  <div className="text-[var(--text-4)] truncate max-w-[140px]">{agent.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {chatAgent && <AgentChat agent={chatAgent} onClose={() => setChatAgent(null)} />}
    </>
  );
}
