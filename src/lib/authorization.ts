import type {
  AuthSessionUser,
  SentinelCapability,
  SentinelCapabilities,
  SentinelRole,
} from "@/types/auth";
import type { ConsoleScreen } from "@/lib/console-adapters";

const SCREEN_CAPABILITY: Record<ConsoleScreen, SentinelCapability> = {
  overview: "view_overview",
  alerts: "view_alerts",
  transactions: "view_transactions",
  merchants: "view_merchants",
  copilot: "view_copilot",
  "control-room": "view_control_room",
  simulator: "view_simulator",
  admin: "admin_users",
};

const ROLE_CAPABILITIES: Record<SentinelRole, ReadonlySet<SentinelCapability>> = {
  platform_admin: new Set([
    "view_overview",
    "view_alerts",
    "review_alerts",
    "view_transactions",
    "view_merchants",
    "manage_merchant_overrides",
    "view_copilot",
    "use_copilot",
    "view_control_room",
    "view_simulator",
    "edit_simulator",
    "save_simulator_run",
    "promote_policy",
    "view_model_performance",
    "admin_users",
    "manage_system",
  ]),
  risk_lead: new Set([
    "view_overview",
    "view_alerts",
    "review_alerts",
    "view_transactions",
    "view_merchants",
    "manage_merchant_overrides",
    "view_copilot",
    "use_copilot",
    "view_control_room",
    "view_simulator",
    "edit_simulator",
    "save_simulator_run",
    "promote_policy",
    "view_model_performance",
  ]),
  fraud_ops_analyst: new Set([
    "view_overview",
    "view_alerts",
    "review_alerts",
    "view_transactions",
    "view_merchants",
    "view_copilot",
    "use_copilot",
    "view_control_room",
    "view_simulator",
    "view_model_performance",
  ]),
  merchant_risk_analyst: new Set([
    "view_overview",
    "view_alerts",
    "review_alerts",
    "view_transactions",
    "view_merchants",
    "manage_merchant_overrides",
  ]),
};

export function hasCapability(role: SentinelRole, capability: SentinelCapability) {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function getCapabilities(role: SentinelRole): SentinelCapabilities {
  return {
    canReviewAlerts: hasCapability(role, "review_alerts"),
    canManageMerchantOverrides: hasCapability(role, "manage_merchant_overrides"),
    canUseCopilot: hasCapability(role, "use_copilot"),
    canAccessControlRoom: hasCapability(role, "view_control_room"),
    canAccessSimulator: hasCapability(role, "view_simulator"),
    canEditSimulator: hasCapability(role, "edit_simulator"),
    canPromotePolicy: hasCapability(role, "promote_policy"),
    canAdminUsers: hasCapability(role, "admin_users"),
    canManageSystem: hasCapability(role, "manage_system"),
  };
}

export function canViewScreen(role: SentinelRole, screen: ConsoleScreen) {
  return hasCapability(role, SCREEN_CAPABILITY[screen]);
}

export function canAccessMerchant(
  viewer: Pick<AuthSessionUser, "role" | "merchantScopeIds">,
  merchantId: string | null | undefined,
) {
  if (viewer.role !== "merchant_risk_analyst") return true;
  if (!merchantId) return false;

  const normalizedMerchantId = merchantId.trim().toUpperCase();
  return viewer.merchantScopeIds.some(
    (scopeId) => scopeId.trim().toUpperCase() === normalizedMerchantId,
  );
}
