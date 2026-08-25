import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Real agent roster — mirrors Max's Discord channels (config.yaml channel_overrides)
const DEFAULT_AGENTS = [
  {
    id: "jarvis",
    name: "Jarvis",
    emoji: "🐺",
    role: "Chief of Staff · Orchestrator",
    status: "online",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1540945637946687498",
    name: "Sentinel",
    emoji: "🛡️",
    role: "Security Monitoring Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1540945774165233774",
    name: "Nightowl",
    emoji: "🌙",
    role: "Overnight Build & Maintenance Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1540960420838510752",
    name: "Techwire",
    emoji: "📰",
    role: "Tech & AI News Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1541170172167987353",
    name: "Quotron",
    emoji: "📈",
    role: "Equity Portfolio & Research Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1541138550299566123",
    name: "Master Coder",
    emoji: "💻",
    role: "Principal Coding Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1541138552358965348",
    name: "Nightly Orchestrator",
    emoji: "🎯",
    role: "Dispatcher & Coordinator Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "1541138553243697296",
    name: "Skill Forger",
    emoji: "⚒️",
    role: "Skill Authoring Agent",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
];

export async function GET() {
  try {
    // Merge persisted agentState (if DB available) with LIVE activity from the bus.
    let stateMap: Record<string, any> = {};
    try {
      const states = await prisma.agentState.findMany();
      for (const s of states) stateMap[s.id] = s;
    } catch {
      // DB may be unavailable (e.g. Vercel without DATABASE_URL) — fall back to live activity only
    }

    // Live activity: which agents have run recently? (drives working/idle in the office)
    // Source of truth = the shared Neon bus (AgentEvent), written by the bridge on every
    // run. This works whether the Mac is awake or not. The LAN activity endpoint is used
    // only as a secondary fallback if the table is empty.
    const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
    let liveActivity: Record<string, number> = {}; // agentId/slug -> last activity ts

    const ingestEvents = (events: { title?: string | null; createdAt?: string | Date }[]) => {
      for (const ev of events || []) {
        const m = (ev.title || "").match(/(?:Started|Failed|Finished|Completed|Done):\s*([A-Za-z ]+?):/);
        if (!m) continue;
        const slug = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const ts = Date.parse(ev.createdAt ? new Date(ev.createdAt).toISOString() : "");
        if (!Number.isFinite(ts)) continue;
        const id = AGENT_NAME_TO_ID[slug] || slug;
        if (!liveActivity[id] || ts > liveActivity[id]) liveActivity[id] = ts;
      }
    };

    // PRIMARY: read AgentEvent directly from Neon (bridge already mirrors all runs).
    try {
      const events = await prisma.agentEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 80,
      });
      ingestEvents(events as { title?: string | null; createdAt?: string | Date }[]);
    } catch {
      // Neon table unavailable — fall through to LAN fallback
    }

    // SECONDARY: LAN activity endpoint (Mac must be awake + same network).
    if (Object.keys(liveActivity).length === 0) {
      try {
        const actRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")}/api/hermes/activity`,
          { cache: "no-store" }
        );
        if (actRes.ok) {
          const act = await actRes.json();
          ingestEvents(act.events || []);
        }
      } catch {
        // activity feed unreachable — keep static/DB state
      }
    }

    const agents = DEFAULT_AGENTS.map((agent) => {
      const s = stateMap[agent.id] || {};
      const lastTs = liveActivity[agent.id];
      const isLiveActive = typeof lastTs === "number" && Date.now() - lastTs < ACTIVE_WINDOW_MS;
      const status = isLiveActive ? "working" : s.status || agent.status;
      return {
        ...agent,
        status,
        currentTask: s.currentTask || (isLiveActive ? "active" : undefined),
        lastActive: s.lastActive || (typeof lastTs === "number" ? new Date(lastTs).toISOString() : undefined),
        tasksCompleted: s.tasksCompleted || agent.tasksCompleted,
        totalCost: s.totalCost || agent.totalCost,
        recentActivity: s.recentActivity || agent.recentActivity,
      };
    });

    return NextResponse.json(agents, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    console.error("Agents API error:", error);
    return NextResponse.json(DEFAULT_AGENTS, { status: 200 });
  }
}

// Display-name (from activity titles) → canonical agent id used in DEFAULT_AGENTS
const AGENT_NAME_TO_ID: Record<string, string> = {
  jarvis: "jarvis",
  sentinel: "1540945637946687498",
  nightowl: "1540945774165233774",
  techwire: "1540960420838510752",
  quotron: "1541170172167987353",
  "master-coder": "1541138550299566123",
  "nightly-orchestrator": "1541138552358965348",
  "skill-forger": "1541138553243697296",
};


// POST to update agent state (called by cron jobs)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, action, status, currentTask } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId required" }, { status: 400 });
    }

    // Find the default agent info for name/emoji/role
    const defaultAgent = DEFAULT_AGENTS.find((a) => a.id === agentId);

    // Get existing state or create defaults
    let existing = await prisma.agentState.findUnique({ where: { id: agentId } });

    const recentActivity = (existing?.recentActivity as any[]) || [];
    const newRecentActivity = action
      ? [
          { timestamp: new Date().toISOString(), action },
          ...recentActivity.slice(0, 19),
        ]
      : recentActivity;

    const updatedState = await prisma.agentState.upsert({
      where: { id: agentId },
      update: {
        ...(status ? { status } : {}),
        ...(currentTask !== undefined ? { currentTask } : {}),
        lastActive: new Date(),
        ...(action
          ? {
              recentActivity: newRecentActivity,
              tasksCompleted: (existing?.tasksCompleted || 0) + 1,
            }
          : {}),
      },
      create: {
        id: agentId,
        name: defaultAgent?.name || agentId,
        emoji: defaultAgent?.emoji,
        role: defaultAgent?.role,
        status: status || "idle",
        currentTask: currentTask || null,
        lastActive: new Date(),
        tasksCompleted: action ? 1 : 0,
        totalCost: 0,
        recentActivity: newRecentActivity,
      },
    });

    return NextResponse.json({ ok: true, agent: updatedState });
  } catch (error) {
    console.error("Agent update error:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
