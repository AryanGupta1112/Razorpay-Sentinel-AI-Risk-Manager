import { NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth";

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details ?? {}),
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: "Unexpected server error.",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
