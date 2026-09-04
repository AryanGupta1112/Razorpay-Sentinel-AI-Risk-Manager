import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/server/auth-route";
import {
  deleteUser,
  ensureCapability,
  getRouteSessionOrThrow,
  listProvisionedUsers,
  provisionUser,
  updateUser,
} from "@/lib/server/auth";
import type { SentinelRole } from "@/types/auth";

const VALID_ROLES: SentinelRole[] = [
  "platform_admin",
  "risk_lead",
  "fraud_ops_analyst",
  "merchant_risk_analyst",
];

export async function GET(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "admin_users");

    const users = await listProvisionedUsers();
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "admin_users");

    const body = (await request.json()) as {
      username?: string;
      email?: string;
      password?: string;
      role?: SentinelRole;
      emailVerified?: boolean;
      merchantScopeIds?: string[];
      isSuperuser?: boolean;
    };

    if (!body.username?.trim() || !body.email?.trim() || !body.password?.trim() || !body.role) {
      return NextResponse.json(
        { error: "Username, email, password, and role are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role selected.", code: "INVALID_ROLE" }, { status: 400 });
    }

    if (body.password.trim().length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long.", code: "WEAK_PASSWORD" },
        { status: 400 },
      );
    }

    const user = await provisionUser({
      username: body.username ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
      role: body.role as SentinelRole,
      emailVerified: body.emailVerified === true,
      merchantScopeIds: body.merchantScopeIds ?? [],
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "admin_users");

    const body = (await request.json()) as {
      userId?: string;
      username?: string;
      email?: string;
      password?: string;
      role?: SentinelRole;
      emailVerified?: boolean;
      merchantScopeIds?: string[];
    };

    if (!body.userId?.trim() || !body.username?.trim() || !body.email?.trim() || !body.role) {
      return NextResponse.json(
        { error: "User id, username, email, and role are required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role selected.", code: "INVALID_ROLE" }, { status: 400 });
    }

    if (body.password && body.password.trim().length > 0 && body.password.trim().length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long.", code: "WEAK_PASSWORD" },
        { status: 400 },
      );
    }

    const user = await updateUser({
      userId: body.userId,
      username: body.username,
      email: body.email,
      password: body.password?.trim() ? body.password : undefined,
      role: body.role as SentinelRole,
      emailVerified: body.emailVerified === true,
      merchantScopeIds: body.merchantScopeIds ?? [],
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getRouteSessionOrThrow(request);
    ensureCapability(session, "admin_users");

    const body = (await request.json()) as { userId?: string };
    if (!body.userId?.trim()) {
      return NextResponse.json(
        { error: "User id is required.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const user = await deleteUser(body.userId, session.user.id);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return authErrorResponse(error);
  }
}
