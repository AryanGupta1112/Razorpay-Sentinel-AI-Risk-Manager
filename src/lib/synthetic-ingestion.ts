import type { Merchant, PaymentMethod, Transaction } from "@/types/risk";

const INGESTION_INTERVAL_MS = 10_000;
const RETAINED_BATCHES = 48;
const PAYMENTS_PER_BATCH = 4;

const merchantNames = [
  "Northstar Grocers",
  "MangoRoute Travel",
  "CopperLeaf Home",
  "PulsePlay Digital",
  "Harborline Hotels",
  "NovaCart Market",
  "BrightBridge Learning",
  "MetroMint Mobility",
  "Oak & Loom",
  "CareSpring Health",
  "CloudHarbor Systems",
  "TicketTrail Events",
  "DailyDabba Foods",
  "VoltBay Electronics",
  "UrbanNest Living",
  "SkillForge Academy",
  "RiverRun Logistics",
  "PixelPort Games",
  "RoamReady Stays",
  "FreshLane Commerce",
  "SaffronPay Services",
  "CraftCircle Retail",
  "MotionGrid Rides",
  "SummitDesk SaaS",
] as const;

const categories = [
  "Commerce",
  "Travel",
  "Home Services",
  "Digital Goods",
  "Hospitality",
  "Marketplace",
  "EdTech",
  "Mobility",
  "Lifestyle Retail",
  "HealthTech",
  "B2B SaaS",
  "Ticketing",
] as const;

const regions = ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune", "Chennai", "Kolkata", "Jaipur", "Kochi", "Goa"] as const;
const owners = ["Aarav Mehta", "Diya Nair", "Kabir Shah", "Meera Rao", "Ishaan Gupta", "Naina Kapoor", "Rohan Das", "Sara Iyer"] as const;
const methods: PaymentMethod[] = ["UPI", "Card", "Netbanking", "Wallet"];

type Situation =
  | "normal_purchase"
  | "card_testing"
  | "account_takeover"
  | "refund_abuse"
  | "mule_network"
  | "flash_sale"
  | "travel_rush"
  | "subscription_retry"
  | "wallet_takeover"
  | "friendly_fraud"
  | "bot_checkout"
  | "geo_anomaly";

const situations: Situation[] = [
  "normal_purchase",
  "normal_purchase",
  "normal_purchase",
  "flash_sale",
  "travel_rush",
  "subscription_retry",
  "card_testing",
  "account_takeover",
  "refund_abuse",
  "mule_network",
  "wallet_takeover",
  "friendly_fraud",
  "bot_checkout",
  "geo_anomaly",
];

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function choose<T>(items: readonly T[], seed: string) {
  return items[hash(seed) % items.length];
}

function integer(seed: string, minimum: number, maximum: number) {
  return minimum + (hash(seed) % (maximum - minimum + 1));
}

export function buildSyntheticMerchants(seeded: Merchant[]): Merchant[] {
  const generated = merchantNames.map((name, index): Merchant => {
    const category = categories[index % categories.length];
    const elevated = index % 6 === 3 || index % 7 === 4;

    return {
      id: `m_live_${String(index + 1).padStart(2, "0")}`,
      name,
      category,
      owner: owners[index % owners.length],
      region: regions[(index * 3) % regions.length],
      kycTier: elevated && index % 2 === 0 ? "Provisional" : "Full",
      monthlyVolume: integer(`${name}:volume`, 840_000, 14_800_000),
      chargebackRate: elevated ? integer(`${name}:cb`, 18, 49) / 10 : integer(`${name}:cb`, 2, 17) / 10,
      disputeCount: elevated ? integer(`${name}:disputes`, 26, 128) : integer(`${name}:disputes`, 2, 34),
      failureRate: elevated ? integer(`${name}:fail`, 78, 154) / 10 : integer(`${name}:fail`, 15, 72) / 10,
      refundRate: integer(`${name}:refund`, 5, elevated ? 92 : 48) / 10,
      trustScore: elevated ? integer(`${name}:trust`, 36, 64) : integer(`${name}:trust`, 67, 95),
      settlementDelayHours: elevated ? integer(`${name}:delay`, 10, 28) : integer(`${name}:delay`, 1, 9),
    };
  });

  return [...seeded, ...generated];
}

function situationFields(situation: Situation, seed: string): Omit<Transaction, "id" | "merchantId" | "customer" | "currency" | "method" | "createdAt"> {
  if (situation === "card_testing") {
    return { amount: integer(`${seed}:amount`, 99, 2_999), status: "failed", deviceAgeDays: 0, geoDistanceKm: integer(`${seed}:geo`, 30, 780), attempts: integer(`${seed}:attempts`, 5, 10), ipVelocity: integer(`${seed}:velocity`, 14, 32), nightTraffic: true, previousChargebacks: 0 };
  }
  if (situation === "account_takeover" || situation === "wallet_takeover") {
    return { amount: integer(`${seed}:amount`, 82_000, 890_000), status: choose(["captured", "pending"] as const, `${seed}:status`), deviceAgeDays: 0, geoDistanceKm: integer(`${seed}:geo`, 1_200, 4_800), attempts: integer(`${seed}:attempts`, 2, 5), ipVelocity: integer(`${seed}:velocity`, 7, 18), nightTraffic: hash(seed) % 2 === 0, previousChargebacks: integer(`${seed}:cb`, 1, 4) };
  }
  if (situation === "refund_abuse" || situation === "friendly_fraud") {
    return { amount: integer(`${seed}:amount`, 24_000, 310_000), status: "refunded", deviceAgeDays: integer(`${seed}:device`, 1, 40), geoDistanceKm: integer(`${seed}:geo`, 80, 1_300), attempts: integer(`${seed}:attempts`, 2, 5), ipVelocity: integer(`${seed}:velocity`, 4, 11), nightTraffic: false, previousChargebacks: integer(`${seed}:cb`, 2, 7) };
  }
  if (situation === "mule_network" || situation === "bot_checkout") {
    return { amount: integer(`${seed}:amount`, 46_000, 520_000), status: choose(["captured", "pending", "failed"] as const, `${seed}:status`), deviceAgeDays: integer(`${seed}:device`, 0, 1), geoDistanceKm: integer(`${seed}:geo`, 760, 3_100), attempts: integer(`${seed}:attempts`, 3, 8), ipVelocity: integer(`${seed}:velocity`, 10, 26), nightTraffic: true, previousChargebacks: integer(`${seed}:cb`, 1, 5) };
  }
  if (situation === "geo_anomaly") {
    return { amount: integer(`${seed}:amount`, 18_000, 240_000), status: "pending", deviceAgeDays: integer(`${seed}:device`, 0, 12), geoDistanceKm: integer(`${seed}:geo`, 1_500, 5_600), attempts: integer(`${seed}:attempts`, 1, 4), ipVelocity: integer(`${seed}:velocity`, 3, 10), nightTraffic: hash(seed) % 2 === 1, previousChargebacks: integer(`${seed}:cb`, 0, 3) };
  }
  if (situation === "subscription_retry") {
    return { amount: integer(`${seed}:amount`, 499, 24_000), status: choose(["failed", "captured"] as const, `${seed}:status`), deviceAgeDays: integer(`${seed}:device`, 30, 900), geoDistanceKm: integer(`${seed}:geo`, 2, 180), attempts: integer(`${seed}:attempts`, 2, 4), ipVelocity: integer(`${seed}:velocity`, 1, 4), nightTraffic: false, previousChargebacks: 0 };
  }
  if (situation === "travel_rush") {
    return { amount: integer(`${seed}:amount`, 28_000, 280_000), status: "captured", deviceAgeDays: integer(`${seed}:device`, 12, 500), geoDistanceKm: integer(`${seed}:geo`, 240, 1_100), attempts: integer(`${seed}:attempts`, 1, 2), ipVelocity: integer(`${seed}:velocity`, 1, 5), nightTraffic: false, previousChargebacks: integer(`${seed}:cb`, 0, 1) };
  }

  return { amount: integer(`${seed}:amount`, 180, situation === "flash_sale" ? 42_000 : 125_000), status: choose(["captured", "captured", "captured", "pending"] as const, `${seed}:status`), deviceAgeDays: integer(`${seed}:device`, 14, 1_200), geoDistanceKm: integer(`${seed}:geo`, 1, 240), attempts: integer(`${seed}:attempts`, 1, 2), ipVelocity: integer(`${seed}:velocity`, 1, situation === "flash_sale" ? 6 : 3), nightTraffic: false, previousChargebacks: 0 };
}

export function buildSyntheticTransactions(
  merchantDirectory: Merchant[],
  seeded: Transaction[],
  now = Date.now(),
): Transaction[] {
  const currentBatch = Math.floor(now / INGESTION_INTERVAL_MS);
  const generated: Transaction[] = [];

  for (let batchOffset = 0; batchOffset < RETAINED_BATCHES; batchOffset += 1) {
    // Only publish completed batches, matching the atomic delivery behavior of a payment gateway webhook batch.
    const batch = currentBatch - 1 - batchOffset;
    for (let slot = 0; slot < PAYMENTS_PER_BATCH; slot += 1) {
      const seed = `${batch}:${slot}`;
      const situation = choose(situations, `${seed}:situation`);
      const merchant = choose(merchantDirectory, `${seed}:merchant`);
      const createdAt = new Date(batch * INGESTION_INTERVAL_MS + integer(`${seed}:ms`, 250, 9_500)).toISOString();

      generated.push({
        id: `pay_live_${batch.toString(36)}_${slot}`,
        merchantId: merchant.id,
        customer: `cust_${integer(`${seed}:customer`, 10_000, 999_999)}`,
        currency: "INR",
        method: choose(methods, `${seed}:method`),
        createdAt,
        ...situationFields(situation, seed),
      });
    }
  }

  return [...generated, ...seeded]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 360);
}
