import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { getSentinelAnswerWithHistory } from "@/lib/sentinel-assistant";

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "use_copilot");

    const body = (await request.json()) as {
      question?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };
    const history =
      body.history && body.history.length > 0
        ? body.history
        : [{ role: "user" as const, content: body.question?.trim() || "Summarize the current highest-risk cluster." }];
    const response = await getSentinelAnswerWithHistory(history);

    return NextResponse.json({
      ...response,
      viewerRole: session.user.role,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
