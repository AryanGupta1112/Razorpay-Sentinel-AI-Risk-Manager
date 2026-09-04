import assert from "node:assert/strict";
import test from "node:test";
import { findApprovalForResolution } from "./approval-resolution.ts";

const pendingApproval = {
  id: "approval_consensus_event_pay_live_example_0",
  status: "pending",
};

test("recovers a displayed generated approval missing from durable storage", () => {
  const stored = [];
  const approval = findApprovalForResolution(
    stored,
    [pendingApproval],
    pendingApproval.id,
  );

  assert.equal(approval, pendingApproval);
  assert.deepEqual(stored, [pendingApproval]);
});

test("returns the durable approval without adding a duplicate", () => {
  const stored = [{ ...pendingApproval, status: "approved" }];
  const approval = findApprovalForResolution(
    stored,
    [pendingApproval],
    pendingApproval.id,
  );

  assert.equal(approval, stored[0]);
  assert.equal(stored.length, 1);
});

test("reports an expired generated approval as a conflict", () => {
  assert.throws(
    () => findApprovalForResolution([], [], "approval_missing"),
    (error) => error.code === "APPROVAL_NOT_AVAILABLE" && error.status === 409,
  );
});
