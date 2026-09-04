import { merchants as seededMerchants, transactions as seededTransactions } from "@/data/baseline-risk-data";
import { buildSyntheticMerchants, buildSyntheticTransactions } from "@/lib/synthetic-ingestion";
import {
  AlertCase,
  DashboardSnapshot,
  MerchantInsight,
  MethodBreakdown,
  OverviewMetric,
  RiskTransaction,
  TrendPoint,
  Merchant,
  Transaction,
} from "@/types/risk";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function buildTriggers(transaction: Transaction, merchant: Merchant) {
  const triggers = [];

  if (transaction.amount >= 70000) {
    triggers.push({ code: "high_amount", label: "Unusually large payment", weight: 20 });
  }
  if (transaction.deviceAgeDays <= 1) {
    triggers.push({ code: "new_device", label: "New device", weight: 18 });
  }
  if (transaction.geoDistanceKm >= 1000) {
    triggers.push({ code: "geo_shift", label: "Location far from the usual area", weight: 16 });
  }
  if (transaction.attempts >= 3) {
    triggers.push({ code: "retry_cluster", label: "Several payment attempts", weight: 14 });
  }
  if (transaction.ipVelocity >= 7) {
    triggers.push({ code: "velocity", label: "Many payments from one internet address", weight: 14 });
  }
  if (transaction.nightTraffic) {
    triggers.push({ code: "night", label: "Burst of payments at an unusual hour", weight: 8 });
  }
  if (transaction.previousChargebacks >= 2) {
    triggers.push({ code: "history", label: "Customer linked to past chargebacks", weight: 16 });
  }
  if (merchant.failureRate >= 8) {
    triggers.push({ code: "merchant_failure", label: "Business payment failures have risen", weight: 10 });
  }
  if (merchant.kycTier === "Provisional") {
    triggers.push({ code: "kyc", label: "Business identity checks are incomplete", weight: 10 });
  }

  return triggers;
}

function getSeverity(score: number): "critical" | "high" | "medium" {
  if (score >= 85) {
    return "critical";
  }
  if (score >= 68) {
    return "high";
  }
  return "medium";
}

function getRecommendation(score: number): string {
  if (score >= 85) {
    return "Temporarily stop the payout and send the business for immediate review.";
  }
  if (score >= 68) {
    return "Ask for an extra identity check and limit repeated payments for 24 hours.";
  }
  return "Keep watching the pattern and have a person check a small sample.";
}

function buildExplanation(merchantName: string, score: number, labels: string[]) {
  return `${merchantName} received a risk score of ${score} because of ${labels
    .slice(0, 3)
    .join(", ")
    .toLowerCase()}. Together, these signs look more suspicious than a normal payment retry.`;
}

function scoreTransactions(transactions: Transaction[], merchants: Merchant[]): RiskTransaction[] {
  return transactions
    .map((transaction) => {
      const merchant = merchants.find((item) => item.id === transaction.merchantId);

      if (!merchant) {
        throw new Error(`Missing merchant ${transaction.merchantId}`);
      }

      const triggers = buildTriggers(transaction, merchant);
      const statusWeight =
        transaction.status === "failed"
          ? 10
          : transaction.status === "pending"
            ? 7
            : transaction.status === "refunded"
              ? 6
              : 0;

      const score = Math.min(
        98,
        triggers.reduce((total, trigger) => total + trigger.weight, 0) +
          statusWeight +
          Math.max(0, Math.round((merchant.chargebackRate - 1) * 4)),
      );

      return {
        ...transaction,
        merchantName: merchant.name,
        score,
        severity: getSeverity(score),
        triggers,
        explanation: buildExplanation(
          merchant.name,
          score,
          triggers.map((trigger) => trigger.label),
        ),
        recommendation: getRecommendation(score),
      };
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function deriveMerchantInsights(riskTransactions: RiskTransaction[], merchants: Merchant[]): MerchantInsight[] {
  return merchants
    .map((merchant): MerchantInsight => {
      const merchantTransactions = riskTransactions.filter(
        (transaction) => transaction.merchantId === merchant.id,
      );
      const flaggedTransactions = merchantTransactions.filter((transaction) => transaction.score >= 68).length;
      const capturedVolume = merchantTransactions
        .filter((transaction) => transaction.status === "captured")
        .reduce((total, transaction) => total + transaction.amount, 0);
      const averageScore =
        merchantTransactions.reduce((total, transaction) => total + transaction.score, 0) /
        Math.max(merchantTransactions.length, 1);
      const healthScore = Math.max(
        24,
        Math.round(
          merchant.trustScore -
            merchant.chargebackRate * 4 -
            merchant.failureRate * 1.4 -
            flaggedTransactions * 2 +
            Math.max(0, 8 - merchant.settlementDelayHours),
        ),
      );
      const dominantRisk =
        merchantTransactions[0]?.triggers[0]?.label ?? "Stable payment behavior";

      const reviewStatus: MerchantInsight["reviewStatus"] =
        healthScore < 45 ? "escalate" : healthScore < 58 ? "watch" : averageScore > 60 ? "review" : "monitor";

      return {
        ...merchant,
        healthScore,
        flaggedTransactions,
        capturedVolume,
        dominantRisk,
        reviewStatus,
      };
    })
    .sort((left, right) => left.healthScore - right.healthScore);
}

function buildOverview(riskTransactions: RiskTransaction[], merchantInsights: MerchantInsight[]): OverviewMetric[] {
  const flagged = riskTransactions.filter((transaction) => transaction.score >= 68);
  const capturedVolume = riskTransactions
    .filter((transaction) => transaction.status === "captured")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const reviewMerchants = merchantInsights.filter((merchant) => merchant.reviewStatus !== "monitor");
  const criticalCases = flagged.filter((transaction) => transaction.severity === "critical").length;

  return [
    {
      label: "Monitored volume",
      value: money.format(capturedVolume),
      delta: "+12.4% week-on-week",
      tone: "good",
    },
    {
      label: "Payments needing review",
      value: String(flagged.length),
      delta: `${criticalCases} urgent`,
      tone: criticalCases > 0 ? "bad" : "warn",
    },
    {
      label: "Businesses under review",
      value: String(reviewMerchants.length),
      delta: `${reviewMerchants.filter((merchant) => merchant.reviewStatus === "escalate").length} need urgent attention`,
      tone: "warn",
    },
    {
      label: "Money at risk from chargebacks",
      value: money.format(
        merchantInsights.reduce(
          (total, merchant) => total + (merchant.monthlyVolume * merchant.chargebackRate) / 100,
          0,
        ),
      ),
      delta: "-6.1% after filters",
      tone: "good",
    },
  ];
}

function buildTrends(riskTransactions: RiskTransaction[]): TrendPoint[] {
  const dateMap = new Map<string, TrendPoint>();

  for (const transaction of riskTransactions) {
    const key = transaction.createdAt.slice(5, 10);
    const current = dateMap.get(key) ?? {
      date: key,
      riskVolume: 0,
      failedPayments: 0,
      disputes: 0,
    };

    current.riskVolume += transaction.score >= 68 ? transaction.amount : Math.round(transaction.amount * 0.25);
    current.failedPayments += transaction.status === "failed" ? 1 : 0;
    current.disputes += transaction.previousChargebacks > 0 ? 1 : 0;
    dateMap.set(key, current);
  }

  return [...dateMap.values()];
}

function buildMethodBreakdown(riskTransactions: RiskTransaction[]): MethodBreakdown[] {
  return ["UPI", "Card", "Netbanking", "Wallet"].map((method) => ({
    method: method as MethodBreakdown["method"],
    count: riskTransactions.filter((transaction) => transaction.method === method).length,
    flagged: riskTransactions.filter(
      (transaction) => transaction.method === method && transaction.score >= 68,
    ).length,
  }));
}

function buildCases(alerts: RiskTransaction[]): AlertCase[] {
  return alerts.slice(0, 12).map((alert, index) => ({
    id: `case_${index + 1}`,
    merchantName: alert.merchantName,
    transactionId: alert.id,
    severity: alert.severity,
    action: alert.recommendation,
    summary: `${alert.merchantName} shows ${alert.triggers
      .slice(0, 2)
      .map((trigger) => trigger.label.toLowerCase())
      .join(" + ")}.`,
  }));
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const merchants = buildSyntheticMerchants(seededMerchants);
  const transactions = buildSyntheticTransactions(merchants, seededTransactions);
  const riskTransactions = scoreTransactions(transactions, merchants);
  const merchantInsights = deriveMerchantInsights(riskTransactions, merchants);
  const alerts = riskTransactions
    .filter((transaction) => transaction.score >= 68)
    .sort(
      (left, right) =>
        right.score - left.score || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );

  return {
    generatedAt: new Date().toISOString(),
    overview: buildOverview(riskTransactions, merchantInsights),
    trends: buildTrends(riskTransactions),
    methodBreakdown: buildMethodBreakdown(riskTransactions),
    transactions: riskTransactions,
    alerts,
    merchants: merchantInsights,
    cases: buildCases(alerts),
    narrative: `Risk concentration is highest across ${merchantInsights
      .slice(0, 3)
      .map((merchant) => merchant.name)
      .join(", ")}, where fresh devices, rapid retries, and chargeback-linked traffic are converging across multiple payment methods.`,
  };
}
