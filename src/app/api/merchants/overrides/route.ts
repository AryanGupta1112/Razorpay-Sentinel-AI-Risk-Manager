import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { listMerchantOverrides, upsertMerchantOverride } from "@/lib/server/ops-service";
import { blockIfOperationsHalted } from "@/lib/server/operations-control";

export async function GET() {
  try {
    await getRouteSessionOrThrow();
    const overrides = await listMerchantOverrides();
    return NextResponse.json({ overrides });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow();
    const halted = await blockIfOperationsHalted();
    if (halted) return halted;
    const body = (await request.json()) as {
      merchantId?: string;
      merchantName?: string;
      strategy?: "strict" | "balanced" | "lenient";
    };

    if (!body.merchantId || !body.merchantName || !body.strategy) {
      return NextResponse.json({ error: "Missing merchant override payload." }, { status: 400 });
    }

    ensureCapability(session, "manage_merchant_overrides", { merchantId: body.merchantId });

    const override = await upsertMerchantOverride({
      merchantId: body.merchantId,
      merchantName: body.merchantName,
      strategy: body.strategy,
    });

    return NextResponse.json({ override });
  } catch (error) {
    return authErrorResponse(error);
  }
}
