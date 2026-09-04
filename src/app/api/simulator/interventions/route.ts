import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { appendSimulatorIntervention } from "@/lib/server/ops-service";
import type { ReplayCohort } from "@/types/risk";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "edit_simulator");
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;

    const body = (await request.json()) as {
      tick?: number;
      targetType?: "merchant" | "cluster" | "payment" | "policy";
      targetId?: string;
      targetLabel?: string;
      action?: string;
      effect?: string;
      nextConfig?: {
        threshold?: number;
        autoHoldThreshold?: number;
        stepUpVerification?: boolean;
        velocityClamp?: boolean;
        analystCapacity?: number;
      };
      nextReplayCohort?: ReplayCohort;
      merchantOverride?: {
        merchantId?: string;
        merchantName?: string;
        strategy?: "strict" | "balanced" | "lenient";
      };
    };

    if (
      typeof body.tick !== "number" ||
      !body.targetType ||
      !body.targetId ||
      !body.targetLabel ||
      !body.action ||
      !body.effect
    ) {
      return NextResponse.json({ error: "Missing simulator intervention payload." }, { status: 400 });
    }

    const result = await appendSimulatorIntervention({
      tick: body.tick,
      actor: session.user.username,
      targetType: body.targetType,
      targetId: body.targetId,
      targetLabel: body.targetLabel,
      action: body.action,
      effect: body.effect,
      nextConfig: body.nextConfig,
      nextReplayCohort: body.nextReplayCohort,
      merchantOverride:
        body.merchantOverride?.merchantId &&
        body.merchantOverride?.merchantName &&
        body.merchantOverride?.strategy
          ? {
              merchantId: body.merchantOverride.merchantId,
              merchantName: body.merchantOverride.merchantName,
              strategy: body.merchantOverride.strategy,
            }
          : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
