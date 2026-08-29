import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: list all print designs, newest first.
export async function GET() {
  const designs = await prisma.printDesign.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ designs });
}

// POST: create a new pending print design from a parametric JSON spec.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name || "").toString().trim();
  const geometry = (body.geometry || "").toString();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!geometry) {
    return NextResponse.json({ error: "geometry (JSON spec) is required" }, { status: 400 });
  }

  // Validate that geometry is parseable JSON.
  try {
    JSON.parse(geometry);
  } catch {
    return NextResponse.json({ error: "geometry must be valid JSON" }, { status: 400 });
  }

  const design = await prisma.printDesign.create({
    data: {
      name,
      description: body.description ? body.description.toString() : null,
      author: body.author ? body.author.toString() : "Jarvis",
      status: "pending",
      geometry,
      thumbnail: body.thumbnail ? body.thumbnail.toString() : null,
      accentColor: body.accentColor ? body.accentColor.toString() : "#22D3EE",
    },
  });

  return NextResponse.json({ design }, { status: 201 });
}
