import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { evaluatePolicy, getConsoleBootstrap } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function GET() {
  try {
    await getRouteSessionOrThrow();
    const { latestPolicyArtifact } = await getConsoleBootstrap();
    return NextResponse.json({ artifact: latestPolicyArtifact });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "promote_policy");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;

    const body = (await request.json()) as {
      threshold?: number;
      autoHoldThreshold?: number;
      stepUpVerification?: boolean;
      velocityClamp?: boolean;
      analystCapacity?: number;
    };

    const artifact = await evaluatePolicy(body);
    return NextResponse.json({ artifact });
  } catch (error) {
    return authErrorResponse(error);
  }
}
