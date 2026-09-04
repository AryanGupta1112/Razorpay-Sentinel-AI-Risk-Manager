export type SentinelRole =
  | "platform_admin"
  | "risk_lead"
  | "fraud_ops_analyst"
  | "merchant_risk_analyst";

export type SentinelCapability =
  | "view_overview"
  | "view_alerts"
  | "review_alerts"
  | "view_transactions"
  | "view_merchants"
  | "manage_merchant_overrides"
  | "view_copilot"
  | "use_copilot"
  | "view_simulator"
  | "edit_simulator"
  | "save_simulator_run"
  | "promote_policy"
  | "view_model_performance"
  | "admin_users"
  | "manage_system";

export type AuthUserRecord = {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: SentinelRole;
  emailVerified: boolean;
  isSuperuser: boolean;
  merchantScopeIds: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type AuthSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type EmailVerificationRequestRecord = {
  requestId: string;
  userId: string;
  code: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type PasswordResetRequestRecord = {
  requestId: string;
  userId: string;
  code: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type AuthStore = {
  version: 1;
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
  emailVerificationRequests: EmailVerificationRequestRecord[];
  passwordResetRequests: PasswordResetRequestRecord[];
};

export type SafeAuthUser = {
  id: string;
  username: string;
  email: string;
  role: SentinelRole;
  emailVerified: boolean;
  isSuperuser: boolean;
  merchantScopeIds: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type SentinelCapabilities = {
  canReviewAlerts: boolean;
  canManageMerchantOverrides: boolean;
  canAccessSimulator: boolean;
  canEditSimulator: boolean;
  canPromotePolicy: boolean;
  canAdminUsers: boolean;
};

export type AuthSessionUser = SafeAuthUser & {
  capabilities: SentinelCapabilities;
};

export type AuthSession = {
  sessionId: string;
  expiresAt: string;
  user: AuthSessionUser;
};

export type AdminUserSummary = SafeAuthUser & {
  roleLabel: string;
};

export type VerificationSendResult =
  | {
      ok: true;
      status: "sent";
      requestId: string;
      expiresAt: string;
      devCode?: string;
    }
  | {
      ok: true;
      status: "already_verified";
    };

export type PasswordResetSendResult = {
  ok: true;
  requestId: string;
  expiresAt: string;
  devCode?: string;
};
