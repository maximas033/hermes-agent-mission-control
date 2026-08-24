import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET() {
  const nodes = await prisma.vaultNode.findMany({
    select: { id: true, title: true, folder: true, body: true, links: true, path: true },
    orderBy: { folder: "asc" },
  });

  // Build id -> node map; normalize link targets (strip leading ../ and .md)
  const byId = new Map<string, string>();
  for (const n of nodes) byId.set(n.id.toLowerCase(), n.id);

  const graphNodes = nodes.map((n) => ({
    id: n.id,
    title: n.title,
    folder: n.folder,
    path: n.path,
    preview: n.body.replace(/^#.*$/m, "").slice(0, 400).replace(/\n+/g, " ").trim(),
  }));

  const edges: { source: string; target: string }[] = [];
  const seenEdge = new Set<string>();
  for (const n of nodes) {
    for (const raw of n.links || []) {
      const cleaned: string = (raw || "").replace(/^\.\.\//, "").replace(/\.md$/, "").trim();
      if (!cleaned) continue;
      const target: string = cleaned;
      // try exact, then basename match
      let tid = byId.get(target.toLowerCase());
      if (!tid) {
        const base = target.split("/").pop()!.toLowerCase();
        tid = byId.get(base);
      }
      if (tid && tid !== n.id) {
        const key = [n.id, tid].sort().join("|");
        if (!seenEdge.has(key)) { seenEdge.add(key); edges.push({ source: n.id, target: tid }); }
      }
    }
  }

  return NextResponse.json({ nodes: graphNodes, edges });
}
