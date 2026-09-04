import assert from "node:assert/strict";
import test from "node:test";
import { canAccessMerchant, canViewScreen, getCapabilities, hasCapability } from "./authorization.ts";

test("a provisioned platform admin has full product authority", () => {
  const capabilities = getCapabilities("platform_admin");

  assert.equal(capabilities.canAdminUsers, true);
  assert.equal(capabilities.canManageSystem, true);
  assert.equal(canViewScreen("platform_admin", "control-room"), true);
});

test("risk leads can tune policy but cannot administer users or halt the platform", () => {
  const capabilities = getCapabilities("risk_lead");

  assert.equal(capabilities.canEditSimulator, true);
  assert.equal(capabilities.canAdminUsers, false);
  assert.equal(capabilities.canManageSystem, false);
});

test("fraud operations receives read-only simulator and control-room access", () => {
  const capabilities = getCapabilities("fraud_ops_analyst");

  assert.equal(capabilities.canAccessSimulator, true);
  assert.equal(capabilities.canAccessControlRoom, true);
  assert.equal(capabilities.canEditSimulator, false);
  assert.equal(hasCapability("fraud_ops_analyst", "manage_merchant_overrides"), false);
});

test("merchant risk analysts cannot access global reasoning or simulation screens", () => {
  assert.equal(canViewScreen("merchant_risk_analyst", "overview"), true);
  assert.equal(canViewScreen("merchant_risk_analyst", "copilot"), false);
  assert.equal(canViewScreen("merchant_risk_analyst", "control-room"), false);
  assert.equal(canViewScreen("merchant_risk_analyst", "simulator"), false);
});

test("merchant access requires an explicit normalized scope id", () => {
  const unassigned = { role: "merchant_risk_analyst", merchantScopeIds: [] };
  const assigned = { role: "merchant_risk_analyst", merchantScopeIds: ["m_vyra"] };

  assert.equal(canAccessMerchant(unassigned, "M_VYRA"), false);
  assert.equal(canAccessMerchant(assigned, "M_VYRA"), true);
  assert.equal(canAccessMerchant(assigned, "M_OTHER"), false);
});
