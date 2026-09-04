import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { listCases, runCaseAction } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getRouteSessionOrThrow(request);
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "hold" | "investigate" | "escalate" | "dismiss";
      note?: string;
    };

    if (!body.action) {
      return NextResponse.json({ error: "Missing case action." }, { status: 400 });
    }

    const cases = await listCases();
    const reviewCase = cases.find((entry) => entry.id === id);
    if (!reviewCase) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    ensureCapability(session, "review_alerts", { merchantId: reviewCase.merchantId });

    const result = await runCaseAction({
      caseId: id,
      action: body.action,
      note: body.note,
      actor: session.user.username,
    });
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
