import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { getConsoleBootstrap } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";
import { scopeConsoleData } from "@/lib/server/console-access";

export async function GET(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "view_overview");
    const liveRefresh = request.nextUrl.searchParams.get("live") === "1";
    if (liveRefresh) {
      const halted = await blockIfOperationsHalted();
      if (halted) return halted;
    }
    const result = await getConsoleBootstrap(
      undefined,
      liveRefresh ? { bypassCache: true, enrichAgentReasoning: false } : undefined,
    );
    return NextResponse.json({ data: scopeConsoleData(result.data, session.user) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
