import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { authenticateWithPassword } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };

    if (!body.username?.trim() || !body.password) {
      return NextResponse.json(
        { error: "Username and password are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const session = await authenticateWithPassword(body.username, body.password);
    return NextResponse.json({
      ok: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      user: session.user,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
