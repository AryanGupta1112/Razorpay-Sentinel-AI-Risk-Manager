import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { resolveAgentApproval } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "edit_simulator");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;

    const body = (await request.json()) as {
      status?: "approved" | "rejected";
      note?: string;
    };

    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "A valid approval status is required." }, { status: 400 });
    }

    const { id } = await params;
    const approval = await resolveAgentApproval({
      approvalId: id,
      status: body.status,
      note: body.note,
      actor: session.user.username,
    });

    return NextResponse.json({ ok: true, approval });
  } catch (error) {
    return authErrorResponse(error);
  }
}
