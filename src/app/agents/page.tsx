"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { Cpu, Radio, Circle, Signal, MessageSquare } from "lucide-react";
import type { Agent as OfficeAgent } from "@/components/agents-office-claw3d";

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

// neon sci-fi palette
const agentColor: Record<string, string> = {
  jarvis: "#22d3ee",
  "1540945637946687498": "#38bdf8",
  "1540945774165233774": "#a78bfa",
  "1540960420838510752": "#34d399",
  "1541170172167987353": "#818cf8",
  "1541138550299566123": "#60a5fa",
  "1541138552358965348": "#f0abfc",
  "1541138553243697296": "#2dd4bf",
};

function normalizeStatus(s: string): "working" | "idle" | "offline" {
  if (s === "working" || s === "active" || s === "online") return "working";
  if (s === "error" || s === "offline") return "offline";
  return "idle";
}

const AgentsOffice = dynamic(() => import("@/components/agents-office-claw3d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-[var(--text-3)] text-[13px] tracking-wide">
      <span className="inline-flex items-center gap-2"><Signal className="w-4 h-4 animate-pulse" /> Initializing ops floor…</span>
    </div>
  ),
});

function timeAgo(dateStr?: string): string {
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
  const map: Record<string, { color: string; pulse?: boolean }> = {
    working: { color: "#34d399", pulse: true },
    online: { color: "#34d399", pulse: true },
    active: { color: "#34d399", pulse: true },
    idle: { color: "#38bdf8" },
    offline: { color: "#475569" },
    error: { color: "#f87171", pulse: true },
  };
  const c = map[status] || map.offline;
  return (
    <span className="relative flex w-2.5 h-2.5 shrink-0">
      {c.pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: c.color }} />}
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
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
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="elevated w-full max-w-lg overflow-hidden rounded-[18px] border border-slate-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)", background: "rgba(8,16,28,0.7)" }}>
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
              <p className="text-[var(--text-3)] text-[13px] text-center">Open a channel with {agent.name}.<br />They're online.</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] rounded-[14px] px-3.5 py-2 text-[13px] leading-relaxed"
                style={m.role === "user"
                  ? { background: "var(--surface-3)", color: "var(--text)" }
                  : { background: "rgba(8,16,28,0.6)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                {m.role === "assistant" && <span className="text-xs mr-1">{agent.emoji}</span>}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[14px] px-3.5 py-2" style={{ background: "rgba(8,16,28,0.6)", border: "1px solid var(--line)" }}>
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
  const [speakingId, setSpeakingId] = useState<string | undefined>(undefined);

  const loadAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      const normalized: Agent[] = (Array.isArray(data) ? data : []).map((a: any) => ({ ...a }));
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

  useEffect(() => { setSpeakingId(chatAgent?.id); }, [chatAgent]);

  const working = agents.filter((a) => a.status === "working" || a.status === "active" || a.status === "online").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const offline = agents.filter((a) => a.status === "offline" || a.status === "error").length;

  if (loading) {
    return (
      <div className="relative min-h-screen p-8 bg-[#05070d]">
        <div className="relative z-10 w-full mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <div key={i} className="sk h-20 rounded-[14px]" />)}
        </div>
      </div>
    );
  }

  const officeAgents: OfficeAgent[] = agents.map((a) => ({
    id: a.id, name: a.name, emoji: a.emoji, role: a.role,
    status: normalizeStatus(a.status), color: agentColor[a.id] || "#38bdf8",
    tasksCompleted: a.tasksCompleted, currentTask: a.currentTask ?? (a.recentActivity?.[0]?.action),
    recentActivity: a.recentActivity,
  }));

  return (
    <div className="relative min-h-screen bg-[#05070d] text-[var(--text)] overflow-hidden">
      {/* sci-fi ambient */}
      <div className="hq-ambient" />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(60% 50% at 50% 0%, rgba(34,211,238,0.06), transparent 70%)"
      }} />

      <div className="relative z-10 w-full mx-auto p-6 lg:p-8 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-2 flex items-center gap-2 text-cyan-300/70">
              <Cpu className="w-3.5 h-3.5" /> Agent Ops Floor
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-0.025em] text-[var(--text)]">
              Fleet Command
            </h1>
            <p className="text-[13px] text-[var(--text-3)] mt-2 flex items-center gap-2">
              <Circle className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
              {working} active · {idle} idle · {offline} offline
            </p>
          </div>
          <div className="flex gap-2.5">
            {[
              { label: "Active", v: working, c: "#34d399" },
              { label: "Idle", v: idle, c: "#38bdf8" },
              { label: "Offline", v: offline, c: "#475569" },
            ].map((s) => (
              <div key={s.label} className="panel px-4 py-2.5 text-center" style={{ minWidth: 84 }}>
                <div className="num text-[22px] font-semibold leading-none" style={{ color: s.c }}>{s.v}</div>
                <div className="eyebrow mt-1.5" style={{ fontSize: 10 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 3D Office — full height, framed as a holo-terminal */}
        <div className="relative rounded-[18px] border border-cyan-500/20 bg-[#04070e]/60 overflow-hidden"
          style={{ height: "72vh", boxShadow: "inset 0 0 60px rgba(34,211,238,0.05), 0 0 0 1px rgba(34,211,238,0.05)" }}>
          {/* corner brackets */}
          {[["left-3 top-3 border-l-2 border-t-2"], ["right-3 top-3 border-r-2 border-t-2"], ["left-3 bottom-3 border-l-2 border-b-2"], ["right-3 bottom-3 border-r-2 border-b-2"]].map((c, i) => (
            <div key={i} className={`absolute w-6 h-6 border-cyan-400/40 ${c[0]}`} />
          ))}
          {/* HUD label */}
          <div className="absolute left-5 top-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-300/70 pointer-events-none">
            <Radio className="w-3.5 h-3.5" /> Live Telemetry
          </div>
          <div className="absolute right-5 top-4 text-[11px] uppercase tracking-[0.2em] text-cyan-300/40 pointer-events-none">
            {agents.length} UNITS
          </div>
          <AgentsOffice agents={officeAgents} speakingId={speakingId} onSelect={(a) => setChatAgent(a as unknown as Agent)} />
        </div>

        {/* Roster — compact neon chips */}
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => {
            const c = agentColor[agent.id] || "#38bdf8";
            return (
              <button key={agent.id} onClick={() => setChatAgent(agent)}
                className="group flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-[var(--surface-1)]/70 border border-slate-700 hover:border-cyan-400/50 transition-colors"
                style={{ boxShadow: `inset 0 0 0 1px transparent` }}>
                <span className="relative flex w-2.5 h-2.5 shrink-0">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                </span>
                <span className="text-base">{agent.emoji}</span>
                <span className="font-medium text-[var(--text)] text-[12px]">{agent.name}</span>
                <MessageSquare className="w-3.5 h-3.5 text-[var(--text-4)] group-hover:text-cyan-300/70 transition-colors" />
              </button>
            );
          })}
        </div>
      </div>

      {chatAgent && <AgentChat agent={chatAgent} onClose={() => setChatAgent(null)} />}
    </div>
  );
}
