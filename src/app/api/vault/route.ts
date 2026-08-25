import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

type Kind = "link" | "tag" | "mention";
const RANK: Record<Kind, number> = { link: 3, tag: 2, mention: 1 };
const CAPS: Record<Kind, number> = { link: Infinity, tag: 320, mention: 220 };

/** Inline #tags in body text (letters first, allow / - _, min length 3). */
function extractTags(body: string): Set<string> {
  const out = new Set<string>();
  const re = /(^|[\s(])#([A-Za-z][A-Za-z0-9/_-]{2,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[2].toLowerCase());
  return out;
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

  const seen = new Map<string, Kind>(); // "a|b" -> strongest kind
  const addEdge = (a: string, b: string, kind: Kind) => {
    if (a === b) return;
    const key = [a, b].sort().join("|");
    const cur = seen.get(key);
    if (!cur || RANK[kind] > RANK[cur]) seen.set(key, kind);
  };

  // 1) explicit wikilinks
  for (const n of nodes) {
    for (const raw of n.links || []) {
      const cleaned: string = (raw || "").replace(/^\.\.\//, "").replace(/\.md$/, "").trim();
      if (!cleaned) continue;
      let tid = byId.get(cleaned.toLowerCase());
      if (!tid) tid = byId.get(cleaned.split("/").pop()!.toLowerCase());
      if (tid && tid !== n.id) addEdge(n.id, tid, "link");
    }
  }

  // 2) shared inline tags
  const tagsByNode = new Map<string, Set<string>>();
  const notesWithTag = new Map<string, string[]>();
  for (const n of nodes) {
    const tags = extractTags(n.body);
    tagsByNode.set(n.id, tags);
    for (const t of tags) {
      const arr = notesWithTag.get(t) ?? [];
      arr.push(n.id);
      notesWithTag.set(t, arr);
    }
  }
  const tagPairCount = new Map<string, number>();
  for (const [, members] of notesWithTag) {
    if (members.length < 2 || members.length > 40) continue; // skip mega-tags
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++) {
        const key = [members[i], members[j]].sort().join("|");
        tagPairCount.set(key, (tagPairCount.get(key) ?? 0) + 1);
      }
  }

  // 3) title mentions in body (titles >= 4 chars to avoid noise)
  const mentionHits = new Map<string, number>();
  const titles = nodes
    .filter((n) => n.title.length >= 4)
    .map((n) => ({ id: n.id, re: new RegExp(`\\b${escRe(n.title)}\\b`, "i") }));
  for (const n of nodes) {
    const bodyLower = n.body;
    for (const t of titles) {
      if (t.id === n.id) continue;
      if (t.re.test(bodyLower)) {
        const key = [n.id, t.id].sort().join("|");
        mentionHits.set(key, (mentionHits.get(key) ?? 0) + 1);
      }
    }
  }

  const pick = (
    hits: Map<string, number>,
    kind: Kind,
    cap: number
  ) => {
    const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap);
    for (const [key] of sorted) {
      const [a, b] = key.split("|");
      addEdge(a, b, kind);
    }
  };
  pick(tagPairCount, "tag", CAPS.tag);
  pick(mentionHits, "mention", CAPS.mention);

  const edges = [...seen.entries()].map(([key, kind]) => {
    const [source, target] = key.split("|");
    return { source, target, kind };
  });

  return NextResponse.json({ nodes: graphNodes, edges });
}
