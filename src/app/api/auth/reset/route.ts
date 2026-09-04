import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { clearSessionCookie, resetPassword } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      requestId?: string;
      code?: string;
      newPassword?: string;
    };

    if (!body.requestId || !body.code || !body.newPassword) {
      return NextResponse.json(
        { error: "Request id, code, and new password are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const result = await resetPassword(body as { requestId: string; code: string; newPassword: string });
    await clearSessionCookie();
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
