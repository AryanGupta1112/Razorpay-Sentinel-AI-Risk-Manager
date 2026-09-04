import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { saveSimulatorRun } from "@/lib/server/ops-service";
import type { ReplayCohort } from "@/types/risk";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "save_simulator_run");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;

    const body = (await request.json()) as {
      threshold?: number;
      autoHoldThreshold?: number;
      stepUpVerification?: boolean;
      velocityClamp?: boolean;
      analystCapacity?: number;
      replayCohort?: ReplayCohort;
    };

    const result = await saveSimulatorRun(body);
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
