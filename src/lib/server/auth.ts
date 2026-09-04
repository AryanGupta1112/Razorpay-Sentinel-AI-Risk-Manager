import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  createPasswordResetRequest,
  createProvisionedUser,
  createSessionToken,
  createVerificationRequest,
  getCapabilities,
  hashToken,
  hasCapability,
  listAdminUsers,
  passwordHash,
  readAuthStore,
  requiresEmailVerification,
  roleLabel,
  toSafeUser,
  updateProvisionedUser,
  verifyPassword,
  withAuthStore,
} from "@/lib/server/auth-store";
import type {
  AdminUserSummary,
  AuthSession,
  AuthUserRecord,
  PasswordResetSendResult,
  SafeAuthUser,
  SentinelCapability,
  SentinelRole,
  VerificationSendResult,
} from "@/types/auth";
import { canAccessMerchant } from "@/lib/authorization";

export const AUTH_COOKIE_NAME = "sentinel_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DJANGO_AUTH_API_BASE_URL = process.env.DJANGO_AUTH_API_BASE_URL?.replace(/\/+$/, "") ?? "";

function shouldUseSecureCookie() {
  return process.env.AUTH_COOKIE_SECURE === "true";
}

function shouldUseDjangoAuthBackend() {
  return DJANGO_AUTH_API_BASE_URL.length > 0;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function shouldExposeCodes() {
  return process.env.NODE_ENV !== "production" || process.env.AUTH_EXPOSE_CODES === "true";
}

function userWithCapabilities(user: SafeAuthUser) {
  return {
    ...user,
    capabilities: getCapabilities(user.role),
  };
}

async function readCookieToken(request?: NextRequest) {
  if (request) {
    return request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
  }

  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
}

async function readRemoteError(response: Response) {
  let payload: Record<string, unknown> = {};

  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // Some upstream failures have an empty or non-JSON response body.
  }

  const message =
    typeof payload.error === "string"
      ? payload.error
      : typeof payload.detail === "string"
        ? payload.detail
        : `Authentication backend request failed with HTTP ${response.status}.`;

  throw new AuthError(
    message,
    response.status,
    typeof payload.code === "string" ? payload.code : `REMOTE_AUTH_${response.status}`,
    payload,
  );
}

async function djangoRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string | null;
    body?: Record<string, unknown>;
  },
) {
  let response: Response;

  try {
    response = await fetch(`${DJANGO_AUTH_API_BASE_URL}/${path.replace(/^\/+/, "")}`, {
      method: options?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Token ${options.token}` } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new AuthError(
      "Authentication backend is unavailable. Start the Django server on http://127.0.0.1:8000 or remove DJANGO_AUTH_API_BASE_URL from .env.local to use local auth.",
      503,
      "AUTH_BACKEND_UNAVAILABLE",
      {
        backendUrl: DJANGO_AUTH_API_BASE_URL,
      },
    );
  }

  if (!response.ok) {
    await readRemoteError(response);
  }

  return (await response.json()) as T;
}

async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    expires: new Date(0),
  });
}

async function createSessionForUser(user: AuthUserRecord) {
  const token = createSessionToken();
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();

  await withAuthStore(async (store) => {
    user.lastLoginAt = createdAt;
    user.updatedAt = createdAt;
    store.sessions = store.sessions.filter((session) => session.userId !== user.id || session.revokedAt !== null);
    store.sessions.push({
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt,
      updatedAt: createdAt,
      expiresAt,
      revokedAt: null,
    });
  });

  await setSessionCookie(token);

  return {
    token,
    sessionId,
    expiresAt,
    user: userWithCapabilities(toSafeUser(user)),
  };
}

export async function revokeSessionByToken(token: string | null) {
  if (!token) return;

  if (shouldUseDjangoAuthBackend()) {
    try {
      await djangoRequest("auth/logout", { method: "POST", token });
    } catch {
      // noop
    }
    return;
  }

  const tokenHash = hashToken(token);

  await withAuthStore(async (store) => {
    const session = store.sessions.find((entry) => entry.tokenHash === tokenHash && entry.revokedAt === null);
    if (session) {
      session.revokedAt = new Date().toISOString();
      session.updatedAt = session.revokedAt;
    }
  });
}

async function getSession(request?: NextRequest): Promise<AuthSession | null> {
  const token = await readCookieToken(request);
  if (!token) return null;

  if (shouldUseDjangoAuthBackend()) {
    try {
      const payload = await djangoRequest<AuthSession & { ok: boolean }>("auth/me", { token });
      return {
        sessionId: payload.sessionId,
        expiresAt: payload.expiresAt,
        user: payload.user,
      };
    } catch (error) {
      if (error instanceof AuthError && (error.status === 401 || error.status === 403 || error.status === 503)) {
        return null;
      }
      throw error;
    }
  }

  const store = await readAuthStore();
  const session = store.sessions.find((entry) => entry.tokenHash === hashToken(token));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = store.users.find((entry) => entry.id === session.userId);
  if (!user) return null;
  if (requiresEmailVerification(user)) {
    await withAuthStore(async (currentStore) => {
      const currentSession = currentStore.sessions.find((entry) => entry.id === session.id);
      if (currentSession && currentSession.revokedAt === null) {
        currentSession.revokedAt = new Date().toISOString();
        currentSession.updatedAt = currentSession.revokedAt;
      }
    });
    return null;
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: userWithCapabilities(toSafeUser(user)),
  };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireGuest() {
  const session = await getSession();
  if (session) {
    redirect("/overview");
  }
}

export function ensureCapability(
  session: AuthSession,
  capability: SentinelCapability,
  options?: { merchantId?: string | null },
) {
  if (!hasCapability(session.user.role, capability)) {
    throw new AuthError("You do not have access to that action.", 403, "FORBIDDEN");
  }

  if (
    session.user.role === "merchant_risk_analyst" &&
    options?.merchantId &&
    !canAccessMerchant(session.user, options.merchantId)
  ) {
    throw new AuthError("That merchant is outside your review scope.", 403, "OUT_OF_SCOPE", {
      merchantId: options.merchantId,
    });
  }
}

export async function getRouteSessionOrThrow(request?: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    throw new AuthError("Authentication required.", 401, "UNAUTHENTICATED");
  }
  return session;
}

export async function authenticateWithPassword(username: string, password: string) {
  if (shouldUseDjangoAuthBackend()) {
    const session = await djangoRequest<
      AuthSession & {
        ok: true;
        token: string;
      }
    >("auth/login", {
      method: "POST",
      body: { username, password },
    });
    await setSessionCookie(session.token);
    return session;
  }

  const store = await readAuthStore();
  const user = store.users.find(
    (entry) => entry.username.toLowerCase() === username.trim().toLowerCase(),
  );

  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AuthError("Invalid username or password.", 401, "INVALID_CREDENTIALS");
  }

  if (requiresEmailVerification(user)) {
    throw new AuthError("Email verification is required before login.", 403, "VERIFICATION_REQUIRED", {
      verificationRequired: true,
      username: user.username,
    });
  }

  return createSessionForUser(user);
}

export async function sendVerificationCode(username: string): Promise<VerificationSendResult> {
  if (shouldUseDjangoAuthBackend()) {
    return djangoRequest<VerificationSendResult>("auth/verify/send", {
      method: "POST",
      body: { username },
    });
  }

  return withAuthStore(async (store) => {
    const user = store.users.find(
      (entry) => entry.username.toLowerCase() === username.trim().toLowerCase(),
    );

    if (!user) {
      throw new AuthError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
    }

    if (!user.email) {
      throw new AuthError("This account does not have an email address.", 409, "EMAIL_MISSING");
    }

    if (user.emailVerified) {
      return { ok: true, status: "already_verified" };
    }

    const request = createVerificationRequest(user.id);
    store.emailVerificationRequests.unshift(request);
    store.emailVerificationRequests = store.emailVerificationRequests.slice(0, 40);

    return {
      ok: true,
      status: "sent",
      requestId: request.requestId,
      expiresAt: request.expiresAt,
      devCode: shouldExposeCodes() ? request.code : undefined,
    };
  });
}

export async function confirmVerificationCode(input: {
  requestId: string;
  username: string;
  code: string;
}) {
  if (shouldUseDjangoAuthBackend()) {
    return djangoRequest<{ ok: true; user: AuthSession["user"] }>("auth/verify/confirm", {
      method: "POST",
      body: input,
    });
  }

  return withAuthStore(async (store) => {
    const user = store.users.find(
      (entry) => entry.username.toLowerCase() === input.username.trim().toLowerCase(),
    );
    if (!user) {
      throw new AuthError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
    }

    const request = store.emailVerificationRequests.find((entry) => entry.requestId === input.requestId);
    if (!request || request.userId !== user.id) {
      throw new AuthError("Verification request not found.", 404, "REQUEST_NOT_FOUND");
    }

    if (request.usedAt) {
      throw new AuthError("This verification code has already been used.", 409, "REQUEST_USED");
    }

    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      throw new AuthError("This verification code has expired.", 409, "REQUEST_EXPIRED");
    }

    if (request.code !== input.code.trim()) {
      throw new AuthError("Incorrect verification code.", 400, "INVALID_CODE");
    }

    const timestamp = new Date().toISOString();
    request.usedAt = timestamp;
    user.emailVerified = true;
    user.updatedAt = timestamp;

    return {
      ok: true,
      user: userWithCapabilities(toSafeUser(user)),
    };
  });
}

export async function sendPasswordReset(username: string): Promise<PasswordResetSendResult> {
  if (shouldUseDjangoAuthBackend()) {
    return djangoRequest<PasswordResetSendResult>("auth/forgot", {
      method: "POST",
      body: { username },
    });
  }

  return withAuthStore(async (store) => {
    const user = store.users.find(
      (entry) => entry.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!user) {
      throw new AuthError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
    }

    if (!user.email) {
      throw new AuthError("This account does not have an email address.", 409, "EMAIL_MISSING");
    }

    if (!user.emailVerified) {
      throw new AuthError("Verify the email before requesting a password reset.", 409, "EMAIL_NOT_VERIFIED");
    }

    const request = createPasswordResetRequest(user.id);
    store.passwordResetRequests.unshift(request);
    store.passwordResetRequests = store.passwordResetRequests.slice(0, 40);

    return {
      ok: true,
      requestId: request.requestId,
      expiresAt: request.expiresAt,
      devCode: shouldExposeCodes() ? request.code : undefined,
    };
  });
}

function ensureStrongPassword(password: string) {
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters long.", 400, "WEAK_PASSWORD");
  }
}

export async function resetPassword(input: {
  requestId: string;
  code: string;
  newPassword: string;
}) {
  if (shouldUseDjangoAuthBackend()) {
    return djangoRequest<{ ok: true; user: AuthSession["user"] }>("auth/reset", {
      method: "POST",
      body: input,
    });
  }

  ensureStrongPassword(input.newPassword);

  return withAuthStore(async (store) => {
    const request = store.passwordResetRequests.find((entry) => entry.requestId === input.requestId);
    if (!request) {
      throw new AuthError("Password reset request not found.", 404, "REQUEST_NOT_FOUND");
    }

    if (request.usedAt) {
      throw new AuthError("This password reset code has already been used.", 409, "REQUEST_USED");
    }

    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      throw new AuthError("This password reset code has expired.", 409, "REQUEST_EXPIRED");
    }

    if (request.code !== input.code.trim()) {
      throw new AuthError("Incorrect reset code.", 400, "INVALID_CODE");
    }

    const user = store.users.find((entry) => entry.id === request.userId);
    if (!user) {
      throw new AuthError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
    }

    const timestamp = new Date().toISOString();
    request.usedAt = timestamp;
    user.passwordHash = passwordHash(input.newPassword);
    user.updatedAt = timestamp;

    store.sessions.forEach((session) => {
      if (session.userId === user.id && session.revokedAt === null) {
        session.revokedAt = timestamp;
        session.updatedAt = timestamp;
      }
    });

    return {
      ok: true,
      user: userWithCapabilities(toSafeUser(user)),
    };
  });
}

export async function listProvisionedUsers() {
  if (shouldUseDjangoAuthBackend()) {
    const token = await readCookieToken();
    const payload = await djangoRequest<{ ok: true; users: AdminUserSummary[] }>("users", { token });
    return payload.users;
  }

  return withAuthStore(async (store) => listAdminUsers(store));
}

export async function provisionUser(input: {
  username: string;
  email: string;
  password: string;
  role: SentinelRole;
  merchantScopeIds?: string[];
}) {
  if (shouldUseDjangoAuthBackend()) {
    const token = await readCookieToken();
    const payload = await djangoRequest<{ ok: true; user: AdminUserSummary }>("users", {
      method: "POST",
      token,
      body: input,
    });
    return payload.user;
  }

  return withAuthStore(async (store) => {
    try {
      return createProvisionedUser(store, input);
    } catch (error) {
      throw new AuthError(
        error instanceof Error ? error.message : "Could not provision user.",
        409,
        "USER_CONFLICT",
      );
    }
  });
}

export async function updateUser(input: {
  userId: string;
  username: string;
  email: string;
  role: SentinelRole;
  merchantScopeIds?: string[];
  password?: string;
}) {
  if (shouldUseDjangoAuthBackend()) {
    const token = await readCookieToken();
    const payload = await djangoRequest<{ ok: true; user: AdminUserSummary }>("users", {
      method: "PATCH",
      token,
      body: input,
    });
    return payload.user;
  }

  return withAuthStore(async (store) => {
    try {
      return updateProvisionedUser(store, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update user.";
      const code =
        message === "User not found."
          ? "USER_NOT_FOUND"
          : message.includes("username")
            ? "USERNAME_CONFLICT"
            : message.includes("email")
              ? "EMAIL_CONFLICT"
              : message.includes("Password")
                ? "WEAK_PASSWORD"
                : "USER_UPDATE_FAILED";
      const status = message === "User not found." ? 404 : code === "WEAK_PASSWORD" ? 400 : 409;
      throw new AuthError(message, status, code);
    }
  });
}

export async function deleteUser(userId: string, actorUserId: string) {
  if (shouldUseDjangoAuthBackend()) {
    const token = await readCookieToken();
    const payload = await djangoRequest<{ ok: true; user: AdminUserSummary }>("users", {
      method: "DELETE",
      token,
      body: { userId },
    });
    return payload.user;
  }

  return withAuthStore(async (store) => {
    const user = store.users.find((entry) => entry.id === userId);
    if (!user) {
      throw new AuthError("User not found.", 404, "USER_NOT_FOUND");
    }

    if (user.id === actorUserId) {
      throw new AuthError(
        "You cannot delete the account you are currently using.",
        409,
        "CANNOT_DELETE_SELF",
      );
    }

    const isPlatformAdmin = user.isSuperuser || user.role === "platform_admin";
    const platformAdminCount = store.users.filter(
      (entry) => entry.isSuperuser || entry.role === "platform_admin",
    ).length;
    if (isPlatformAdmin && platformAdminCount <= 1) {
      throw new AuthError(
        "The final Platform Admin account cannot be deleted.",
        409,
        "LAST_PLATFORM_ADMIN",
      );
    }

    const deletedUser: AdminUserSummary = {
      ...toSafeUser(user),
      roleLabel: roleLabel(user.isSuperuser ? "platform_admin" : user.role),
    };
    store.users = store.users.filter((entry) => entry.id !== user.id);
    store.sessions = store.sessions.filter((session) => session.userId !== user.id);
    store.emailVerificationRequests = store.emailVerificationRequests.filter(
      (request) => request.userId !== user.id,
    );
    store.passwordResetRequests = store.passwordResetRequests.filter(
      (request) => request.userId !== user.id,
    );

    return deletedUser;
  });
}
