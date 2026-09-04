import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import { sendVerificationCode } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: string };
    if (!body.username?.trim()) {
      return NextResponse.json(
        { error: "Username is required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const result = await sendVerificationCode(body.username);
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
