import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ───────────────────────────────────────────────────────────
// Hermy HQ · Tasks API
// Backed by Postgres so add/move/delete actually persist.
// One-time seed from Notion (Max's Tasks DB) if reachable;
// after that Postgres is the source of truth.
// ───────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = "1264208d-f768-4604-b4cb-09f4d6fd41e3"; // Max's Tasks DB
const SEED_FLAG = "notion-tasks-seeded";

const VALID_STATUSES = ["Not started", "Approved", "In progress", "Done"];

async function seedFromNotion(): Promise<number> {
  if (!NOTION_API_KEY) return 0;

  try {
    const flag = await prisma.dataStore.findUnique({ where: { key: SEED_FLAG } });
    if (flag?.data === true) return 0;

    const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
      cache: "no-store",
    });
    if (!res.ok) return 0;

    const data = await res.json();
    const results: Array<Record<string, any>> = Array.isArray(data.results) ? data.results : [];

    let seeded = 0;
    for (const page of results) {
      const p = page.properties || {};
      const name = p.Name?.title?.[0]?.plain_text || "";
      if (!name.trim()) continue;
      const status = p.Status?.status?.name || "Not started";
      const priority = p.Priority?.select?.name || "";
      const category = p.Category?.select?.name || "";
      const dueDate = p["Due Date"]?.date?.start || null;

      await prisma.task.upsert({
        where: { id: `notion-${page.id}` },
        update: {}, // never clobber local state; only create if missing
        create: {
          id: `notion-${page.id}`,
          name,
          status: VALID_STATUSES.includes(status) ? status : "Not started",
          priority,
          category,
          dueDate,
          notionId: page.id,
        },
      });
      seeded++;
    }

    await prisma.dataStore.upsert({
      where: { key: SEED_FLAG },
      update: { data: true },
      create: { key: SEED_FLAG, data: true },
    });

    return seeded;
  } catch {
    // Notion unreachable / schema mismatch — Postgres still works standalone.
    return 0;
  }
}

export async function GET(req: NextRequest) {
  try {
    seedFromNotion().catch(() => {}); // non-blocking, best effort

    const url = new URL(req.url);
    const includeDone = url.searchParams.get("includeDone") === "1";

    const tasks = await prisma.task.findMany({
      where: includeDone ? undefined : { status: { not: "Done" } },
      orderBy: [{ createdAt: "asc" }],
    });
    return NextResponse.json({ tasks });
  } catch (e) {
    console.error("Tasks GET error:", e);
    return NextResponse.json(
      { error: "Failed to fetch tasks", detail: String(e).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, status, priority, category, dueDate } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Task name is required" }, { status: 400 });
    }
    const task = await prisma.task.create({
      data: {
        name: String(name).trim(),
        status: VALID_STATUSES.includes(status) ? status : "Not started",
        priority: priority || "",
        category: category || "",
        dueDate: dueDate || null,
      },
    });
    return NextResponse.json({ success: true, task });
  } catch (e) {
    console.error("Tasks POST error:", e);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, name, priority, category, dueDate } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    const data: Record<string, string | null> = {};
    if (typeof status === "string") {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: `Invalid status "${status}"` }, { status: 400 });
      }
      data.status = status;
    }
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof priority === "string") data.priority = priority;
    if (typeof category === "string") data.category = category;
    if (dueDate !== undefined) data.dueDate = dueDate || null;

    const task = await prisma.task.update({ where: { id }, data });
    return NextResponse.json({ success: true, task });
  } catch (e) {
    console.error("Tasks PATCH error:", e);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Tasks DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
