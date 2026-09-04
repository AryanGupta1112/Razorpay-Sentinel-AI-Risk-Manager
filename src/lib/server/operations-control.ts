import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OPERATIONS_MODE_COOKIE } from "@/lib/operations-control";

export async function areOperationsHalted() {
  try {
    return (await cookies()).get(OPERATIONS_MODE_COOKIE)?.value === "halted";
  } catch {
    // Background jobs have no browser-controlled operations mode.
    return false;
  }
}

export async function blockIfOperationsHalted() {
  if (!(await areOperationsHalted())) return null;

  return NextResponse.json(
    {
      code: "OPERATIONS_HALTED",
      error: "Operations are halted. Select Continue before making operational changes.",
    },
    { status: 423 },
  );
}
