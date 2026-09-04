import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { clearSessionCookie, getRouteSessionOrThrow } from "@/lib/server/auth";

export async function GET() {
  try {
    const session = await getRouteSessionOrThrow();
    return NextResponse.json({
      ok: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      user: session.user,
    });
  } catch (error) {
    await clearSessionCookie();
    return authErrorResponse(error);
  }
}
