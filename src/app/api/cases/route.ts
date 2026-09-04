import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { getRouteSessionOrThrow } from "@/lib/server/auth";
import { listCases } from "@/lib/server/ops-service";

export async function GET() {
  try {
    await getRouteSessionOrThrow();
    const cases = await listCases();
    return NextResponse.json({ cases });
  } catch (error) {
    return authErrorResponse(error);
  }
}
