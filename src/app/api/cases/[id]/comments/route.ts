import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { addCaseComment, listCases, listComments } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getRouteSessionOrThrow(_request);
    const { id } = await context.params;
    const cases = await listCases();
    const reviewCase = cases.find((entry) => entry.id === id);
    if (!reviewCase) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    ensureCapability(session, "view_alerts", { merchantId: reviewCase.merchantId });
    const comments = await listComments(id);
    return NextResponse.json({ comments });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getRouteSessionOrThrow(request);
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;
    const { id } = await context.params;
    const body = (await request.json()) as { content?: string };

    if (!body.content?.trim()) {
      return NextResponse.json({ error: "Missing comment content." }, { status: 400 });
    }

    const cases = await listCases();
    const reviewCase = cases.find((entry) => entry.id === id);
    if (!reviewCase) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    ensureCapability(session, "review_alerts", { merchantId: reviewCase.merchantId });

    const comment = await addCaseComment({
      caseId: id,
      author: session.user.username,
      content: body.content,
    });
    return NextResponse.json({ comment });
  } catch (error) {
    return authErrorResponse(error);
  }
}
