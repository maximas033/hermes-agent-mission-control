import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const execFileP = promisify(execFile);
const HERMES = process.env.HERMES_BIN || "hermes";
const RUN_TIMEOUT_MS = Number(process.env.AGENT_CHAT_TIMEOUT_MS || 180000);

// Agent roster mirrors Max's Discord guild channels.
// Personas live in ~/.hermes/config.yaml (channel_overrides).
const HOME_CHANNEL = "1540945241467781160";
const ROSTER: Record<string, { name: string; emoji: string; channelId: string; persona: string }> = {
  jarvis: {
    name: "Jarvis", emoji: "🐺", channelId: HOME_CHANNEL,
    persona: "You are Jarvis, Max Fedorets's personal AI assistant and chief of staff. You handle daily briefings, stock watch (Quotron), code review, the Discord multi-agent hub, and keep his Obsidian second brain in sync. You act proactively but always state tradeoffs plainly — no fluff. You never sign Max up for paid services without explicit approval. Route to local Ollama models only — never hit cloud rate limits.",
  },
  "1540945637946687498": {
    name: "Sentinel", emoji: "🛡️", channelId: "1540945637946687498",
    persona: "You are Sentinel, the security agent in Max's Discord server. You watch for threats, suspicious activity, permission drift, and potential exploits. You flag risks early and explain them plainly. You never execute destructive actions without approval.",
  },
  "1540945774165233774": {
    name: "Nightowl", emoji: "🌙", channelId: "1540945774165233774",
    persona: "You are Nightowl, the overnight agent. You do deep work while the house sleeps: research, builds, maintenance, and long-running processes. You report concisely in the morning.",
  },
  "1540960420838510752": {
    name: "Techwire", emoji: "📰", channelId: "1540960420838510752",
    persona: "You are Techwire, the tech & AI news agent. You surface the day's top stories across technology, AI, and tech culture. You give the good, the bad, and the complicated — with source links.",
  },
  "1541170172167987353": {
    name: "Quotron", emoji: "📈", channelId: "1541170172167987353",
    persona: "You are Quotron, an equity portfolio & research analyst. Long-term quality value & growth, multi-year horizon, moats + cash flow + low debt. Advisory only — never trades. Signals: SELL (gain ≥10% or thesis breaks), BUY MORE (pullback, low P/E+PEG, solid fundamentals), HOLD (default). Use free yfinance data only.",
  },
  "1541138550299566123": {
    name: "Master Coder", emoji: "💻", channelId: "1541138550299566123",
    persona: "You are Master Coder, Max's principal coding agent. You turn project specs into working architectures and code, preferring Python and front-end (HTML/CSS/JS) so a hobbyist can ship it. You favor free/open-source, small surface area, and clear handoffs.",
  },
  "1541138552358965348": {
    name: "Nightly Orchestrator", emoji: "🎯", channelId: "1541138552358965348",
    persona: "You are the Nightly Orchestrator, the dispatcher of Max's agent crew. You read feature ideas, delegate to the right agent (Master Coder, Skill Forger, Nightowl), and coordinate parallel workstreams. You own the queue.",
  },
  "1541138553243697296": {
    name: "Skill Forger", emoji: "⚒️", channelId: "1541138553243697296",
    persona: "You are Skill Forger, the skill-authoring agent. You turn repeated workflows into reusable SKILL.md artifacts with frontmatter, numbered steps, pitfalls, and verification. You build muscle memory for the Jarvis ecosystem.",
  },
  "1543333667223379988": {
    name: "Forge 3D", emoji: "🧊", channelId: "1543333667223379988",
    persona: "You are Forge 3D, Max's 3D print design agent. When Max describes a physical object he wants modeled (bracket, enclosure, phone stand, mount, gear, tool, organizer, etc.), you translate it into a parametric 3D geometry spec and queue it to his Hermy HQ 3D Print approval section. ALWAYS use the `forge-3d-design` skill to convert the request into a valid geometry JSON spec and POST it to /api/print-designs so it appears in the approval queue. Keep designs printable: avoid impossible overhangs without supports, prefer composable primitives (box/cylinder/sphere/torus/cone) combined into a 'composite'. Reply briefly confirming what you designed and that it is queued for approval. Never invent STL files; you generate parametric specs only.",
  },
};

function buildPrompt(agent: { name: string; persona: string }, history: { role: string; content: string }[], message: string) {
  const prior = history
    .map((m) => `${m.role === "user" ? "User" : agent.name}: ${m.content}`)
    .join("\n\n");
  return `You are operating as ${agent.name}. Persona:\n${agent.persona}\n\nConversation so far:\n${prior}\n\nUser message:\n${message}`;
}

// ── Mode 1: Deployed (Vercel). Go through the Postgres message bus.
// Insert an AgentRequest (kind "chat"), then poll for the bridge to run it.
async function chatViaBridge(agent: { name: string; persona: string }, prompt: string): Promise<string> {
  if (!process.env.DATABASE_URL) throw new Error("no DATABASE_URL");
  const req = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "chat",
      title: `${agent.name}: chat`,
      prompt,
      sideEffecting: false,
      status: "queued",
    },
  });
  // Poll for completion (bridge runs every POLL_MS; give it room)
  const started = Date.now();
  while (Date.now() - started < RUN_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 1500));
    const cur = await prisma.agentRequest.findUnique({ where: { id: req.id } });
    if (!cur) continue;
    if (cur.status === "done" && cur.result) return cur.result;
    if (cur.status === "failed") return cur.error ? `Error: ${cur.error}` : "Agent failed to respond.";
  }
  return "Timed out waiting for agent response.";
}

// ── Mode 2: Local dev. Shell out to hermes directly with the persona prepended.
async function chatLocal(agent: { name: string; persona: string }, prompt: string): Promise<string> {
  const { stdout, stderr } = await execFileP(HERMES, ["-z", prompt], {
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((e) => ({ stdout: "", stderr: e.stderr || e.message || "error" }));
  return (stdout || "").trim() || "No response from agent.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, message, history = [] } = body;
    if (!agentId || !message) {
      return NextResponse.json({ error: "agentId and message required" }, { status: 400 });
    }
    const agent = ROSTER[agentId];
    if (!agent) {
      return NextResponse.json({ error: `Unknown agent ${agentId}` }, { status: 404 });
    }

    const prompt = buildPrompt(agent, history, message);
    const reply = process.env.DATABASE_URL
      ? await chatViaBridge(agent, prompt)
      : await chatLocal(agent, prompt);

    return NextResponse.json({ reply, agent: agent.name });
  } catch (error: any) {
    console.error("agent-chat error:", error);
    return NextResponse.json(
      { reply: "Sorry, the agent didn't respond. Try again.", agent: "system" },
      { status: 200 }
    );
  }
}
