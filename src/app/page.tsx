"use client";

import { useEffect, useState } from "react";
import { ApprovalInbox } from "@/components/approval-inbox";

// ── Types ─────────────────────────────────────────────────
interface Process { name: string; status: string; uptime: string }

interface HomeData {
  daysSincePost: number;
  processes: Process[];
}

const EMPTY: HomeData = {
  daysSincePost: 999,
  processes: [],
};

// ── Helpers ───────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still up";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-[var(--hq-hairline)]" />
    </div>
  );
}

// ── Agents strip ──────────────────────────────────────────
function AgentsStrip({ processes }: { processes: Process[] }) {
  if (processes.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="eyebrow mr-1">System</span>
      {processes.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1.5">
          <span className="relative flex w-1.5 h-1.5">
            {p.status === "online" && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />}
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: p.status === "online" ? "var(--up)" : "var(--down)" }} />
          </span>
          <span className="text-[var(--hq-text-dim)] text-[12px]">{p.name}</span>
          <span className="num text-[var(--hq-text-ghost)] text-[10px]">{p.uptime}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<HomeData>(EMPTY);
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const load = () =>
      fetch("/api/home")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setData(d); })
        .catch(() => {});
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!mounted) return null;

  const stale = data.daysSincePost > 3 && data.daysSincePost < 999;
  const rise = (i: number) => ({ animationDelay: `${i * 60}ms` });

  return (
    <>
      <div className="relative z-10 w-full mx-auto pb-16">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="hq-rise pt-4 pb-10 flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2.5">{greeting()}</div>
            <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Founder"}</h1>
            <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
              {time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {"  ·  "}
              {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {data.daysSincePost < 999 && (
              <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                style={stale
                  ? { color: "var(--hq-warn)", borderColor: "rgba(251,191,36,0.22)", background: "rgba(251,191,36,0.07)" }
                  : { color: "var(--hq-up)", borderColor: "rgba(52,211,153,0.22)", background: "rgba(52,211,153,0.07)" }}>
                <span className="num">{data.daysSincePost === 0 ? "Posted today" : `${data.daysSincePost}d since post`}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--up)" }} />
              </span>
              <span className="eyebrow !text-[9.5px] !text-[var(--hq-text-faint)]">Live</span>
            </div>
          </div>
        </div>

        {/* ── Approval inbox ─────────────────────────────── */}
        <div className="mt-2 grid grid-cols-1 gap-5 items-start">
          <div className="hq-rise" style={rise(6)}>
            <ApprovalInbox />
          </div>
        </div>

        {/* ── Agents strip ────────────────────────────────── */}
        <div className="mt-14">
          <SectionLabel>System</SectionLabel>
          <AgentsStrip processes={data.processes} />
        </div>
      </div>
    </>
  );
}
