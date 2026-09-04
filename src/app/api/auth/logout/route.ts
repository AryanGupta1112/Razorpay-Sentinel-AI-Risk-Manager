import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSessionByToken, AUTH_COOKIE_NAME } from "@/lib/server/auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  await revokeSessionByToken(token);
  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
