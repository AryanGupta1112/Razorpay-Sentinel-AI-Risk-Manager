import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { confirmVerificationCode } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      requestId?: string;
      username?: string;
      code?: string;
    };

    if (!body.requestId || !body.username || !body.code) {
      return NextResponse.json(
        { error: "Request id, username, and code are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const result = await confirmVerificationCode(body as { requestId: string; username: string; code: string });
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
