import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { getRouteSessionOrThrow } from "@/lib/server/auth";
import { getConsoleBootstrap } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function GET(request: NextRequest) {
  try {
    await getRouteSessionOrThrow(request);
    const liveRefresh = request.nextUrl.searchParams.get("live") === "1";
    if (liveRefresh) {
      const halted = await blockIfOperationsHalted();
      if (halted) return halted;
    }
    const result = await getConsoleBootstrap(
      undefined,
      liveRefresh ? { bypassCache: true, enrichAgentReasoning: false } : undefined,
    );
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
