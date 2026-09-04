import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { ensureCapability, getRouteSessionOrThrow } from "@/lib/server/auth";
import { listCases } from "@/lib/server/ops-service";
import { canAccessMerchant } from "@/lib/authorization";

export async function GET() {
  try {
    const session = await getRouteSessionOrThrow();
    ensureCapability(session, "view_alerts");
    const cases = await listCases();
    return NextResponse.json({
      cases: cases.filter((reviewCase) => canAccessMerchant(session.user, reviewCase.merchantId)),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
