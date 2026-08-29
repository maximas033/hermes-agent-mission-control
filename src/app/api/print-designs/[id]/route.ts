import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["pending", "approved", "rejected", "printing", "done"];

// PATCH: update status (approved|rejected|printing|done) + optional feedback.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const status = (body.status || "").toString();
    if (!VALID_STATUS.includes(status)) {
      return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
    }
    update.status = status;
  }
  if (body.feedback !== undefined) {
    update.feedback = body.feedback ? body.feedback.toString() : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  try {
    const design = await prisma.printDesign.update({ where: { id }, data: update });
    return NextResponse.json({ design });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "design not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

// DELETE: remove a design.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.printDesign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "design not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
