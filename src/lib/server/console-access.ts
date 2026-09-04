import "server-only";

import type { ConsoleData } from "@/lib/console-adapters";
import { canAccessMerchant } from "@/lib/authorization";
import type { AuthSessionUser } from "@/types/auth";

export function scopeConsoleData(data: ConsoleData, viewer: AuthSessionUser): ConsoleData {
  if (viewer.role !== "merchant_risk_analyst") return data;

  const merchants = data.merchants.filter((merchant) => canAccessMerchant(viewer, merchant.id));
  const alerts = data.alerts.filter((alert) => canAccessMerchant(viewer, alert.merchantId));
  const transactions = data.transactions.filter((transaction) =>
    canAccessMerchant(viewer, transaction.merchantId),
  );
  const topMerchant = merchants[0];
  const topAlert = alerts[0];
  const averageRisk = merchants.length
    ? Math.round(merchants.reduce((total, merchant) => total + merchant.riskScore, 0) / merchants.length)
    : 0;

  return {
    ...data,
    overview: {
      ...data.overview,
      riskScore: averageRisk,
      riskStateLabel: merchants.length ? "Assigned business risk" : "No businesses assigned",
      riskDelta: `${alerts.length} open alerts in your scope`,
      queuePressure: alerts.length,
      queueLabel: "Assigned alerts",
      fpCost: "Not available",
      fpTrend: "Global financial metrics are restricted",
      totals: [
        { label: "Assigned businesses", value: String(merchants.length), color: "#59d6b0" },
        { label: "Visible payments", value: String(transactions.length), color: "#f1c75b" },
        { label: "Open alerts", value: String(alerts.length), color: "#ff5a63" },
      ],
      modelMetrics: [],
      systemStatus: "Your view is limited to assigned businesses.",
      caseStats: [
        { label: "Assigned businesses", value: String(merchants.length) },
        { label: "Visible alerts", value: String(alerts.length) },
      ],
      challenger: undefined,
      drift: undefined,
    },
    queueData: [],
    clusters: [],
    alerts,
    merchants,
    transactions,
    suggestions: topMerchant
      ? [`Why does ${topMerchant.name} need attention?`, "Which assigned payment should I review next?"]
      : ["Ask a Platform Admin to assign businesses to this account."],
    initialMessages: [
      {
        id: 1,
        role: "assistant",
        time: new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
          new Date(data.generatedAt),
        ),
        content: topMerchant
          ? `Your view contains ${merchants.length} assigned business${merchants.length === 1 ? "" : "es"}. ${topAlert ? `${topAlert.title} needs attention first.` : "There are no open alerts in your scope."}`
          : "No businesses are assigned to this account. Ask a Platform Admin to add merchant scope ids.",
      },
    ],
    copilotContext: {
      merchant: {
        name: topMerchant?.name ?? "No assigned business",
        mid: topMerchant?.id ?? "UNASSIGNED",
        severity: topMerchant?.riskLevel ?? "low",
        score: topMerchant?.riskScore ?? 0,
      },
      alert: {
        id: topAlert?.id ?? "NO_ALERT",
        title: topAlert?.title ?? "No alert in assigned scope",
        cluster: topAlert?.cluster ?? "None",
        time: topAlert?.time ?? "Now",
      },
      recentActions: [],
    },
    simulator: {
      ...data.simulator,
      title: "Restricted",
      statsLabel: "Simulator access is not assigned to this role.",
      activeRunLabel: "Unavailable",
      comparison: undefined,
      sessionTimeline: [],
      agentRoster: [],
      agentMemories: [],
      approvals: [],
      telemetry: [],
      deliberations: [],
      activity: [],
      nodes: [],
      edges: [],
      frames: [],
      summaryTitle: "Simulator access restricted",
      summarySubtitle: "This account can review assigned businesses only.",
      liveStats: [],
    },
  };
}
