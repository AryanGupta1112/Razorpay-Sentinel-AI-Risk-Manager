export class ApprovalResolutionError extends Error {
  readonly status = 409;
  readonly code = "APPROVAL_NOT_AVAILABLE";

  constructor() {
    super("This decision is no longer current. Refresh the screen to review the latest team decision.");
    this.name = "ApprovalResolutionError";
  }
}

export function findApprovalForResolution<T extends { id: string }>(
  storedApprovals: T[],
  generatedApprovals: T[],
  approvalId: string,
): T {
  const stored = storedApprovals.find((approval) => approval.id === approvalId);
  if (stored) return stored;

  const generated = generatedApprovals.find((approval) => approval.id === approvalId);
  if (!generated) throw new ApprovalResolutionError();

  storedApprovals.unshift(generated);
  return generated;
}
