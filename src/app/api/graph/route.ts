import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { getConsoleBootstrap, refreshGraphSnapshot } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function GET() {
  try {
    await getRouteSessionOrThrow();
    const { latestGraphSnapshot } = await getConsoleBootstrap();
    return NextResponse.json({ graph: latestGraphSnapshot });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST() {
  try {
    const session = await getRouteSessionOrThrow();
    ensureCapability(session, "edit_simulator");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;
    const graph = await refreshGraphSnapshot();
    return NextResponse.json({ graph });
  } catch (error) {
    return authErrorResponse(error);
  }
}
