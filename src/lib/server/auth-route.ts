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

  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return NextResponse.json(
      { error: error.message, code: error.code },
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
