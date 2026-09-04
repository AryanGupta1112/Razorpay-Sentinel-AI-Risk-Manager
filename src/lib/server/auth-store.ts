import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { getRuntimeStoreDirectory } from "@/lib/server/runtime-storage";
import { getCapabilities, hasCapability } from "@/lib/authorization";
import type {
  AdminUserSummary,
  AuthStore,
  AuthUserRecord,
  EmailVerificationRequestRecord,
  PasswordResetRequestRecord,
  SafeAuthUser,
  SentinelRole,
} from "@/types/auth";

const STORE_DIR = getRuntimeStoreDirectory();
const STORE_PATH = path.join(STORE_DIR, "auth-store.json");

const NON_ADMIN_VERIFICATION_REQUIRED =
  process.env.NODE_ENV === "production" ||
  process.env.AUTH_REQUIRE_VERIFICATION_FOR_NON_ADMINS !== "false";

function nowIso() {
  return new Date().toISOString();
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, expected] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const derived = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"));
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function seedUser(input: {
  id: string;
  username: string;
  email: string;
  password: string;
  role: SentinelRole;
  emailVerified: boolean;
  isSuperuser?: boolean;
  merchantScopeIds?: string[];
}): AuthUserRecord {
  const timestamp = nowIso();
  return {
    id: input.id,
    username: input.username,
    email: input.email,
    passwordHash: passwordHash(input.password),
    role: input.role,
    emailVerified: input.emailVerified,
    isSuperuser: input.isSuperuser ?? false,
    merchantScopeIds: input.merchantScopeIds ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
  };
}

export function roleLabel(role: SentinelRole) {
  if (role === "platform_admin") return "Platform Admin";
  if (role === "risk_lead") return "Risk Lead";
  if (role === "fraud_ops_analyst") return "Fraud Ops Analyst";
  return "Merchant Risk Analyst";
}

function createInitialStore(): AuthStore {
  return {
    version: 1,
    users: [
      seedUser({
        id: "usr_platform_admin",
        username: "platform_admin",
        email: "platform.admin@sentinel.local",
        password: "SentinelAdmin!2026",
        role: "platform_admin",
        emailVerified: true,
        isSuperuser: true,
      }),
      seedUser({
        id: "usr_risk_lead",
        username: "risk_lead",
        email: "risk.lead@sentinel.local",
        password: "RiskLead!2026",
        role: "risk_lead",
        emailVerified: false,
      }),
      seedUser({
        id: "usr_fraud_ops",
        username: "fraud_ops",
        email: "fraud.ops@sentinel.local",
        password: "FraudOps!2026",
        role: "fraud_ops_analyst",
        emailVerified: false,
      }),
      seedUser({
        id: "usr_merchant_risk",
        username: "merchant_risk",
        email: "merchant.risk@sentinel.local",
        password: "MerchantRisk!2026",
        role: "merchant_risk_analyst",
        emailVerified: false,
        merchantScopeIds: ["M_QUICKBASKET", "M_VYRA"],
      }),
    ],
    sessions: [],
    emailVerificationRequests: [],
    passwordResetRequests: [],
  };
}

async function ensureStoreFile() {
  await mkdir(STORE_DIR, { recursive: true });

  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(createInitialStore(), null, 2), "utf8");
  }
}

export async function readAuthStore(): Promise<AuthStore> {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<AuthStore>;

  return {
    version: 1,
    users: parsed.users ?? [],
    sessions: parsed.sessions ?? [],
    emailVerificationRequests: parsed.emailVerificationRequests ?? [],
    passwordResetRequests: parsed.passwordResetRequests ?? [],
  };
}

async function writeAuthStore(store: AuthStore) {
  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function withAuthStore<T>(mutate: (store: AuthStore) => Promise<T> | T): Promise<T> {
  const store = await readAuthStore();
  const result = await mutate(store);
  await writeAuthStore(store);
  return result;
}

export function toSafeUser(user: AuthUserRecord): SafeAuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.isSuperuser ? "platform_admin" : user.role,
    emailVerified: user.emailVerified,
    isSuperuser: user.isSuperuser,
    merchantScopeIds: user.merchantScopeIds,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function requiresEmailVerification(user: AuthUserRecord) {
  if (!NON_ADMIN_VERIFICATION_REQUIRED) return false;
  if (user.isSuperuser) return false;
  return !user.emailVerified;
}

export { getCapabilities, hasCapability };

function createNumericCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createRequestId(prefix: "verify" | "reset") {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function createVerificationRequest(userId: string): EmailVerificationRequestRecord {
  const createdAt = nowIso();
  return {
    requestId: createRequestId("verify"),
    userId,
    code: createNumericCode(),
    expiresAt: addHours(new Date(), 0.5).toISOString(),
    usedAt: null,
    createdAt,
  };
}

export function createPasswordResetRequest(userId: string): PasswordResetRequestRecord {
  const createdAt = nowIso();
  return {
    requestId: createRequestId("reset"),
    userId,
    code: createNumericCode(),
    expiresAt: addHours(new Date(), 0.5).toISOString(),
    usedAt: null,
    createdAt,
  };
}

function sanitizeScopeIds(scopeIds: string[] | undefined) {
  return (scopeIds ?? [])
    .map((scopeId) => scopeId.trim())
    .filter(Boolean)
    .map((scopeId) => scopeId.toUpperCase());
}

export function listAdminUsers(store: AuthStore): AdminUserSummary[] {
  return store.users
    .slice()
    .sort((left, right) => left.username.localeCompare(right.username))
    .map((user) => ({
      ...toSafeUser(user),
      roleLabel: roleLabel(user.isSuperuser ? "platform_admin" : user.role),
    }));
}

export function createProvisionedUser(
  store: AuthStore,
  input: {
    username: string;
    email: string;
    password: string;
    role: SentinelRole;
    merchantScopeIds?: string[];
    isSuperuser?: boolean;
  },
) {
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  if (!username) {
    throw new Error("Username is required.");
  }

  if (!email) {
    throw new Error("Email is required.");
  }

  if (store.users.some((user) => user.username.toLowerCase() === username)) {
    throw new Error("A user with that username already exists.");
  }

  if (store.users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("A user with that email already exists.");
  }

  const user = seedUser({
    id: `usr_${randomBytes(8).toString("hex")}`,
    username,
    email,
    password: input.password,
    role: input.role,
    emailVerified: input.isSuperuser === true,
    isSuperuser: input.isSuperuser ?? false,
    merchantScopeIds: sanitizeScopeIds(input.merchantScopeIds),
  });

  store.users.push(user);
  return {
    ...toSafeUser(user),
    roleLabel: roleLabel(user.isSuperuser ? "platform_admin" : user.role),
  };
}

export function updateProvisionedUser(
  store: AuthStore,
  input: {
    userId: string;
    username: string;
    email: string;
    role: SentinelRole;
    merchantScopeIds?: string[];
    password?: string;
  },
) {
  const user = store.users.find((entry) => entry.id === input.userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  if (!username) {
    throw new Error("Username is required.");
  }

  if (!email) {
    throw new Error("Email is required.");
  }

  if (
    store.users.some((entry) => entry.id !== user.id && entry.username.toLowerCase() === username)
  ) {
    throw new Error("A user with that username already exists.");
  }

  if (store.users.some((entry) => entry.id !== user.id && entry.email.toLowerCase() === email)) {
    throw new Error("A user with that email already exists.");
  }

  const nextRole = input.role;
  const nextScopeIds =
    nextRole === "merchant_risk_analyst" ? sanitizeScopeIds(input.merchantScopeIds) : [];
  const nextIsSuperuser = user.isSuperuser && nextRole === "platform_admin";
  const nextEmailVerified = nextIsSuperuser ? true : user.emailVerified;
  const nextPassword = input.password?.trim() ?? "";

  if (nextPassword && nextPassword.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const timestamp = nowIso();
  const accessChanged =
    user.role !== nextRole ||
    user.isSuperuser !== nextIsSuperuser ||
    user.emailVerified !== nextEmailVerified ||
    JSON.stringify(user.merchantScopeIds) !== JSON.stringify(nextScopeIds);

  user.username = username;
  user.email = email;
  user.role = nextRole;
  user.isSuperuser = nextIsSuperuser;
  user.emailVerified = nextEmailVerified;
  user.merchantScopeIds = nextScopeIds;
  user.updatedAt = timestamp;

  if (nextPassword) {
    user.passwordHash = passwordHash(nextPassword);
  }

  if (accessChanged || nextPassword) {
    store.sessions.forEach((session) => {
      if (session.userId === user.id && session.revokedAt === null) {
        session.revokedAt = timestamp;
        session.updatedAt = timestamp;
      }
    });
  }

  return {
    ...toSafeUser(user),
    roleLabel: roleLabel(user.isSuperuser ? "platform_admin" : user.role),
  };
}
