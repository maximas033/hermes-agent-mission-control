"use client";

import { useEffect, useState, useRef } from "react";

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

const roleColors: Record<string, string> = {
  jarvis: "from-amber-400/30 to-amber-500/10 border-amber-400/40",
  "1540945637946687498": "from-sky-400/30 to-sky-500/10 border-sky-400/40",
  "1540945774165233774": "from-indigo-400/30 to-indigo-500/10 border-indigo-400/40",
  "1540960420838510752": "from-emerald-400/30 to-emerald-500/10 border-emerald-400/40",
  "1541170172167987353": "from-purple-400/30 to-purple-500/10 border-purple-400/40",
  "1541138550299566123": "from-blue-400/30 to-blue-500/10 border-blue-400/40",
  "1541138552358965348": "from-fuchsia-400/30 to-fuchsia-500/10 border-fuchsia-400/40",
  "1541138553243697296": "from-cyan-400/30 to-cyan-500/10 border-cyan-400/40",
};

const roleGlow: Record<string, string> = {
  jarvis: "shadow-amber-400/30",
  "1540945637946687498": "shadow-sky-400/30",
  "1540945774165233774": "shadow-indigo-400/30",
  "1540960420838510752": "shadow-emerald-400/30",
  "1541170172167987353": "shadow-purple-400/30",
  "1541138550299566123": "shadow-blue-400/30",
  "1541138552358965348": "shadow-fuchsia-400/30",
  "1541138553243697296": "shadow-cyan-400/30",
};

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

// ── Agent Pod ──
function AgentPod({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const gradient = roleColors[agent.id] || "from-gray-400/30 to-gray-500/10 border-gray-400/40";
  const glow = roleGlow[agent.id] || "shadow-gray-400/30";
  const pulse = agent.status === "working" || agent.status === "active" || agent.status === "online";

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-[18px] p-0.5 overflow-hidden transition-all duration-300
        bg-gradient-to-br ${gradient} hover:scale-[1.04]
        ${pulse ? `shadow-2xl ${glow} animate-pulse-subtle` : "shadow-xl"}`}>
      {/* Hologram grid background */}
      <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:18px_18px] rounded-[17px]" />

      <div className="relative rounded-[16px] bg-[#0d0d14]/80 backdrop-blur-sm p-5 h-full flex flex-col">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-[14px] flex items-center justify-center text-3xl shrink-0"
              style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
              {agent.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">{agent.name}</h3>
                <StatusDot status={agent.status} />
                <span className="text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider">
                  {agent.status}
                </span>
              </div>
              <p className="text-[12px] text-[var(--text-3)] mt-1 max-w-[180px] truncate">{agent.role}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="num text-[20px] font-semibold text-[var(--text)] leading-none">{agent.tasksCompleted}</div>
            <div className="eyebrow mt-1" style={{ fontSize: 10 }}>tasks</div>
            {agent.lastActive && <div className="text-[9px] text-[var(--text-4)] mt-1">{timeAgo(agent.lastActive)}</div>}
          </div>
        </div>

        {agent.currentTask && agent.status === "working" && (
          <div className="mt-3 p-2 rounded-[10px]" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)" }}>
            <p className="text-[11px] text-cyan-300 truncate">🛠️ {agent.currentTask}</p>
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="mt-auto pt-3 text-[12px] font-medium text-cyan-300 hover:text-cyan-200 transition-colors flex items-center gap-1.5">
          <span>Chat</span>
          <span>→</span>
        </button>
      </div>
    </div>
  );
}

// ── Live Agent Chat Modal ──
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
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
            onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && send()}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary px-4 py-2 text-[13px] rounded-full">
            Send
          </button>
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
      setAgents(Array.isArray(data) ? data : []);
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
  const offline = agents.filter((a) => a.status === "offline").length;

  if (loading) {
    return (
      <div className="relative min-h-screen p-8 bg-[#05050a]">
        <div className="relative z-10 w-full mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="sk h-36 rounded-[18px]" />)}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative min-h-screen bg-[#05050a] text-[var(--text)] p-8 pb-16 overflow-hidden">
        {/* Starfield background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.04)_0%,transparent_70%)]" />
          {[...Array(80)].map((_, i) => (
            <div key={i}
              className="absolute rounded-full bg-white/10"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                width: `${Math.random() * 2 + 0.5}px`,
                height: `${Math.random() * 2 + 0.5}px`,
                opacity: Math.random() * 0.5 + 0.1,
              }} />
          ))}
        </div>

        <div className="relative z-10 w-full mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow mb-2.5 text-cyan-300/60">Agent HQ — Orbit Terminal</div>
              <h1 className="text-[32px] font-semibold tracking-[-0.025em] bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-white to-slate-400">
                Jarvis Agent Fleet
              </h1>
              <p className="text-[13px] text-[var(--text-3)] mt-3">8 agents · {working} active · {idle} idle · {offline} offline</p>
            </div>
            <div className="flex items-center gap-6 text-center">
              <div className="flex gap-7">
                <div>
                  <div className="num text-[24px] font-semibold text-emerald-400 leading-none">{working}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Working</div>
                </div>
                <div>
                  <div className="num text-[24px] font-semibold text-sky-400 leading-none">{idle}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Idle</div>
                </div>
                <div>
                  <div className="num text-[24px] font-semibold text-slate-500 leading-none">{offline}</div>
                  <div className="eyebrow mt-1.5" style={{ fontSize: 11, color: "var(--text-4)" }}>Offline</div>
                </div>
              </div>
            </div>
          </div>

          {/* Main agent pods grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {agents.map((agent) => (
              <AgentPod key={agent.id} agent={agent} onClick={() => setChatAgent(agent)} />
            ))}
          </div>

          {/* Break room: idle + offline agents relaxing */}
          {(idle + offline > 0) && (
            <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="eyebrow mb-4 text-sky-300/60">🪑 Break Room · Idle & Offline Agents</div>
              <div className="flex flex-wrap items-end gap-4">
                {agents.filter((a) => a.status === "idle" || a.status === "offline").map((agent) => (
                  <div key={agent.id} className="relative group cursor-pointer" onClick={() => setChatAgent(agent)}>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] text-[var(--text-4)] whitespace-nowrap">
                      {agent.status === "idle" ? "💤 idling" : "⏸️ offline"} · {agent.tasksCompleted} tasks
                    </div>
                    <div className="relative">
                      {/* little lounge chair */}
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-10 h-6 border-2 border-slate-600 rounded-b-[50%] rounded-t-sm" />
                      <div className="w-12 h-16 rounded-[14px] flex items-center justify-center text-2xl"
                        style={{ background: "rgba(20,25,40,0.5)", border: "1px solid var(--line)" }}>
                        {agent.emoji}
                      </div>
                    </div>
                    <div className="mt-6 text-center">
                      <span className="text-[12px] font-medium text-[var(--text-2)]">{agent.name}</span>
                      <p className="text-[10px] text-[var(--text-4)]">{agent.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat modal */}
      {chatAgent && <AgentChat agent={chatAgent} onClose={() => setChatAgent(null)} />}
    </>
  );
}
