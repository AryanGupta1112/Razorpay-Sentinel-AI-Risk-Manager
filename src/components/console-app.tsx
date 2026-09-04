"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle,
  ChevronRight,
  CreditCard,
  Eye,
  Filter,
  Lock,
  Network,
  Search,
  Send,
  Settings,
  Shield,
  TrendingUp,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ResponsiveContainer, Area, AreaChart, Tooltip } from "recharts";
import { ConsoleData, ConsoleScreen, type ConsoleSimEdge, type ConsoleSimNode } from "@/lib/console-adapters";
import type { AuthSessionUser } from "@/types/auth";
import { canAccessMerchant, canViewScreen } from "@/lib/authorization";
import AdminUsersScreen from "@/components/admin-users-screen";
import SentinelControlRoomScreen from "@/components/sentinel-control-room-screen";
import { TablePagination } from "@/components/table-pagination";
import {
  OperationsControlContext,
  type OperationsMode,
  useOperationsControl,
  useOperationsStatus,
} from "@/lib/use-operations-control";

type Screen = ConsoleScreen;

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  time: string;
  content: string;
};

function roleLabel(role: AuthSessionUser["role"]) {
  if (role === "platform_admin") return "Platform Admin";
  if (role === "risk_lead") return "Risk Lead";
  if (role === "fraud_ops_analyst") return "Fraud Ops Analyst";
  return "Merchant Risk Analyst";
}

function viewerCanAccessMerchant(viewer: AuthSessionUser, merchantId?: string | null) {
  return canAccessMerchant(viewer, merchantId);
}

const NAV: Array<{ id: Screen; icon: LucideIcon; label: string }> = [
  { id: "overview", icon: Shield, label: "Overview" },
  { id: "copilot", icon: Bot, label: "Sentinel" },
  { id: "control-room", icon: Activity, label: "Control room" },
  { id: "simulator", icon: Network, label: "Simulator" },
  { id: "alerts", icon: AlertTriangle, label: "Alerts" },
  { id: "merchants", icon: Users, label: "Merchants" },
  { id: "transactions", icon: CreditCard, label: "Transactions" },
  { id: "admin", icon: Settings, label: "Admin" },
];

function navItemsForViewer(viewer: AuthSessionUser) {
  return NAV.filter((item) => canViewScreen(viewer.role, item.id));
}

const SEVERITY_STYLE = {
  critical: "text-red-400 bg-red-500/10 border-red-500/25",
  high: "text-amber-400 bg-amber-500/10 border-amber-500/25",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/25",
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
} as const;

const STATUS_STYLE = {
  held: "text-purple-400 bg-purple-500/10 border-purple-500/25",
  declined: "text-red-400 bg-red-500/10 border-red-500/25",
  success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  processing: "text-amber-400 bg-amber-500/10 border-amber-500/25",
} as const;

const UI_EASE_OUT = [0.23, 1, 0.32, 1] as const;
const UI_EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const SIMULATOR_DEFAULT_TRANSFORM: { x: number; y: number; scale: number } = { x: -60, y: -24, scale: 0.76 };

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNodeMetaLabel(label: string) {
  const labelMap: Record<string, string> = {
    "Primary flow": "Flow",
    "Linked payments": "Linked",
    "Risk score": "Risk",
    "Analyst priority": "Priority",
    "Review priority": "Priority",
    "Review path": "Route",
    "Exposure value": "Exposure",
    "Retry attempts": "Retries",
    "Geo deviation": "Geo drift",
    "Queue status": "Queue",
    "Customer history": "History",
    "Device posture": "Device",
    "Control action": "Action",
    "Verifier action": "Action",
    "Verifier control": "Control",
    "Queue control": "Control",
    "Manual review action": "Action",
    "Manual review control": "Control",
  };

  return labelMap[label] ?? label;
}

function formatNodeTypeLabel(type: ConsoleSimNode["type"]) {
  const labels: Record<ConsoleSimNode["type"], string> = {
    merchant: "Business",
    customer: "Customer",
    payment: "Payment",
    cluster: "Pattern",
    verifier: "Extra check",
    queue: "Review queue",
  };

  return labels[type];
}

function getNodeMetaEntries(node: ConsoleSimNode) {
  const entries = Object.entries(node.meta ?? {});
  const limit = node.type === "cluster" ? 4 : node.type === "payment" ? 4 : node.type === "merchant" ? 4 : 3;

  return entries.slice(0, limit).map(([key, value]) => ({
    key,
    label: formatNodeMetaLabel(key),
    value,
  }));
}

function getSimulatorNodeWidth(node: Pick<ConsoleSimNode, "type">) {
  if (node.type === "cluster") return 274;
  if (node.type === "merchant") return 224;
  if (node.type === "payment") return 252;
  if (node.type === "queue" || node.type === "verifier") return 204;
  if (node.type === "customer") return 224;
  return 188;
}

function getSimulatorNodeHeight(node: Pick<ConsoleSimNode, "type">) {
  if (node.type === "cluster") return 188;
  if (node.type === "merchant") return 164;
  if (node.type === "payment") return 226;
  if (node.type === "queue" || node.type === "verifier") return 214;
  if (node.type === "customer") return 210;
  return 156;
}

function resolveSimulatorNodePositions(nodes: ConsoleSimNode[]) {
  const positions = Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])) as Record<
    string,
    { x: number; y: number }
  >;
  const padding = 72;

  for (let iteration = 0; iteration < 72; iteration += 1) {
    let moved = false;

    for (let index = 0; index < nodes.length; index += 1) {
      const a = nodes[index];
      for (let compareIndex = index + 1; compareIndex < nodes.length; compareIndex += 1) {
        const b = nodes[compareIndex];
        const aPos = positions[a.id];
        const bPos = positions[b.id];
        const minXDistance = (getSimulatorNodeWidth(a) + getSimulatorNodeWidth(b)) / 2 + padding;
        const minYDistance = (getSimulatorNodeHeight(a) + getSimulatorNodeHeight(b)) / 2 + padding;
        const dx = bPos.x - aPos.x;
        const dy = bPos.y - aPos.y;
        const overlapX = minXDistance - Math.abs(dx);
        const overlapY = minYDistance - Math.abs(dy);

        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;

        if (overlapX < overlapY) {
          const pushX = overlapX / 2 + 2;
          const direction = dx === 0 ? (index % 2 === 0 ? -1 : 1) : Math.sign(dx);
          aPos.x -= pushX * direction;
          bPos.x += pushX * direction;
        } else {
          const pushY = overlapY / 2 + 2;
          const direction = dy === 0 ? (compareIndex % 2 === 0 ? -1 : 1) : Math.sign(dy);
          aPos.y -= pushY * direction;
          bPos.y += pushY * direction;
        }
      }
    }

    for (const node of nodes) {
      const position = positions[node.id];
      position.x += (node.x - position.x) * 0.045;
      position.y += (node.y - position.y) * 0.045;
    }

    if (!moved) break;
  }

  return positions;
}

function mergeSimulatorNodePositions(
  nodes: ConsoleSimNode[],
  defaults: Record<string, { x: number; y: number }>,
  current: Record<string, { x: number; y: number }>,
) {
  const next: Record<string, { x: number; y: number }> = {};
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [...nodes].sort((left, right) => Number(Boolean(current[right.id])) - Number(Boolean(current[left.id])));

  const isFree = (node: ConsoleSimNode, candidate: { x: number; y: number }) =>
    Object.entries(next).every(([id, position]) => {
      const placedNode = nodeById.get(id);
      if (!placedNode) return true;
      const minX = (getSimulatorNodeWidth(node) + getSimulatorNodeWidth(placedNode)) / 2 + 72;
      const minY = (getSimulatorNodeHeight(node) + getSimulatorNodeHeight(placedNode)) / 2 + 72;
      return Math.abs(candidate.x - position.x) >= minX || Math.abs(candidate.y - position.y) >= minY;
    });

  for (const node of ordered) {
    const base = current[node.id] ?? defaults[node.id] ?? { x: node.x, y: node.y };
    if (current[node.id] || isFree(node, base)) {
      next[node.id] = base;
      continue;
    }

    let position = base;
    for (let radius = 1; radius <= 24; radius += 1) {
      const distance = radius * 84;
      const candidates = [
        { x: base.x, y: base.y + distance },
        { x: base.x, y: base.y - distance },
        { x: base.x + distance, y: base.y },
        { x: base.x - distance, y: base.y },
        { x: base.x + distance, y: base.y + distance },
        { x: base.x - distance, y: base.y - distance },
      ];
      const available = candidates.find((candidate) => isFree(node, candidate));
      if (available) {
        position = available;
        break;
      }
    }
    next[node.id] = position;
  }

  return next;
}

function pathForScreen(screen: Screen) {
  if (screen === "overview") return "/overview";
  if (screen === "copilot") return "/sentinel";
  return `/${screen}`;
}

function screenFromPathname(pathname: string): Screen {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const segment = normalized.split("/")[1];

  if (
    segment === "overview" ||
    segment === "copilot" ||
    segment === "sentinel" ||
    segment === "control-room" ||
    segment === "simulator" ||
    segment === "alerts" ||
    segment === "merchants" ||
    segment === "transactions" ||
    segment === "admin"
  ) {
    return segment === "sentinel" ? "copilot" : segment;
  }

  return normalized === "/" ? "overview" : "overview";
}

function SeverityBadge({ level }: { level: keyof typeof SEVERITY_STYLE }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium font-mono ${SEVERITY_STYLE[level]}`}>
      {level.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: keyof typeof STATUS_STYLE }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium font-mono ${STATUS_STYLE[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function ScoreBar({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const color =
    score >= 80 ? "bg-red-500" : score >= 60 ? "bg-amber-500" : score >= 40 ? "bg-yellow-400" : "bg-emerald-500";
  const textColor =
    score >= 80 ? "text-red-400" : score >= 60 ? "text-amber-400" : score >= 40 ? "text-yellow-400" : "text-emerald-400";

  return (
    <div className="flex items-center gap-2">
      <span className={`font-display text-sm font-bold ${textColor}`}>{score}</span>
      {size === "md" && (
        <div className="w-12 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
        </div>
      )}
    </div>
  );
}

function HeaderAccountChrome({
  viewer,
  onLogout,
}: {
  viewer: AuthSessionUser;
  onLogout: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/12">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
            {viewer.username.slice(0, 2)}
          </span>
        </div>
        <div className="min-w-0 leading-none">
          <div className="max-w-28 truncate text-[11px] font-medium text-foreground">{viewer.username}</div>
          <div className="mt-1 hidden text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:block">
            {roleLabel(viewer.role)}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex h-9 flex-shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] px-3.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-white/12 hover:bg-white/[0.06] hover:text-foreground"
      >
        Logout
      </button>
    </div>
  );
}

function PageHeader({
  title,
  right,
  live,
  account,
}: {
  title: string;
  right?: ReactNode;
  live?: boolean;
  account?: ReactNode;
}) {
  const { isHalted } = useOperationsStatus();

  return (
    <div className="flex min-h-14 flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6">
      <div className="order-1 flex min-w-0 flex-1 items-center gap-3">
        <span className="font-display text-sm uppercase tracking-[0.15em] text-muted-foreground">{title}</span>
        {live && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isHalted ? "bg-red-500" : "animate-pulse bg-emerald-500"}`} />
              <span className={`text-[10px] font-mono ${isHalted ? "text-red-400" : "text-muted-foreground"}`}>
                {isHalted ? "HALTED" : "LIVE"}
              </span>
            </div>
          </>
        )}
      </div>
      {(right || account) && (
        <>
          {right ? (
            <div className="order-3 flex min-w-0 basis-full flex-wrap items-center gap-3 lg:order-2 lg:ml-auto lg:basis-auto">
              {right}
            </div>
          ) : null}
          {account ? <div className="order-2 ml-auto flex-shrink-0 lg:order-3 lg:ml-0">{account}</div> : null}
        </>
      )}
    </div>
  );
}

function Sidebar({
  current,
  onNavigate,
  viewer,
}: {
  current: Screen;
  onNavigate: (screen: Screen) => void;
  viewer: AuthSessionUser;
}) {
  const navItems = useMemo(() => navItemsForViewer(viewer), [viewer]);

  return (
    <aside className="relative z-40 h-full w-[58px] flex-shrink-0" aria-label="Main navigation">
      <div className="group/sidebar absolute inset-y-0 left-0 flex w-[58px] flex-col overflow-hidden border-r border-border bg-[#050505] shadow-none transition-[width,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:w-[220px] hover:shadow-[18px_0_40px_rgba(0,0,0,0.34)] motion-reduce:transition-none">
        <div className="flex h-[58px] flex-shrink-0 items-center border-b border-border px-[13px]">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <span className="font-display text-sm font-bold tracking-wider text-primary">S</span>
          </div>
          <span className="ml-3 whitespace-nowrap font-display text-sm font-semibold tracking-[0.04em] text-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out -translate-x-1 group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100 motion-reduce:transition-none">
            Sentinel
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 py-4">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              title={label}
              aria-current={current === id ? "page" : undefined}
              className={`relative flex h-10 w-full flex-shrink-0 cursor-pointer items-center rounded-lg px-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                current === id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              {current === id ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary" /> : null}
              <Icon className="h-[17px] w-[17px] flex-shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="ml-4 whitespace-nowrap text-sm font-medium opacity-0 transition-[opacity,transform] duration-150 ease-out -translate-x-1 group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100 motion-reduce:transition-none">
                {label}
              </span>
            </button>
          ))}
        </nav>
        <div className="h-4 flex-shrink-0" />
      </div>
    </aside>
  );
}

function RecordDetailDialog({
  title,
  summary,
  recordLabel,
  onClose,
  children,
}: {
  title: string;
  summary: string;
  recordLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-6"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: UI_EASE_OUT }}
    >
      <button type="button" aria-label={`Close ${recordLabel} details`} className="absolute inset-0 bg-black/75" onClick={onClose} />
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-detail-title"
        aria-describedby="record-detail-summary"
        initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.2, ease: UI_EASE_OUT }}
        className="relative z-[151] flex max-h-[90dvh] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101218] shadow-[0_32px_100px_rgba(0,0,0,0.62)]"
      >
        <header className="flex items-start justify-between gap-5 border-b border-white/8 px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">{recordLabel} details</div>
            <h2 id="record-detail-title" className="mt-2 break-words text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
              {title}
            </h2>
            <p id="record-detail-summary" className="mt-2 max-w-[68ch] text-sm leading-6 text-muted-foreground">
              {summary}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${recordLabel} details`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">{children}</div>
      </motion.section>
    </motion.div>
  );
}

function DetailField({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-foreground";
  return (
    <div className="min-w-0 border-t border-white/8 py-3">
      <dt className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={`mt-1.5 break-words text-sm leading-5 ${toneClass}`}>{value || "Not available"}</dd>
    </div>
  );
}

const SIMULATOR_UI_STORAGE_KEY = "sentinel.simulator-ui.v2";

function OverviewScreen({
  data,
  onNavigate,
  headerAccount,
  isHalted,
}: {
  data: ConsoleData;
  onNavigate: (screen: Screen) => void;
  headerAccount?: ReactNode;
  isHalted: boolean;
}) {
  const [tick, setTick] = useState(0);
  const [clusterView, setClusterView] = useState<"list" | "detail" | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  useEffect(() => {
    if (isHalted) return;
    const timer = setInterval(() => setTick((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, [isHalted]);

  const queue = data.overview.queuePressure + ((tick * 2) % 9) - 4;
  const clusterInsights = useMemo(
    () =>
      data.clusters.map((cluster) => {
        const linkedAlerts = data.alerts.filter(
          (alert) => alert.cluster?.toUpperCase() === cluster.id || alert.type.toUpperCase() === cluster.id,
        );
        const merchants = [...new Set(linkedAlerts.map((alert) => alert.merchant))];
        const primaryAlert = [...linkedAlerts].sort((left, right) => right.score - left.score)[0] ?? null;

        return {
          cluster,
          linkedAlerts,
          merchants,
          primaryAlert,
          openAlerts: linkedAlerts.filter((alert) => alert.status !== "dismissed").length,
          recommendedAction:
            primaryAlert?.recommendation ??
            `Review ${cluster.name.toLowerCase()} and route the highest-risk merchant into manual review.`,
        };
      }),
    [data.alerts, data.clusters],
  );
  const selectedClusterInsight =
    clusterInsights.find((entry) => entry.cluster.id === selectedClusterId) ?? clusterInsights[0] ?? null;
  const openClusterDetail = useCallback((clusterId: string) => {
    setSelectedClusterId(clusterId);
    setClusterView("detail");
  }, []);
  const closeClusterPanels = useCallback(() => {
    setClusterView(null);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="relative flex-1 flex flex-col h-full overflow-hidden"
    >
      <PageHeader
        title="Risk Posture"
        live
        account={headerAccount}
      />
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 auto-rows-[172px] flex-shrink-0 md:grid-cols-2 2xl:grid-cols-3">
          <div className="rounded-lg border border-border bg-card px-5 py-4 flex h-[172px] flex-col justify-between gap-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Overall risk</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 bg-amber-500/8">
                {data.overview.riskStateLabel.toUpperCase()}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <span className="font-display text-[3rem] font-bold text-foreground leading-none tracking-tight">
                {data.overview.riskScore}
              </span>
              <span className="font-display text-base text-muted-foreground mb-1">/100</span>
            </div>
            <div className="h-[2px] rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${data.overview.riskScore}%`,
                  background: "linear-gradient(to right, #C9A32A, #F59E0B)",
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
              <TrendingUp className="w-3 h-3" />
              <span>{data.overview.riskDelta}</span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card px-5 py-4 flex h-[172px] flex-col justify-between gap-2.5 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Payments waiting for review</span>
              <span className="max-w-[8.5rem] text-right text-[10px] font-mono leading-tight text-red-400 lg:max-w-none">
                {data.overview.queueLabel}
              </span>
            </div>
            <div className="font-display text-[2.65rem] font-bold text-foreground leading-none">{queue}</div>
            <div className="text-[10px] text-muted-foreground">{data.overview.queueLabel}</div>
            <div style={{ height: 24 }}>
              <ResponsiveContainer width="100%" height={24}>
                <AreaChart data={data.queueData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="qg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="#F59E0B"
                    strokeWidth={1.5}
                    fill="url(#qg)"
                    dot={false}
                    activeDot={{ r: 2, fill: "#F59E0B" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0F0F15",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 6,
                      padding: "4px 10px",
                    }}
                    labelStyle={{ display: "none" }}
                    itemStyle={{ color: "#F59E0B", fontSize: 11 }}
                    formatter={(value) => [`${String(value ?? 0)} reviews`, ""]}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {data.alerts.length} active queue cases · {data.overview.caseStats[0]?.value ?? "0"} open
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card px-5 py-4 flex h-[172px] flex-col justify-between gap-2.5 overflow-hidden md:col-span-2 2xl:col-span-1">
            <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Today - 24h</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {data.overview.totals.map(({ label, value, color }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <div className={`font-display text-[24px] font-bold leading-none ${color}`}>{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-border space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <span className="text-muted-foreground">
                  FP cost: <span className="text-foreground font-mono">{data.overview.fpCost}</span>
                </span>
                <span className="text-emerald-400 text-right">{data.overview.fpTrend}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
                {data.overview.caseStats.map((stat) => (
                  <span key={stat.label}>
                    <span className="text-foreground">{stat.value}</span> {stat.label.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <div className="rounded-lg border border-border bg-card flex min-h-[320px] flex-col overflow-hidden xl:min-h-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Active Threat Clusters</span>
              <button
                type="button"
                onClick={() => setClusterView("list")}
                className="text-[11px] text-primary hover:text-primary/70 flex items-center gap-1 transition-colors"
              >
                All clusters
                <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary/85">
                  {clusterInsights.length}
                </span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-border">
              {data.clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => openClusterDetail(cluster.id)}
                  className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.015] md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]"
                >
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      cluster.severity === "critical"
                        ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                        : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                    } mt-1.5`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground font-medium">{cluster.name}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          cluster.severity === "critical"
                            ? "text-red-400 border-red-500/25 bg-red-500/8"
                            : "text-amber-400 border-amber-500/25 bg-amber-500/8"
                        }`}
                      >
                        {cluster.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-muted-foreground">
                      <span>{cluster.id}</span>
                      <span>-</span>
                      <span>{cluster.merchants} merchants</span>
                      <span>-</span>
                      <span>{cluster.txns} payments</span>
                      <span>-</span>
                      <span>{cluster.linkedIPs} IPs</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 self-start md:self-center">
                    <div className="font-display font-bold text-foreground text-sm">{cluster.exposure}</div>
                    <div className="text-[11px] text-amber-400 font-mono">{cluster.velocity}</div>
                  </div>
                  <span className="text-[11px] text-muted-foreground text-right flex-shrink-0 self-start md:w-8 md:self-center">{cluster.age}</span>
                  <ChevronRight className="h-3.5 w-3.5 self-start text-muted-foreground/30 transition-colors group-hover:text-muted-foreground md:self-center" />
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card flex min-h-[280px] flex-col overflow-hidden xl:min-h-0">
            <div className="px-5 py-3 border-b border-border flex-shrink-0">
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Model Performance</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-5 flex flex-col gap-3">
              {data.overview.modelMetrics.map((metric) => (
                <div key={metric.label} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{metric.label}</span>
                    <span className="font-display font-bold text-foreground text-sm">{metric.value}</span>
                  </div>
                  <div className="h-[2px] rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full ${metric.tone} transition-all duration-700`} style={{ width: `${metric.pct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground/50">{metric.sub}</div>
                </div>
              ))}
              <div className="pt-3 mt-auto border-t border-border">
                <div className="text-[11px] text-muted-foreground mb-1.5">Cost of reviewing safe payments</div>
                <div className="font-display text-2xl font-bold text-foreground">
                  {data.overview.fpCost}
                  <span className="text-sm font-normal text-muted-foreground"> in this test</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{data.overview.fpTrend}</div>
              </div>
              {data.overview.challenger && (
                <div className="pt-3 border-t border-border">
                  <div className="text-[11px] text-muted-foreground mb-1">{data.overview.challenger.label}</div>
                  <div className="text-[12px] text-foreground">{data.overview.challenger.delta}</div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    {data.overview.challenger.recommendation}
                  </div>
                </div>
              )}
              {data.overview.drift && (
                <div className="rounded-md border border-white/6 bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Changes in payment behavior</span>
                    <span
                      className={`text-[10px] font-mono ${
                        data.overview.drift.tone === "good"
                          ? "text-emerald-400"
                          : data.overview.drift.tone === "warn"
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}
                    >
                      {data.overview.drift.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                    {data.overview.drift.summary}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => onNavigate("simulator")}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/18 transition-all group"
          >
            <Network className="w-4 h-4" />
            <span className="font-display text-sm uppercase tracking-wider">Defense Simulator</span>
            <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </button>
          <button
            onClick={() => onNavigate("copilot")}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-white/15 transition-all"
          >
            <Bot className="w-4 h-4" />
            <span className="font-display text-sm uppercase tracking-wider">Investigate with Sentinel</span>
          </button>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {data.overview.systemStatus}
          </div>
        </div>

        <AnimatePresence>
          {clusterView && (
            <>
              <motion.button
                type="button"
                aria-label="Close cluster panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: UI_EASE_OUT }}
                className="absolute inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
                onClick={closeClusterPanels}
              />
              <motion.aside
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 28 }}
                transition={{ duration: 0.22, ease: UI_EASE_OUT }}
                className="absolute right-5 top-[76px] bottom-5 z-50 w-[min(460px,calc(100%-2.5rem))] rounded-[22px] border border-white/10 bg-[#09090d] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
              >
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                        {clusterView === "list" ? "Cluster index" : "Cluster detail"}
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">
                        {clusterView === "list" ? "All active threat clusters" : selectedClusterInsight?.cluster.name}
                      </div>
                      <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {clusterView === "list"
                          ? "Inspect every cluster in the current replay window and jump into the next action surface."
                          : selectedClusterInsight?.recommendedAction}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeClusterPanels}
                      className="rounded-full border border-white/10 p-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <XCircle className="h-5 w-5" />
                    </button>
                  </div>

                  {clusterView === "list" ? (
                    <div className="flex-1 overflow-auto px-5 py-4">
                      <div className="space-y-3">
                        {clusterInsights.map((entry) => (
                          <button
                            key={entry.cluster.id}
                            type="button"
                            onClick={() => openClusterDetail(entry.cluster.id)}
                            className="w-full rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-4 text-left transition-colors hover:bg-white/[0.04]"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-semibold text-foreground">{entry.cluster.name}</span>
                                  <span className="rounded border border-red-500/20 bg-red-500/8 px-1.5 py-0.5 text-[10px] font-mono text-red-300">
                                    {entry.cluster.status.toUpperCase()}
                                  </span>
                                </div>
                                <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                                  {entry.cluster.id} · {entry.cluster.txns} txns · {entry.cluster.merchants} merchants ·{" "}
                                  {entry.cluster.linkedIPs} linked signals
                                </div>
                                <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                  {entry.recommendedAction}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-lg font-semibold text-foreground">{entry.cluster.exposure}</div>
                                <div className="mt-1 text-[11px] font-mono text-amber-400">{entry.cluster.velocity}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : selectedClusterInsight ? (
                    <div className="flex-1 overflow-auto px-5 py-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.02] px-4 py-3">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Exposure</div>
                          <div className="mt-2 text-2xl font-semibold text-foreground">{selectedClusterInsight.cluster.exposure}</div>
                        </div>
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.02] px-4 py-3">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Velocity</div>
                          <div className="mt-2 text-2xl font-semibold text-amber-300">{selectedClusterInsight.cluster.velocity}</div>
                        </div>
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.02] px-4 py-3">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Open alerts</div>
                          <div className="mt-2 text-2xl font-semibold text-foreground">{selectedClusterInsight.openAlerts}</div>
                        </div>
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.02] px-4 py-3">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Merchants</div>
                          <div className="mt-2 text-base font-semibold text-foreground">
                            {selectedClusterInsight.merchants.join(", ") || `${selectedClusterInsight.cluster.merchants} linked merchants`}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-4">
                        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Primary action</div>
                        <div className="mt-2 text-sm leading-relaxed text-foreground">{selectedClusterInsight.recommendedAction}</div>
                      </div>

                      <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.02]">
                        <div className="border-b border-border px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                          Linked alerts
                        </div>
                        <div className="divide-y divide-border">
                          {selectedClusterInsight.linkedAlerts.length > 0 ? (
                            selectedClusterInsight.linkedAlerts.map((alert) => (
                              <div key={alert.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-foreground">{alert.title}</div>
                                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                                      {alert.merchant} · {alert.exposure} · score {alert.score}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onNavigate("alerts")}
                                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-mono text-foreground transition-colors hover:bg-white/[0.04]"
                                  >
                                    Open alerts
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="px-4 py-4 text-sm text-muted-foreground">
                              No linked alert records are available for this cluster in the current replay.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="border-t border-border px-5 py-4">
                    <div className="flex flex-wrap gap-3">
                      {clusterView === "detail" && (
                        <button
                          type="button"
                          onClick={() => setClusterView("list")}
                          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[0.04]"
                        >
                          Back to all clusters
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigate("simulator")}
                        className="rounded-lg border border-primary/25 bg-primary/10 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/15"
                      >
                        Open simulator
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate("copilot")}
                        className="rounded-lg border border-white/10 px-4 py-2 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
                      >
                        Ask Sentinel
                      </button>
                    </div>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
function renderMessage(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="text-foreground font-medium">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="font-mono text-primary bg-primary/8 px-1 py-0.5 rounded text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part === "\n") {
      return <br key={index} />;
    }
    return <span key={index}>{part}</span>;
  });
}

function CopilotScreen({
  data,
  headerAccount,
}: {
  data: ConsoleData;
  headerAccount?: ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(data.initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      content: text,
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sentinel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: nextHistory.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Sentinel request failed with ${response.status}`);
      }

      const payload = (await response.json()) as { answer?: string };
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
          content: payload.answer?.trim() || "No answer returned from the risk assistant.",
        },
      ]);
    } catch {
      setError("Sentinel could not complete the request. Review the local fallback or try again.");
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const sessionQueries = messages.filter((message) => message.role === "user").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="flex-1 flex h-full overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <PageHeader
          title="Sentinel"
          account={headerAccount}
          right={
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{data.copilotProviderLabel}</span>
            </div>
          }
        />

        <div className="flex-1 overflow-auto px-6 py-6 space-y-5">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
              {message.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div className={`max-w-[80%] flex flex-col gap-1 ${message.role === "user" ? "items-end" : ""}`}>
                <div
                  className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    message.role === "assistant"
                      ? "bg-card border border-border text-foreground/90"
                      : "bg-secondary border border-white/8 text-foreground"
                  }`}
                >
                  {message.content.includes("```")
                    ? message.content.split("```").map((part, index) =>
                        index % 2 === 1 ? (
                          <pre
                            key={index}
                            className="font-mono text-[11px] bg-black/40 rounded-lg p-3 mt-2 mb-1 overflow-x-auto text-emerald-300/90 border border-white/5"
                          >
                            {part.trim()}
                          </pre>
                        ) : (
                          <span key={index}>{renderMessage(part)}</span>
                        ),
                      )
                    : renderMessage(message.content)}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/50 px-1">{message.time}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <div
                className="min-w-[58px] bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-center gap-1.5"
                role="status"
                aria-label="Sentinel is typing"
              >
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="sentinel-typing-dot h-1.5 w-1.5 rounded-full bg-white"
                    style={{ animationDelay: `${index * 120}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && <div className="text-[11px] text-red-400 font-mono">{error}</div>}
          <div ref={bottomRef} />
        </div>

        {!loading && (
          <div className="px-6 pb-3 flex gap-2 flex-wrap">
            {data.suggestions.slice(0, 2).map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  setInput(suggestion);
                  inputRef.current?.focus();
                }}
                className="text-[11px] font-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-white/15 transition-all"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 pb-5">
          <div className="flex items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 focus-within:border-primary/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about alerts, merchants, policy thresholds, or draft actions..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground/50 resize-none outline-none leading-relaxed max-h-32 overflow-auto"
              style={{ fontFamily: "var(--font-sans)" }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-30 hover:bg-primary/85 transition-all"
            >
              <Send className="w-3.5 h-3.5 text-primary-foreground" />
            </button>
          </div>
          <div className="mt-2 text-[10px] font-mono text-muted-foreground/40 px-1">
            Shift+Enter for newline · responses are AI-generated and should be reviewed before action
          </div>
        </div>
      </div>

      <div className="w-[270px] flex-shrink-0 flex flex-col overflow-hidden">
        <div className="h-[58px] flex items-center px-5 border-b border-border">
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Session Context</span>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
            <div className="text-[10px] font-mono text-muted-foreground uppercase">Active Merchant</div>
            <div className="text-sm font-medium text-foreground">{data.copilotContext.merchant.name}</div>
            <div className="text-[11px] font-mono text-muted-foreground">{data.copilotContext.merchant.mid}</div>
            <div className="flex items-center justify-between">
              <SeverityBadge level={data.copilotContext.merchant.severity} />
              <span className="text-[11px] font-mono text-red-400">Score {data.copilotContext.merchant.score}</span>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-2">
            <div className="text-[10px] font-mono text-amber-500/60 uppercase">Active Alert</div>
            <div className="text-sm font-medium text-foreground">{data.copilotContext.alert.id}</div>
            <div className="text-[11px] text-muted-foreground">{data.copilotContext.alert.title}</div>
            <div className="text-[11px] font-mono text-amber-400">
              {data.copilotContext.alert.cluster} · {data.copilotContext.alert.time}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
            <div className="text-[10px] font-mono text-muted-foreground uppercase">Recent Actions</div>
            {data.copilotContext.recentActions.map((action) => (
              <div key={action.label} className="flex items-start gap-2.5">
                <CheckCircle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${action.color}`} />
                <div>
                  <div className="text-[11px] text-foreground/90">{action.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{action.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
            <div className="text-[10px] font-mono text-muted-foreground uppercase">This Session</div>
            {[
              { label: "Queries", value: String(sessionQueries) },
              { label: "Actions drafted", value: String(data.copilotContext.recentActions.length) },
              { label: "Live cases", value: String(data.alerts.length) },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{item.label}</span>
                <span className="text-[11px] font-mono text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <AnimatePresence>
        
      </AnimatePresence>
    </motion.div>
  );
}

function getNodeColor(risk: ConsoleSimNode["risk"]) {
  switch (risk) {
    case "critical":
      return "#EF4444";
    case "high":
      return "#F59E0B";
    case "medium":
      return "#D97706";
    case "held":
      return "#8B5CF6";
    default:
      return "#10B981";
  }
}

function getEdgeColor(type: ConsoleSimEdge["type"]) {
  switch (type) {
    case "fraud":
      return "#EF4444";
    case "suspicious":
      return "#F59E0B";
    case "hold":
      return "#8B5CF6";
    case "safe":
      return "#10B981";
    default:
      return "#334155";
  }
}

function SimulatorScreen({
  data,
  onBack,
  onDataReplace,
  viewer,
  operationsMode,
  onOperationsModeChange,
}: {
  data: ConsoleData;
  onBack: () => void;
  onDataReplace: (data: ConsoleData) => void;
  viewer: AuthSessionUser;
  operationsMode: OperationsMode;
  onOperationsModeChange: (mode: OperationsMode) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [transform, setTransform] = useState(SIMULATOR_DEFAULT_TRANSFORM);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeSnapshot, setSelectedNodeSnapshot] = useState<ConsoleSimNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2>(1);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [scenarioLoading, setScenarioLoading] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [nodeActionLoading, setNodeActionLoading] = useState<string | null>(null);
  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [sidebarTab, setSidebarTab] = useState<"command" | "model" | "activity" | "detail">("command");
  const [sidebarResize, setSidebarResize] = useState<null | { startX: number; startWidth: number }>(null);
  const [canvasDrag, setCanvasDrag] = useState<null | { originX: number; originY: number; startX: number; startY: number }>(null);
  const [nodeDrag, setNodeDrag] = useState<null | { nodeId: string; offsetX: number; offsetY: number; startX: number; startY: number }>(null);
  const [uiRestored, setUiRestored] = useState(false);
  const [restoredViewport, setRestoredViewport] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionMovedRef = useRef(false);
  const isHalted = operationsMode === "halted";

  const defaultNodePositions = useMemo(() => resolveSimulatorNodePositions(data.simulator.nodes), [data.simulator.nodes]);

  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(defaultNodePositions);

  useEffect(() => {
    // Live snapshots can add nodes; retain manual positions while adding defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodePositions((current) => mergeSimulatorNodePositions(data.simulator.nodes, defaultNodePositions, current));
  }, [data.simulator.nodes, defaultNodePositions]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIMULATOR_UI_STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved) as {
          transform?: typeof SIMULATOR_DEFAULT_TRANSFORM;
          selectedNodeId?: string | null;
          selectedNodeSnapshot?: ConsoleSimNode | null;
          frameIndex?: number;
          sidebarCollapsed?: boolean;
          sidebarWidth?: number;
          sidebarTab?: "command" | "model" | "activity" | "detail";
          replaySpeed?: 1 | 2;
          showActiveOnly?: boolean;
          nodePositions?: Record<string, { x: number; y: number }>;
        };
        if (state.transform) {
          // Restore the persisted viewport after the client storage boundary is available.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTransform(state.transform);
          setRestoredViewport(true);
        }
        if (typeof state.selectedNodeId !== "undefined") setSelectedNodeId(state.selectedNodeId);
        if (typeof state.selectedNodeSnapshot !== "undefined") setSelectedNodeSnapshot(state.selectedNodeSnapshot);
        if (typeof state.frameIndex === "number") setFrameIndex(state.frameIndex);
        if (typeof state.sidebarCollapsed === "boolean") setSidebarCollapsed(state.sidebarCollapsed);
        if (typeof state.sidebarWidth === "number") setSidebarWidth(clampValue(state.sidebarWidth, 320, 620));
        if (state.sidebarTab) setSidebarTab(state.sidebarTab);
        if (state.replaySpeed === 1 || state.replaySpeed === 2) setReplaySpeed(state.replaySpeed);
        if (typeof state.showActiveOnly === "boolean") setShowActiveOnly(state.showActiveOnly);
        if (state.nodePositions) setNodePositions((current) => ({ ...current, ...state.nodePositions }));
      }
    } catch {
      window.localStorage.removeItem(SIMULATOR_UI_STORAGE_KEY);
    }
    setUiRestored(true);
  }, []);

  useEffect(() => {
    if (!uiRestored) return;
    window.localStorage.setItem(
      SIMULATOR_UI_STORAGE_KEY,
      JSON.stringify({
        transform,
        selectedNodeId,
        selectedNodeSnapshot,
        frameIndex,
        sidebarCollapsed,
        sidebarWidth,
        sidebarTab,
        replaySpeed,
        showActiveOnly,
        nodePositions,
      }),
    );
  }, [frameIndex, nodePositions, replaySpeed, selectedNodeId, selectedNodeSnapshot, showActiveOnly, sidebarCollapsed, sidebarTab, sidebarWidth, transform, uiRestored]);

  const nodes = useMemo(
    () =>
      data.simulator.nodes.map((node) => ({
        ...node,
        x: nodePositions[node.id]?.x ?? node.x,
        y: nodePositions[node.id]?.y ?? node.y,
      })),
    [data.simulator.nodes, nodePositions],
  );

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes],
  ) as Record<string, ConsoleSimNode>;

  const currentFrame = data.simulator.frames[frameIndex % Math.max(data.simulator.frames.length, 1)];
  const activeNodeIds = useMemo(() => new Set(currentFrame?.activeNodeIds ?? []), [currentFrame]);
  const activeEdgeIds = useMemo(() => new Set(currentFrame?.activeEdgeIds ?? []), [currentFrame]);
  const selectedNode = selectedNodeId ? nodeMap[selectedNodeId] ?? selectedNodeSnapshot : null;
  const currentAgentActions = currentFrame?.agentActions ?? [];
  const simulatorReadOnly = !viewer.capabilities.canEditSimulator;
  const policyPresets = [
    { id: "aggressive", label: "Review more", threshold: 64, autoHoldThreshold: 80, analystCapacity: 48 },
    { id: "balanced", label: "Balanced", threshold: 68, autoHoldThreshold: 84, analystCapacity: 40 },
    { id: "strict", label: "Review carefully", threshold: 74, autoHoldThreshold: 88, analystCapacity: 32 },
  ] as const;
  const replayCohortPresets = [
    { id: "linked_attacks", label: "Linked attacks" },
    { id: "merchant_spike", label: "Merchant spike" },
    { id: "chargeback_ring", label: "Chargeback ring" },
    { id: "weekend_burst", label: "Weekend burst" },
  ] as const;

  const getNodeWidth = (node: ConsoleSimNode) => {
    return getSimulatorNodeWidth(node);
  };

  const getNodeHeight = (node: ConsoleSimNode) => {
    return getSimulatorNodeHeight(node);
  };

  const getNodeTone = (node: ConsoleSimNode) => {
    const color = getNodeColor(node.risk);

    return {
      color,
      border: `${color}66`,
      soft: `${color}1A`,
      glow: `${color}30`,
      muted: `${color}B3`,
    };
  };

  const getNodeScore = (node: ConsoleSimNode) => {
    const risk = node.meta?.["Risk score"] ?? node.meta?.["Risk"] ?? node.meta?.["History"] ?? "";
    const numeric = risk.match(/\d+/)?.[0];
    return numeric ?? null;
  };

  const edgePath = (from: ConsoleSimNode, to: ConsoleSimNode) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const controlX = from.x + dx * 0.5;
    const controlY =
      Math.abs(dx) > Math.abs(dy)
        ? from.y + dy * 0.2
        : from.y + dy * 0.5 + (dx >= 0 ? 40 : -40);

    return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
  };

  const visibleNodeIds = useMemo(
    () => (showActiveOnly ? new Set(currentFrame?.activeNodeIds ?? []) : null),
    [currentFrame?.activeNodeIds, showActiveOnly],
  );

  const visibleEdgeIds = useMemo(
    () => (showActiveOnly ? new Set(currentFrame?.activeEdgeIds ?? []) : null),
    [currentFrame?.activeEdgeIds, showActiveOnly],
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };

      return {
        x: (clientX - rect.left - transform.x) / transform.scale,
        y: (clientY - rect.top - transform.y) / transform.scale,
      };
    },
    [transform],
  );

  const fitNodes = useCallback(
    (ids?: string[]) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const targetNodes = (ids?.length ? nodes.filter((node) => ids.includes(node.id)) : nodes).filter(Boolean);
      if (targetNodes.length === 0) return;

      const bounds = targetNodes.reduce(
        (acc, node) => ({
          minX: Math.min(acc.minX, node.x - getNodeWidth(node) / 2),
          maxX: Math.max(acc.maxX, node.x + getNodeWidth(node) / 2),
          minY: Math.min(acc.minY, node.y - getNodeHeight(node) / 2),
          maxY: Math.max(acc.maxY, node.y + getNodeHeight(node) / 2),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      );

      const contentWidth = Math.max(360, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(280, bounds.maxY - bounds.minY);
      const availableWidth = Math.max(240, rect.width - 220);
      const availableHeight = Math.max(240, rect.height - 180);
      const scale = clampValue(
        Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1.2),
        0.36,
        1.5,
      );
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;

      setTransform({
        scale,
        x: rect.width / 2 - centerX * scale,
        y: rect.height / 2 - centerY * scale,
      });
    },
    [nodes],
  );

  const focusActiveFrame = useCallback(() => {
    const ids = Array.from(activeNodeIds);
    if (ids.length === 0) {
      fitNodes();
      return;
    }
    fitNodes(ids);
  }, [activeNodeIds, fitNodes]);

  const resetLayout = useCallback(() => {
    setNodePositions(defaultNodePositions);
    window.requestAnimationFrame(() => fitNodes());
  }, [defaultNodePositions, fitNodes]);

  useEffect(() => {
    if (!uiRestored || restoredViewport) return;
    const frame = window.requestAnimationFrame(() => fitNodes());
    return () => window.cancelAnimationFrame(frame);
  }, [fitNodes, restoredViewport, uiRestored]);

  useEffect(() => {
    if (isHalted || data.simulator.frames.length <= 1) return;
    const timer = setInterval(() => {
      setFrameIndex((value) => value + 1);
    }, replaySpeed === 2 ? 1250 : 2200);
    return () => clearInterval(timer);
  }, [data.simulator.frames.length, isHalted, replaySpeed]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.94 : 1.06;
    setTransform((value) => ({ ...value, scale: clampValue(value.scale * factor, 0.36, 1.85) }));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    if (!canvasDrag && !nodeDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (nodeDrag) {
        if (Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY) > 4) {
          interactionMovedRef.current = true;
        }
        const next = clientToWorld(event.clientX, event.clientY);
        setNodePositions((current) => ({
          ...current,
          [nodeDrag.nodeId]: {
            x: next.x - nodeDrag.offsetX,
            y: next.y - nodeDrag.offsetY,
          },
        }));
        return;
      }

      if (canvasDrag) {
        if (Math.hypot(event.clientX - canvasDrag.startX, event.clientY - canvasDrag.startY) > 4) {
          interactionMovedRef.current = true;
        }
        setTransform((value) => ({
          ...value,
          x: event.clientX - canvasDrag.originX,
          y: event.clientY - canvasDrag.originY,
        }));
      }
    };

    const handleMouseUp = () => {
      setCanvasDrag(null);
      setNodeDrag(null);
      window.setTimeout(() => {
        interactionMovedRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [canvasDrag, clientToWorld, nodeDrag]);

  useEffect(() => {
    if (!sidebarResize) return;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = sidebarResize.startX - event.clientX;
      setSidebarWidth(clampValue(sidebarResize.startWidth + delta, 320, 620));
    };

    const handleMouseUp = () => {
      setSidebarResize(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarResize]);

  useEffect(() => {
    if (selectedNode) {
      // Selecting a graph node opens its persisted detail panel.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarTab("detail");
      setSidebarCollapsed(false);
    }
  }, [selectedNode]);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-sim-control='true']") || target.closest("[data-node='true']")) return;
    event.preventDefault();
    interactionMovedRef.current = false;
    setCanvasDrag({
      originX: event.clientX - transform.x,
      originY: event.clientY - transform.y,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const applyPolicyPreset = useCallback(
    async (preset: (typeof policyPresets)[number]) => {
      if (simulatorReadOnly) {
        setScenarioError("This role can inspect the live replay but cannot change simulator controls.");
        return;
      }
      setScenarioLoading(preset.id);
      setScenarioError(null);

      try {
        const response = await fetch("/api/simulator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threshold: preset.threshold,
            autoHoldThreshold: preset.autoHoldThreshold,
            analystCapacity: preset.analystCapacity,
            stepUpVerification: true,
            velocityClamp: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Simulator request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: ConsoleData };

        if (!payload.data) {
          throw new Error("Simulator response did not return console data.");
        }

        onDataReplace(payload.data);
        setFrameIndex((value) => value + 1);
        setHoveredNodeId(null);
      } catch {
        setScenarioError("Could not rebuild the simulator replay.");
      } finally {
        setScenarioLoading(null);
      }
    },
    [onDataReplace, simulatorReadOnly],
  );

  const applyReplayCohort = useCallback(
    async (cohort: (typeof replayCohortPresets)[number]["id"]) => {
      if (isHalted) {
        setScenarioError("Operations are halted. Select Continue before changing scenarios.");
        return;
      }
      if (simulatorReadOnly) {
        setScenarioError("This role can inspect the live replay but cannot change simulator controls.");
        return;
      }
      setScenarioLoading(cohort);
      setScenarioError(null);

      try {
        const response = await fetch("/api/simulator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data.simulator.config,
            replayCohort: cohort,
          }),
        });

        if (!response.ok) {
          throw new Error(`Simulator request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: ConsoleData };

        if (!payload.data) {
          throw new Error("Simulator response did not return console data.");
        }

        onDataReplace(payload.data);
        setFrameIndex((value) => value + 1);
        setHoveredNodeId(null);
      } catch {
        setScenarioError("Could not switch the replay cohort.");
      } finally {
        setScenarioLoading(null);
      }
    },
    [data.simulator.config, isHalted, onDataReplace, simulatorReadOnly],
  );

  const applyMerchantNodeAction = useCallback(
    async (merchantId: string, merchantName: string, strategy: "strict" | "balanced") => {
      if (isHalted) {
        setScenarioError("Operations are halted. Select Continue before applying business rules.");
        return;
      }
      if (simulatorReadOnly) {
        setScenarioError("This role can inspect the live replay but cannot execute merchant-side interventions.");
        return;
      }
      setNodeActionLoading(`${merchantId}:${strategy}`);
      setScenarioError(null);

      try {
        const response = await fetch("/api/simulator/interventions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tick: currentFrame?.tick ?? 1,
            targetType: "merchant",
            targetId: merchantId,
            targetLabel: merchantName,
            action: strategy === "strict" ? "tighten merchant override" : "reset merchant override",
            effect:
              strategy === "strict"
                ? "Merchant threshold tightened for the remaining replay ticks."
                : "Merchant returned to baseline policy behavior for the remaining replay ticks.",
            merchantOverride: {
              merchantId,
              merchantName,
              strategy,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Intervention request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: ConsoleData };

        if (!payload.data) {
          throw new Error("Simulator response did not return console data.");
        }

        onDataReplace(payload.data);
      } catch {
        setScenarioError("Could not apply the merchant override from the simulator.");
      } finally {
        setNodeActionLoading(null);
      }
    },
    [currentFrame, isHalted, onDataReplace, simulatorReadOnly],
  );

  const clusterReplayCohort = useCallback((clusterId: string) => {
    if (clusterId.includes("history")) return "chargeback_ring" as const;
    if (clusterId.includes("retry")) return "merchant_spike" as const;
    if (clusterId.includes("geo")) return "weekend_burst" as const;
    return "linked_attacks" as const;
  }, []);

  const applyClusterNodeAction = useCallback(
    async (clusterId: string, action: "replay" | "tighten") => {
      if (isHalted) {
        setScenarioError("Operations are halted. Select Continue before changing this pattern.");
        return;
      }
      if (simulatorReadOnly) {
        setScenarioError("This role can inspect the live replay but cannot edit policy from the simulator.");
        return;
      }
      setNodeActionLoading(`${clusterId}:${action}`);
      setScenarioError(null);

      try {
        const response = await fetch("/api/simulator/interventions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tick: currentFrame?.tick ?? 1,
            targetType: "cluster",
            targetId: clusterId,
            targetLabel: selectedNode?.label ?? clusterId,
            action: action === "replay" ? "switch replay cohort" : "raise review thresholds",
            effect:
              action === "replay"
                ? `Replay switched to the ${clusterReplayCohort(clusterId).replaceAll("_", " ")} cohort.`
                : "Threshold and auto-hold increased by 2 points for the remaining replay ticks.",
            nextReplayCohort:
              action === "replay" ? clusterReplayCohort(clusterId) : data.simulator.replayCohort,
            nextConfig:
              action === "replay"
                ? data.simulator.config
                : {
                    threshold: Math.min(80, data.simulator.config.threshold + 2),
                    autoHoldThreshold: Math.min(92, data.simulator.config.autoHoldThreshold + 2),
                  },
          }),
        });

        if (!response.ok) {
          throw new Error(`Intervention request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { data?: ConsoleData };

        if (!payload.data) {
          throw new Error("Simulator response did not return console data.");
        }

        onDataReplace(payload.data);
        setFrameIndex(0);
      } catch {
        setScenarioError("Could not apply the cluster action.");
      } finally {
        setNodeActionLoading(null);
      }
    },
    [
      clusterReplayCohort,
      currentFrame,
      data.simulator.config,
      data.simulator.replayCohort,
      isHalted,
      onDataReplace,
      selectedNode,
      simulatorReadOnly,
    ],
  );

  const sidebarTabs: Array<{
    id: "command" | "model" | "activity" | "detail";
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "command", label: "Controls", icon: Settings },
    { id: "model", label: "Insights", icon: Activity },
    { id: "activity", label: "Team", icon: Bot },
    { id: "detail", label: "Details", icon: Eye },
  ];
  const simulatorMetricCards = currentFrame?.metricCards.length ? currentFrame.metricCards : data.simulator.liveStats;
  const simulatorFeed = currentFrame?.feed ?? [];
  const simulatorTimeline = data.simulator.sessionTimeline.slice().reverse();
  const pendingApprovals = data.simulator.approvals.filter((approval) => approval.status === "pending");
  const resolvedApprovals = data.simulator.approvals.filter((approval) => approval.status !== "pending");
  const agentMemories = data.simulator.agentMemories;
  const agentTelemetry = data.simulator.telemetry;
  const selectedNodeEntries = selectedNode ? Object.entries(selectedNode.meta ?? {}) : [];

  const resolveApprovalAction = useCallback(
    async (approvalId: string, status: "approved" | "rejected") => {
      if (simulatorReadOnly) {
        setScenarioError("This role can inspect agent approvals but cannot resolve them.");
        return;
      }

      setApprovalLoading(`${approvalId}:${status}`);
      setScenarioError(null);

      try {
        const response = await fetch(`/api/simulator/approvals/${approvalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Approval request failed with ${response.status}`);
        }

        const snapshotResponse = await fetch("/api/console");

        if (!snapshotResponse.ok) {
          throw new Error(`Console refresh failed with ${snapshotResponse.status}`);
        }

        const payload = (await snapshotResponse.json()) as { data?: ConsoleData };
        if (!payload.data) {
          throw new Error("Console refresh did not return updated data.");
        }

        onDataReplace(payload.data);
      } catch (error) {
        setScenarioError(error instanceof Error ? error.message : "Could not resolve the agent approval.");
      } finally {
        setApprovalLoading(null);
      }
    },
    [onDataReplace, simulatorReadOnly],
  );

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985, filter: "blur(10px)" }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.992, filter: "blur(8px)" }}
      transition={{ duration: 0.32, ease: UI_EASE_OUT }}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[#e8decf]"
    >
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-[#e8decf] select-none"
          style={{
            cursor: nodeDrag || canvasDrag ? "grabbing" : "grab",
            userSelect: "none",
            touchAction: "none",
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="absolute inset-0 bg-[#e8decf]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,248,236,0.82),transparent_22%),radial-gradient(circle_at_78%_12%,rgba(214,191,154,0.26),transparent_24%),radial-gradient(circle_at_62%_76%,rgba(191,156,112,0.14),transparent_28%),linear-gradient(180deg,rgba(252,247,239,0.42)_0%,rgba(232,222,207,0)_28%,rgba(205,185,156,0.12)_100%)]" />
          <div className="absolute inset-0 opacity-50 mix-blend-multiply [background-image:linear-gradient(115deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_18%,rgba(120,96,68,0.035)_36%,rgba(255,255,255,0)_52%,rgba(255,255,255,0.08)_68%,rgba(120,96,68,0.03)_100%)]" />
          <div
            className="absolute inset-0 opacity-[0.28] mix-blend-multiply"
            style={{
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27 viewBox=%270 0 160 160%27%3E%3Cg fill=%27%23745836%27 fill-opacity=%270.34%27%3E%3Ccircle cx=%2712%27 cy=%2718%27 r=%270.7%27/%3E%3Ccircle cx=%2728%27 cy=%2744%27 r=%270.9%27/%3E%3Ccircle cx=%2756%27 cy=%2714%27 r=%270.8%27/%3E%3Ccircle cx=%2784%27 cy=%2732%27 r=%270.7%27/%3E%3Ccircle cx=%27118%27 cy=%2722%27 r=%271%27/%3E%3Ccircle cx=%27144%27 cy=%2746%27 r=%270.75%27/%3E%3Ccircle cx=%2718%27 cy=%2780%27 r=%270.95%27/%3E%3Ccircle cx=%2740%27 cy=%2798%27 r=%270.7%27/%3E%3Ccircle cx=%2766%27 cy=%2772%27 r=%271.05%27/%3E%3Ccircle cx=%2794%27 cy=%2792%27 r=%270.8%27/%3E%3Ccircle cx=%27122%27 cy=%2788%27 r=%270.7%27/%3E%3Ccircle cx=%27146%27 cy=%2770%27 r=%270.95%27/%3E%3Ccircle cx=%2724%27 cy=%27130%27 r=%270.75%27/%3E%3Ccircle cx=%2750%27 cy=%27118%27 r=%271%27/%3E%3Ccircle cx=%2776%27 cy=%27142%27 r=%270.7%27/%3E%3Ccircle cx=%27106%27 cy=%27124%27 r=%270.85%27/%3E%3Ccircle cx=%27134%27 cy=%27138%27 r=%270.95%27/%3E%3Ccircle cx=%27152%27 cy=%27110%27 r=%270.72%27/%3E%3C/g%3E%3Cg fill=%27%23fffaf1%27 fill-opacity=%270.24%27%3E%3Ccircle cx=%2716%27 cy=%2758%27 r=%270.62%27/%3E%3Ccircle cx=%2748%27 cy=%2762%27 r=%270.58%27/%3E%3Ccircle cx=%2788%27 cy=%2756%27 r=%270.64%27/%3E%3Ccircle cx=%27120%27 cy=%2762%27 r=%270.55%27/%3E%3Ccircle cx=%27138%27 cy=%2794%27 r=%270.6%27/%3E%3Ccircle cx=%2760%27 cy=%27104%27 r=%270.54%27/%3E%3Ccircle cx=%2798%27 cy=%27118%27 r=%270.58%27/%3E%3Ccircle cx=%2736%27 cy=%27148%27 r=%270.56%27/%3E%3Ccircle cx=%27116%27 cy=%27150%27 r=%270.62%27/%3E%3C/g%3E%3C/svg%3E")',
              backgroundSize: "160px 160px",
            }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_36%,rgba(71,52,29,0.09)_100%)]" />

          <svg width="100%" height="100%" className="relative z-[1]">
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
              {data.simulator.edges.map((edge) => {
                const from = nodeMap[edge.from];
                const to = nodeMap[edge.to];
                if (!from || !to) return null;
                if (visibleEdgeIds && !visibleEdgeIds.has(edge.id)) return null;
                const color = getEdgeColor(edge.type);
                const isActive = activeEdgeIds.has(edge.id);
                const dashArray =
                  edge.type === "normal" ? "7 10" : edge.type === "hold" ? "5 8" : edge.type === "safe" ? "3 7" : undefined;
                const path = edgePath(from, to);

                return (
                  <g key={edge.id}>
                    {isActive && !reduceMotion && (
                      <motion.path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth={5}
                        strokeOpacity={0.2}
                        initial={{ pathLength: 0.14, opacity: 0.12 }}
                        animate={{ pathLength: 1, opacity: 0.44 }}
                        transition={{ duration: 0.85, ease: UI_EASE_OUT }}
                      />
                    )}
                    <path
                      d={path}
                      fill="none"
                      stroke={color}
                      strokeOpacity={isActive ? 0.96 : edge.type === "normal" ? 0.18 : 0.38}
                      strokeWidth={isActive ? 2.9 : edge.type === "fraud" ? 1.6 : 1.2}
                      strokeDasharray={dashArray}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="absolute inset-0 z-[2] overflow-hidden" onMouseDown={handleMouseDown}>
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
            >
              {nodes.map((node) => {
                if (visibleNodeIds && !visibleNodeIds.has(node.id)) return null;
                const isSelected = selectedNodeId === node.id;
                const isHovered = hoveredNodeId === node.id;
                const isActive = activeNodeIds.has(node.id);
                const tone = getNodeTone(node);
                const width = getNodeWidth(node);
                const score = getNodeScore(node);
                const metaEntries = getNodeMetaEntries(node);

                return (
                  <motion.button
                    key={node.id}
                    data-node="true"
                    type="button"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 10 }}
                    animate={
                      reduceMotion
                        ? { opacity: 1 }
                        : {
                            opacity: 1,
                            scale: isSelected ? 1.04 : isHovered || isActive ? 1.018 : 1,
                            y: 0,
                            boxShadow:
                              isSelected || isActive
                                ? `0 0 0 1px ${tone.border}, 0 22px 44px ${tone.glow}`
                                : "0 18px 36px rgba(0,0,0,0.28)",
                          }
                    }
                    transition={{ duration: 0.24, ease: UI_EASE_OUT }}
                    className="absolute rounded-[24px] border text-left backdrop-blur-md"
                    draggable={false}
                    style={{
                      left: node.x,
                      top: node.y,
                      width,
                      minHeight: getNodeHeight(node),
                      transform: "translate(-50%, -50%)",
                      borderColor: isSelected || isActive ? tone.border : `${tone.color}33`,
                      background: `linear-gradient(180deg, rgba(7,9,14,0.98), rgba(11,12,18,0.92)), ${tone.soft}`,
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const point = clientToWorld(event.clientX, event.clientY);
                      interactionMovedRef.current = false;
                      setNodeDrag({
                        nodeId: node.id,
                        offsetX: point.x - node.x,
                        offsetY: point.y - node.y,
                        startX: event.clientX,
                        startY: event.clientY,
                      });
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (interactionMovedRef.current) return;
                      setSelectedNodeId((current) => {
                        const next = current === node.id ? null : node.id;
                        setSelectedNodeSnapshot(next ? node : null);
                        return next;
                      });
                    }}
                    onDragStart={(event) => event.preventDefault()}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    <div className="relative overflow-hidden rounded-[24px] px-4 py-3.5">
                      {!reduceMotion && node.type === "cluster" && isActive && (
                        <motion.div
                          aria-hidden
                          className="absolute inset-0"
                          style={{ background: `radial-gradient(circle at 30% 30%, ${tone.glow}, transparent 60%)` }}
                          animate={{ opacity: [0.22, 0.52, 0.22] }}
                          transition={{ duration: 2.6, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
                        />
                      )}
                      <div
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-px"
                        style={{ background: `linear-gradient(90deg, transparent, ${tone.color}88, transparent)` }}
                      />
                      <div className="relative z-10 flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: tone.muted }}>
                            {formatNodeTypeLabel(node.type)}
                          </div>
                          <div className="mt-1 break-all text-[14px] font-semibold leading-[1.25] text-white">
                            {node.label}
                          </div>
                          {node.sublabel && (
                            <div className="mt-1 break-words text-[11px] font-mono leading-snug text-white/62">
                              {node.sublabel}
                            </div>
                          )}
                        </div>
                        {score && (
                          <div
                            className="w-[58px] shrink-0 rounded-[18px] border px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                            style={{ borderColor: `${tone.color}40`, background: `${tone.color}14` }}
                          >
                            <div className="text-[10px] font-mono text-white/55">score</div>
                            <div className="text-lg font-semibold leading-none" style={{ color: tone.color }}>
                              {score}
                            </div>
                          </div>
                        )}
                      </div>
                      {metaEntries.length > 0 && (
                        <div
                          className={`relative z-10 mt-3 grid gap-2 ${
                            node.type === "queue" || node.type === "verifier" ? "grid-cols-1" : "grid-cols-2"
                          }`}
                        >
                          {metaEntries.map(({ key, label, value }) => (
                            <div
                              key={key}
                              className="min-w-0 rounded-[16px] border border-white/6 bg-white/[0.03] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                            >
                              <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-white/36">{label}</div>
                              <div className="mt-1 [overflow-wrap:anywhere] text-[11px] leading-[1.35] text-white/82">{value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: UI_EASE_OUT }}
            className="absolute left-5 top-5 z-10"
            data-sim-control="true"
          >
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#08090d]/88 px-4 py-2 text-[13px] font-medium text-white/88 shadow-[0_14px_36px_rgba(0,0,0,0.32)] backdrop-blur-xl transition-colors hover:bg-[#10121a] hover:text-white"
            >
              <span aria-hidden="true" className="text-[15px] leading-none">
                ←
              </span>
              Exit simulator
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              <span className="rounded-full border border-emerald-500/20 bg-[#08090d]/82 px-2.5 py-1 text-emerald-300 backdrop-blur-xl">
                Live situation {frameIndex + 1}
              </span>
              <span className="rounded-full border border-white/10 bg-[#08090d]/82 px-2.5 py-1 text-white/60 backdrop-blur-xl">
                New payments arrive continuously
              </span>
            </div>
            {simulatorReadOnly ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/22 bg-amber-500/10 px-3 py-1.5 text-[11px] font-mono text-amber-200">
                View-only access
              </div>
            ) : null}
            <div className="hidden">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/82 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <span aria-hidden="true" className="text-[14px] leading-none">
                      ←
                    </span>
                    Exit simulator
                  </button>
                  <div className="mt-3 max-w-[14ch] text-[26px] font-semibold leading-[0.96] tracking-[-0.03em] text-white sm:max-w-[16ch] sm:text-[30px]">
                    {currentFrame?.headline ?? data.simulator.summaryTitle}
                  </div>
                  <div className="mt-2.5 max-w-[30ch] text-[13px] leading-[1.5] text-white/58">
                    {currentFrame?.subline ?? data.simulator.summarySubtitle}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!viewer.capabilities.canManageSystem}
                  onClick={() => onOperationsModeChange(isHalted ? "running" : "halted")}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    !isHalted
                      ? "border-red-500/25 bg-red-500/10 text-red-200"
                      : "border-white/10 bg-white/5 text-white/70 hover:text-white"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${isHalted ? "bg-red-500" : "animate-pulse bg-emerald-400"}`} />
                  {isHalted ? "Operations halted" : "Live replay"}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                  Threshold {data.simulator.config.threshold} · Auto-hold {data.simulator.config.autoHoldThreshold}
                </span>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/55">
                  Live update {frameIndex + 1}
                </span>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/55">
                  Zoom {(transform.scale * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </motion.div>

        </div>

        <div className="relative shrink-0">
          {!sidebarCollapsed && (
            <div
              className={`absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize ${
                sidebarResize ? "bg-amber-400/18" : "bg-transparent"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                setSidebarResize({ startX: event.clientX, startWidth: sidebarWidth });
              }}
            />
          )}

          <motion.aside
            initial={reduceMotion ? false : { opacity: 0, x: 22 }}
            animate={{
              opacity: 1,
              x: 0,
              width: sidebarCollapsed ? 76 : sidebarWidth,
            }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    width: { duration: 0.4, ease: UI_EASE_IN_OUT },
                    opacity: { duration: 0.24, ease: UI_EASE_OUT },
                    x: { duration: 0.28, ease: UI_EASE_OUT },
                  }
            }
            className="relative flex h-full overflow-hidden border-l border-white/8 bg-[#090a0f]/94 backdrop-blur-2xl"
          >
            {sidebarCollapsed ? (
              <div className="flex h-full w-full flex-col items-center gap-3 px-3 py-5">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white"
                  aria-label="Expand simulator sidebar"
                >
                  <ChevronRight className="h-5 w-5 rotate-180" />
                </button>
                <div className="h-px w-full bg-white/8" />
                {sidebarTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = sidebarTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setSidebarTab(tab.id);
                        setSidebarCollapsed(false);
                      }}
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors ${
                        active
                          ? "border-amber-400/28 bg-amber-400/12 text-amber-200"
                          : "border-white/8 bg-white/[0.03] text-white/55 hover:text-white"
                      }`}
                      aria-label={tab.label}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
                <div className="border-b border-white/8 px-5 pb-4 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Control panel</div>
                      <div className="mt-1 text-xl font-semibold text-white">Simulator controls</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSidebarCollapsed(true)}
                      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/65 transition-colors hover:text-white"
                      aria-label="Collapse simulator sidebar"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {sidebarTabs.map((tab) => {
                      const Icon = tab.icon;
                      const active = sidebarTab === tab.id;

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSidebarTab(tab.id)}
                          className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition-colors ${
                            active
                              ? "border-amber-400/30 bg-amber-400/12 text-amber-100"
                              : "border-white/8 bg-white/[0.02] text-white/55 hover:text-white"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  className="min-h-0 h-0 flex-1 overflow-y-scroll overflow-x-hidden px-5 py-5 pr-3 overscroll-y-contain [scrollbar-color:rgba(245,158,11,0.35)_transparent] [scrollbar-width:thin]"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <AnimatePresence mode="wait">
                    {sidebarTab === "command" && (
                      <motion.div
                        key="command"
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                        transition={{ duration: 0.26, ease: UI_EASE_OUT }}
                        className="space-y-4"
                      >
                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Canvas</div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setTransform((value) => ({ ...value, scale: clampValue(value.scale * 1.12, 0.52, 1.85) }))}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/78 transition-colors hover:text-white"
                            >
                              Zoom in
                            </button>
                            <button
                              type="button"
                              onClick={() => setTransform((value) => ({ ...value, scale: clampValue(value.scale * 0.88, 0.52, 1.85) }))}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/78 transition-colors hover:text-white"
                            >
                              Zoom out
                            </button>
                            <button
                              type="button"
                              onClick={focusActiveFrame}
                              className="rounded-2xl border border-amber-400/22 bg-amber-400/10 px-3 py-2 text-left text-sm text-amber-100 transition-colors hover:bg-amber-400/14"
                            >
                              Focus on active step
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowActiveOnly((value) => !value)}
                              className={`rounded-2xl border px-3 py-2 text-left text-sm transition-colors ${
                                showActiveOnly
                                  ? "border-emerald-400/24 bg-emerald-500/10 text-emerald-200"
                                  : "border-white/10 bg-white/[0.03] text-white/78 hover:text-white"
                              }`}
                            >
                              {showActiveOnly ? "Show active only" : "Show full map"}
                            </button>
                            <button
                              type="button"
                              onClick={resetLayout}
                              className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/78 transition-colors hover:text-white"
                            >
                              Reset positions
                            </button>
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Playback speed</div>
                            <button
                              type="button"
                              disabled={!viewer.capabilities.canManageSystem}
                              onClick={() => onOperationsModeChange(isHalted ? "running" : "halted")}
                              className={`rounded-full border px-3 py-1 text-[11px] font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                                !isHalted
                                  ? "border-red-500/25 bg-red-500/10 text-red-300"
                                  : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
                              }`}
                            >
                              {isHalted ? "Continue playback" : "Halt playback"}
                            </button>
                          </div>
                          <div className="mt-3 flex gap-2">
                            {[1, 2].map((speed) => (
                              <button
                                key={speed}
                                type="button"
                                disabled={isHalted}
                                onClick={() => setReplaySpeed(speed as 1 | 2)}
                                className={`rounded-2xl border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  replaySpeed === speed
                                    ? "border-amber-400/26 bg-amber-400/12 text-amber-100"
                                    : "border-white/10 bg-white/[0.03] text-white/70 hover:text-white"
                                }`}
                              >
                                {speed}x speed
                              </button>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Scenarios</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {replayCohortPresets.map((cohort) => (
                              <button
                                key={cohort.id}
                                type="button"
                                disabled={isHalted || scenarioLoading !== null}
                                onClick={() => void applyReplayCohort(cohort.id)}
                                className={`rounded-2xl border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  data.simulator.replayCohort === cohort.id
                                    ? "border-amber-400/28 bg-amber-400/12 text-amber-100"
                                    : scenarioLoading === cohort.id
                                      ? "border-blue-400/26 bg-blue-500/12 text-blue-100"
                                      : "border-white/10 bg-white/[0.03] text-white/65 hover:text-white"
                                }`}
                              >
                                {scenarioLoading === cohort.id ? "Loading..." : cohort.label}
                              </button>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Rule styles</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {policyPresets.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                disabled={isHalted || scenarioLoading !== null}
                                onClick={() => void applyPolicyPreset(preset)}
                                className={`rounded-2xl border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  scenarioLoading === preset.id
                                    ? "border-blue-400/26 bg-blue-500/12 text-blue-100"
                                    : "border-white/10 bg-white/[0.03] text-white/65 hover:text-white"
                                }`}
                              >
                                {scenarioLoading === preset.id ? "Updating..." : preset.label}
                              </button>
                            ))}
                          </div>
                          {scenarioError && <div className="mt-3 text-sm text-red-300">{scenarioError}</div>}
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Current step</div>
                          <div className="mt-2 text-lg font-semibold text-white">{currentFrame?.headline ?? data.simulator.summaryTitle}</div>
                          <div className="mt-2 text-sm leading-relaxed text-white/58">
                            {currentFrame?.subline ?? data.simulator.summarySubtitle}
                          </div>
                          <div className="mt-4 flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isHalted}
                              onClick={() => setFrameIndex((value) => Math.max(0, value - 1))}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              disabled={isHalted}
                              onClick={() => setFrameIndex((value) => value + 1)}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Next
                            </button>
                            <span className="ml-auto text-[11px] font-mono text-white/45">
                              Live update {frameIndex + 1}
                            </span>
                          </div>
                        </section>
                      </motion.div>
                    )}

                    {sidebarTab === "model" && (
                      <motion.div
                        key="model"
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                        transition={{ duration: 0.26, ease: UI_EASE_OUT }}
                        className="space-y-4"
                      >
                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">
                            Live · {data.simulator.statsLabel}
                          </div>
                          <div className="mt-3 space-y-3">
                            {simulatorMetricCards.map((item) => (
                              <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
                                <span className="text-white/58">{item.label}</span>
                                <span className="font-mono text-white">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">
                              Agent health
                            </div>
                            <span className="text-[11px] font-mono text-white/45">{agentTelemetry.length} agents</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {agentTelemetry.length > 0 ? (
                              agentTelemetry.map((entry) => (
                                <div key={entry.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white">{entry.agentName}</div>
                                      <div className="mt-1 text-[11px] font-mono text-white/40">{entry.role}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-sm font-semibold text-white">{entry.avgConfidence}</div>
                                      <div className="mt-1 text-[11px] font-mono text-white/40">average confidence</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-2.5 py-2">
                                      <div className="font-mono text-white/35">Decisions</div>
                                      <div className="mt-1 text-sm font-semibold text-white">{entry.decisions}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-2.5 py-2">
                                      <div className="font-mono text-white/35">Queue delta</div>
                                      <div className="mt-1 text-sm font-semibold text-white">{entry.queueDelta}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-2.5 py-2">
                                      <div className="font-mono text-white/35">Loss avoided</div>
                                      <div className="mt-1 text-sm font-semibold text-white">{entry.estimatedLossPrevented}</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 text-[11px] font-mono text-white/35">{entry.createdAt}</div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                Agent activity will appear here after the team starts making decisions.
                              </div>
                            )}
                          </div>
                        </section>

                        {data.simulator.comparison && (
                          <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Challenger board</div>
                            <div className="mt-2 text-base font-semibold text-white">
                              {data.simulator.comparison.challengerLabel}
                            </div>
                            <div className="mt-1 text-sm text-white/52">{data.simulator.comparison.baselineLabel}</div>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              {data.simulator.comparison.metrics.map((metric) => (
                                <div key={metric.label} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">{metric.label}</div>
                                  <div className="mt-2 text-[11px] text-white/45">Base {metric.baseline}</div>
                                  <div className="mt-1 text-sm font-semibold text-white">Now {metric.challenger}</div>
                                  <div
                                    className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-mono ${
                                      metric.tone === "good"
                                        ? "bg-emerald-500/10 text-emerald-300"
                                        : metric.tone === "warn"
                                          ? "bg-amber-500/10 text-amber-300"
                                          : "bg-red-500/10 text-red-300"
                                    }`}
                                  >
                                    {metric.delta}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 text-sm leading-relaxed text-white/58">
                              {data.simulator.comparison.recommendation}
                            </div>
                          </section>
                        )}

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">What agents learned</div>
                            <span className="text-[11px] font-mono text-white/45">{agentMemories.length} cards</span>
                          </div>
                          <div className="mt-3 space-y-3">
                            {agentMemories.length > 0 ? (
                              agentMemories.map((memory) => (
                                <div key={memory.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white">{memory.title}</div>
                                      <div className="mt-1 text-[11px] font-mono text-white/40">{memory.agentName}</div>
                                    </div>
                                    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-200">
                                      {memory.confidence}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{memory.summary}</div>
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] font-mono text-white/48">
                                      {memory.scopeLabel}
                                    </span>
                                    {memory.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] font-mono text-white/48"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                Saved patterns will appear here as agents learn repeated fraud behavior.
                              </div>
                            )}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Legend</div>
                          <div className="mt-3 space-y-2">
                            {[
                              { color: "#EF4444", label: "High risk" },
                              { color: "#F59E0B", label: "Needs review" },
                              { color: "#D97706", label: "Watch closely" },
                              { color: "#8B5CF6", label: "On hold / in queue" },
                              { color: "#10B981", label: "Cleared / verified" },
                            ].map((entry) => (
                              <div key={entry.label} className="flex items-center gap-3 text-sm text-white/66">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                                <span>{entry.label}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      </motion.div>
                    )}

                    {sidebarTab === "activity" && (
                      <motion.div
                        key="activity"
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                        transition={{ duration: 0.26, ease: UI_EASE_OUT }}
                        className="space-y-4"
                      >
                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Live agent moves</div>
                            <span className="text-[11px] font-mono text-white/45">{currentAgentActions.length} visible</span>
                          </div>
                          <div className="mt-3 space-y-3">
                            {currentAgentActions.length > 0 ? (
                              currentAgentActions.map((action) => (
                                <div key={action.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-white">{action.agentName}</span>
                                    <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-mono text-amber-200">
                                      {action.action}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{action.reasoning}</div>
                                  <div className="mt-2 text-[11px] font-mono text-white/40">
                                    {action.role} · {(action.confidence * 100).toFixed(0)}% confidence
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                No agent moves are visible on this step yet.
                              </div>
                            )}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">
                              Approval requests
                            </div>
                            <span className="text-[11px] font-mono text-white/45">{pendingApprovals.length} pending</span>
                          </div>
                          <div className="mt-3 space-y-3">
                            {pendingApprovals.length > 0 ? (
                              pendingApprovals.map((approval) => (
                                <div key={approval.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-white">{approval.targetLabel}</div>
                                      <div className="mt-1 text-[11px] font-mono text-white/40">
                                        {approval.agentName} · tick {approval.tick} · {approval.requestedAt}
                                      </div>
                                    </div>
                                    <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-mono text-amber-200">
                                      {approval.action}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{approval.rationale}</div>
                                  <div className="mt-3 flex gap-2">
                                    <button
                                      type="button"
                                      disabled={approvalLoading === `${approval.id}:approved`}
                                      onClick={() => void resolveApprovalAction(approval.id, "approved")}
                                      className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/14 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {approvalLoading === `${approval.id}:approved` ? "Approving..." : "Approve"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={approvalLoading === `${approval.id}:rejected`}
                                      onClick={() => void resolveApprovalAction(approval.id, "rejected")}
                                      className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-100 transition-colors hover:bg-red-500/14 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {approvalLoading === `${approval.id}:rejected` ? "Rejecting..." : "Reject"}
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                No pending approvals. The current replay is running inside the approved limits.
                              </div>
                            )}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Recent actions</div>
                            <span className="text-[11px] font-mono text-white/45">{simulatorFeed.length} visible</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {simulatorFeed.map((item) => {
                              const paymentNodeId = `payment_${item.id}`;

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    if (nodeMap[paymentNodeId]) {
                                      setSelectedNodeId(paymentNodeId);
                                      setSidebarTab("detail");
                                    }
                                  }}
                                  className="w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-left transition-colors hover:bg-white/[0.04]"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-white">{item.title}</span>
                                    <span
                                      className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                                        item.outcome === "hold"
                                          ? "border-purple-500/35 bg-purple-500/10 text-purple-200"
                                          : item.outcome === "step-up"
                                            ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                            : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                      }`}
                                    >
                                      {item.outcome}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{item.summary}</div>
                                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-white/40">
                                    <span>{item.action}</span>
                                    <span>{item.amount} · {item.score}/100</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">
                              Finished approvals
                            </div>
                            <span className="text-[11px] font-mono text-white/45">{resolvedApprovals.length} logged</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {resolvedApprovals.length > 0 ? (
                              resolvedApprovals.map((approval) => (
                                <div key={approval.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-white">{approval.targetLabel}</span>
                                    <span
                                      className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                                        approval.status === "approved"
                                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                                          : "border-red-500/25 bg-red-500/10 text-red-200"
                                      }`}
                                    >
                                      {approval.status}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{approval.rationale}</div>
                                  {approval.resolutionNote ? (
                                    <div className="mt-2 text-[11px] font-mono text-white/40">{approval.resolutionNote}</div>
                                  ) : null}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                Resolved approval decisions will be written here for audit visibility.
                              </div>
                            )}
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Session timeline</div>
                            <span className="text-[11px] font-mono text-white/45">{simulatorTimeline.length} logged</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {simulatorTimeline.length > 0 ? (
                              simulatorTimeline.map((entry) => (
                                <div key={entry.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-white">{entry.title}</span>
                                    <span className="text-[11px] font-mono text-amber-200">Tick {entry.tick}</span>
                                  </div>
                                  <div className="mt-2 text-sm leading-relaxed text-white/58">{entry.effect}</div>
                                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-white/40">
                                    <span>{entry.actor}</span>
                                    <span>{entry.time}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/48">
                                No manual changes yet. Use a business or pattern action to record one.
                              </div>
                            )}
                          </div>
                        </section>
                      </motion.div>
                    )}

                    {sidebarTab === "detail" && (
                      <motion.div
                        key="detail"
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                        transition={{ duration: 0.26, ease: UI_EASE_OUT }}
                        className="space-y-4"
                      >
                        {selectedNode ? (
                          <>
                            <section
                              className="rounded-[24px] border bg-white/[0.02] p-4"
                              style={{ borderColor: `${getNodeColor(selectedNode.risk)}40` }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div
                                    className="text-[11px] font-mono uppercase tracking-[0.18em]"
                                    style={{ color: getNodeColor(selectedNode.risk) }}
                                  >
                                    {formatNodeTypeLabel(selectedNode.type)}
                                  </div>
                                  <div className="mt-1 text-xl font-semibold text-white">{selectedNode.label}</div>
                                  {selectedNode.sublabel && (
                                    <div className="mt-2 text-sm text-white/52">{selectedNode.sublabel}</div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedNodeId(null);
                                    setSelectedNodeSnapshot(null);
                                  }}
                                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/65 transition-colors hover:text-white"
                                >
                                  Clear selection
                                </button>
                              </div>
                              <div className="mt-4 space-y-2">
                                {selectedNodeEntries.map(([key, value]) => (
                                  <div key={key} className="flex items-start justify-between gap-3 text-sm">
                                    <span className="font-mono text-white/40">{key}</span>
                                    <span className="text-right text-white/82">{value}</span>
                                  </div>
                                ))}
                              </div>
                            </section>

                            {(selectedNode.type === "merchant" || selectedNode.type === "cluster") && (
                              <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                                <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Quick actions</div>
                                <div className="mt-3 grid gap-2">
                                  {selectedNode.type === "merchant" ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isHalted || nodeActionLoading !== null}
                                        onClick={() =>
                                          void applyMerchantNodeAction(
                                            selectedNode.id.replace("merchant_", ""),
                                            selectedNode.label,
                                            "strict",
                                          )
                                        }
                                        className="rounded-2xl border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-left text-sm text-purple-100 transition-colors hover:bg-purple-500/14 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {nodeActionLoading === `${selectedNode.id.replace("merchant_", "")}:strict`
                                          ? "Updating business..."
                                          : "Use stricter business rules"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isHalted || nodeActionLoading !== null}
                                        onClick={() =>
                                          void applyMerchantNodeAction(
                                            selectedNode.id.replace("merchant_", ""),
                                            selectedNode.label,
                                            "balanced",
                                          )
                                        }
                                        className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-100 transition-colors hover:bg-amber-500/14 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {nodeActionLoading === `${selectedNode.id.replace("merchant_", "")}:balanced`
                                          ? "Resetting business..."
                                          : "Return business to default rules"}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isHalted || nodeActionLoading !== null}
                                        onClick={() => void applyClusterNodeAction(selectedNode.id, "replay")}
                                        className="rounded-2xl border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-left text-sm text-purple-100 transition-colors hover:bg-purple-500/14 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {nodeActionLoading === `${selectedNode.id}:replay`
                                          ? "Switching scenario..."
                                          : "Open this scenario"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isHalted || nodeActionLoading !== null}
                                        onClick={() => void applyClusterNodeAction(selectedNode.id, "tighten")}
                                        className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-100 transition-colors hover:bg-amber-500/14 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {nodeActionLoading === `${selectedNode.id}:tighten`
                                          ? "Adjusting rules..."
                                          : "Tighten rules around this pattern"}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </section>
                            )}
                          </>
                        ) : (
                          <section className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-5">
                            <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/45">Details</div>
                            <div className="mt-3 text-lg font-semibold text-white">Select an item on the map</div>
                            <div className="mt-2 text-sm leading-relaxed text-white/58">
                              Click a payment, business, pattern, review queue, or extra-check item to inspect it and run actions.
                            </div>
                          </section>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </motion.aside>
        </div>
      </div>
    </motion.div>
  );
}

function AlertsScreen({
  data,
  onDataReplace,
  viewer,
  headerAccount,
}: {
  data: ConsoleData;
  onDataReplace: (data: ConsoleData) => void;
  viewer: AuthSessionUser;
  headerAccount?: ReactNode;
}) {
  const { isHalted } = useOperationsStatus();
  const [filter, setFilter] = useState<"all" | "open" | "investigating" | "held" | "escalated">("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(data.alerts[0]?.id ?? null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const filtered = data.alerts.filter(
    (alert) =>
      filter === "all" ||
      alert.status === filter,
  );
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedAlerts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const runAction = useCallback(
    async (caseId: string, action: "hold" | "investigate" | "escalate" | "dismiss") => {
      if (isHalted) return;
      setActionLoading(`${caseId}:${action}`);

      try {
        const response = await fetch(`/api/cases/${caseId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Case action failed with ${response.status}`);
        }

        const snapshotResponse = await fetch("/api/console");

        if (snapshotResponse.ok) {
          const payload = (await snapshotResponse.json()) as { data?: ConsoleData };
          if (payload.data) {
            onDataReplace(payload.data);
          }
        }
      } finally {
        setActionLoading(null);
      }
    },
    [isHalted, onDataReplace],
  );

  const saveComment = useCallback(
    async (caseId: string) => {
      if (isHalted) return;
      const content = noteDrafts[caseId]?.trim();
      if (!content) return;

      setActionLoading(`${caseId}:comment`);

      try {
        const response = await fetch(`/api/cases/${caseId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Comment request failed with ${response.status}`);
        }

        setNoteDrafts((current) => ({ ...current, [caseId]: "" }));

        const snapshotResponse = await fetch("/api/console");
        if (snapshotResponse.ok) {
          const payload = (await snapshotResponse.json()) as { data?: ConsoleData };
          if (payload.data) {
            onDataReplace(payload.data);
          }
        }
      } finally {
        setActionLoading(null);
      }
    },
    [isHalted, noteDrafts, onDataReplace],
  );

  const canReviewAlert = useCallback(
    (merchantId?: string | null) =>
      viewer.capabilities.canReviewAlerts && viewerCanAccessMerchant(viewer, merchantId),
    [viewer],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="flex-1 flex flex-col h-full overflow-hidden"
    >
      <PageHeader
        title="Payments to review"
        live
        account={headerAccount}
        right={
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <span className="text-[11px] font-mono text-muted-foreground">{data.alerts.length} alerts</span>
            <button className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-2.5 py-1.5">
              <Filter className="w-3 h-3" /> Filter
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2.5 sm:px-5">
        {(["all", "open", "investigating", "held", "escalated"] as const).map((item) => (
          <button
            key={item}
            onClick={() => {
              setFilter(item);
              setPage(1);
              setExpanded(null);
            }}
            className={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all ${
              filter === item ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto divide-y divide-border">
        {paginatedAlerts.map((alert) => (
          <div key={alert.id} className="transition-colors hover:bg-white/[0.015]">
            <div
              className="flex cursor-pointer items-start gap-3 px-4 py-4 sm:items-center sm:gap-4 sm:px-5"
              onClick={() => setExpanded((current) => (current === alert.id ? null : alert.id))}
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  alert.severity === "critical"
                    ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                    : alert.severity === "high"
                      ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                      : "bg-yellow-400"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-mono text-muted-foreground">{alert.id}</span>
                  <SeverityBadge level={alert.severity} />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground border border-white/8">
                    {alert.type.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="text-sm font-medium text-foreground mt-0.5">{alert.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {alert.merchant} · {alert.mid}
                </div>
              </div>
              <div className="flex-shrink-0 space-y-1 text-right">
                <ScoreBar score={alert.score} />
                <div className="text-[11px] font-mono text-muted-foreground">{alert.exposure}</div>
                <div className="text-[10px] text-muted-foreground/50">{alert.time}</div>
              </div>
              <ChevronRight
                className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform ${
                  expanded === alert.id ? "rotate-90" : ""
                }`}
              />
            </div>

            <AnimatePresence>
              {expanded === alert.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 px-4 pb-4 pt-1 sm:px-5">
                    <div className="rounded-lg bg-card border border-border p-3.5">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Why this payment was flagged</div>
                      <p className="text-[12px] text-foreground/85 leading-relaxed">{alert.reason}</p>
                      <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                        <div>
                          Analyst owner: <span className="text-foreground">{alert.assignee}</span>
                        </div>
                        <div>
                          Review status: <span className="text-foreground">{alert.status}</span>
                        </div>
                      </div>
                      {alert.auditNote && <p className="mt-2 text-[11px] text-primary/90">{alert.auditNote}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!canReviewAlert(alert.merchantId) && (
                        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-mono text-amber-300">
                          Read-only scope
                        </div>
                      )}
                      <button
                        onClick={() => void runAction(alert.caseId, "hold")}
                        disabled={isHalted || actionLoading !== null || !canReviewAlert(alert.merchantId)}
                        className="text-[11px] font-mono px-3 py-2 rounded-md border border-purple-500/35 text-purple-400 hover:bg-purple-500/8 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Lock className="w-3 h-3" /> {actionLoading === `${alert.caseId}:hold` ? "Holding..." : "Hold"}
                      </button>
                      <button
                        onClick={() => void runAction(alert.caseId, "investigate")}
                        disabled={isHalted || actionLoading !== null || !canReviewAlert(alert.merchantId)}
                        className="text-[11px] font-mono px-3 py-2 rounded-md border border-amber-500/35 text-amber-400 hover:bg-amber-500/8 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Eye className="w-3 h-3" /> {actionLoading === `${alert.caseId}:investigate` ? "Routing..." : "Investigate"}
                      </button>
                      <button
                        onClick={() => void runAction(alert.caseId, "escalate")}
                        disabled={isHalted || actionLoading !== null || !canReviewAlert(alert.merchantId)}
                        className="text-[11px] font-mono px-3 py-2 rounded-md border border-red-500/35 text-red-400 hover:bg-red-500/8 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <ArrowUpRight className="w-3 h-3" /> {actionLoading === `${alert.caseId}:escalate` ? "Sending up..." : "Send up"}
                      </button>
                      <button
                        onClick={() => void runAction(alert.caseId, "dismiss")}
                        disabled={isHalted || actionLoading !== null || !canReviewAlert(alert.merchantId)}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[11px] font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 sm:ml-auto"
                      >
                        <XCircle className="w-3 h-3" /> {actionLoading === `${alert.caseId}:dismiss` ? "Clearing..." : "Clear"}
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{alert.recommendation}</div>
                    <div className="rounded-lg bg-card border border-border p-3.5">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="text-[10px] font-mono text-muted-foreground uppercase">Analyst Notes</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{alert.comments.length} recent</div>
                      </div>
                      <div className="space-y-2">
                        {alert.comments.length > 0 ? (
                          alert.comments.map((comment, index) => (
                            <div key={`${comment.author}-${comment.createdAt}-${index}`} className="rounded-md border border-white/6 bg-white/[0.02] px-2.5 py-2">
                              <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-muted-foreground">
                                <span>{comment.author}</span>
                                <span>{new Date(comment.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-foreground/85 leading-relaxed">{comment.content}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-[11px] text-muted-foreground">No analyst note yet.</div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={noteDrafts[alert.caseId] ?? ""}
                          disabled={isHalted}
                          onChange={(event) =>
                            setNoteDrafts((current) => ({ ...current, [alert.caseId]: event.target.value }))
                          }
                          placeholder="Add analyst note..."
                          className="min-w-0 flex-1 rounded-md border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] text-foreground placeholder-muted-foreground/50 outline-none"
                        />
                        <button
                          onClick={() => void saveComment(alert.caseId)}
                          disabled={isHalted || actionLoading !== null || !canReviewAlert(alert.merchantId)}
                          className="text-[11px] font-mono px-3 py-2 rounded-md border border-primary/35 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === `${alert.caseId}:comment` ? "Saving..." : "Save note"}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
      <TablePagination page={currentPage} pageSize={pageSize} totalItems={filtered.length} onPageChange={setPage} />
    </motion.div>
  );
}

function MerchantsScreen({
  data,
  onDataReplace,
  viewer,
  headerAccount,
}: {
  data: ConsoleData;
  onDataReplace: (data: ConsoleData) => void;
  viewer: AuthSessionUser;
  headerAccount?: ReactNode;
}) {
  const { isHalted } = useOperationsStatus();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<ConsoleData["merchants"][number] | null>(null);
  const closeMerchantDetails = useCallback(() => setSelectedMerchant(null), []);
  const filtered = data.merchants.filter(
    (merchant) =>
      merchant.name.toLowerCase().includes(search.toLowerCase()) ||
      merchant.id.toLowerCase().includes(search.toLowerCase()) ||
      merchant.region.toLowerCase().includes(search.toLowerCase()),
  );
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedMerchants = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const applyOverride = useCallback(
    async (merchantId: string, merchantName: string, strategy: "strict" | "balanced" | "lenient") => {
      if (isHalted) return;
      setOverrideLoading(`${merchantId}:${strategy}`);

      try {
        const response = await fetch("/api/merchants/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantId, merchantName, strategy }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Override request failed with ${response.status}`);
        }

        const snapshotResponse = await fetch("/api/console");
        if (snapshotResponse.ok) {
          const payload = (await snapshotResponse.json()) as { data?: ConsoleData };
          if (payload.data) {
            onDataReplace(payload.data);
            const refreshedMerchant = payload.data.merchants.find(
              (merchant) => merchant.id.toLowerCase() === merchantId,
            );
            if (refreshedMerchant) setSelectedMerchant(refreshedMerchant);
          }
        }
      } finally {
        setOverrideLoading(null);
      }
    },
    [isHalted, onDataReplace],
  );

  const canManageMerchant = useCallback(
    (merchantId: string) =>
      viewer.capabilities.canManageMerchantOverrides && viewerCanAccessMerchant(viewer, merchantId.toLowerCase()),
    [viewer],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="flex-1 flex flex-col h-full overflow-hidden"
    >
      <PageHeader
        title="Businesses"
        account={headerAccount}
        right={
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search merchants..."
                className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 sm:w-48 sm:flex-none"
                style={{ fontFamily: "var(--font-sans)" }}
              />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">{filtered.length} merchants</span>
          </div>
        }
      />

      <div className="hidden grid-cols-[minmax(280px,2fr)_minmax(130px,1fr)_minmax(160px,1fr)_100px_110px_90px_60px] border-b border-border px-5 py-2.5 xl:grid">
        {["Business", "Category", "Business ID", "Risk score", "Chargeback rate", "Risk rate", "Alerts"].map((header) => (
          <div key={header} className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {header}
          </div>
        ))}
      </div>

      <div className="hidden min-h-0 flex-1 divide-y divide-border overflow-auto xl:block">
        {paginatedMerchants.map((merchant) => (
          <button
            type="button"
            key={merchant.id}
            onClick={() => setSelectedMerchant(merchant)}
            aria-label={`View details for ${merchant.name}`}
            className="grid w-full grid-cols-[minmax(280px,2fr)_minmax(130px,1fr)_minmax(160px,1fr)_100px_110px_90px_60px] items-center px-5 py-3.5 text-left transition-colors hover:bg-white/[0.025] focus-visible:z-10 focus-visible:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
          >
            <div>
              <div className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    merchant.riskLevel === "critical"
                      ? "bg-red-500"
                      : merchant.riskLevel === "high"
                        ? "bg-amber-500"
                        : merchant.riskLevel === "medium"
                          ? "bg-yellow-400"
                          : "bg-emerald-500"
                  }`}
                />
                <span className="text-sm text-foreground font-medium">{merchant.name}</span>
                <SeverityBadge level={merchant.riskLevel} />
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 ml-3.5">
                {merchant.txnVolume} · {merchant.region} · {merchant.owner}
              </div>
            </div>
            <div className="min-w-0 pr-3 text-[12px] text-muted-foreground">{merchant.category}</div>
            <div className="min-w-0 break-all pr-3 text-[11px] font-mono text-muted-foreground">{merchant.id}</div>
            <ScoreBar score={merchant.riskScore} />
            <div className={`text-[12px] font-mono ${parseFloat(merchant.cbRate) > 1.5 ? "text-red-400" : parseFloat(merchant.cbRate) > 0.5 ? "text-amber-400" : "text-emerald-400"}`}>
              {merchant.cbRate}
            </div>
            <div className={`text-[12px] font-mono ${parseFloat(merchant.fraudRate) > 2 ? "text-red-400" : parseFloat(merchant.fraudRate) > 0.5 ? "text-amber-400" : "text-emerald-400"}`}>
              {merchant.fraudRate}
            </div>
            <div className="flex items-center gap-1.5">
              {merchant.alerts > 0 ? (
                <span className="text-[10px] font-mono font-bold text-red-400 bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 rounded">
                  {merchant.alerts}
                </span>
              ) : (
                <span className="text-[11px] font-mono text-muted-foreground/40">—</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 divide-y divide-border overflow-auto xl:hidden">
        {paginatedMerchants.map((merchant) => (
          <button
            type="button"
            key={merchant.id}
            onClick={() => setSelectedMerchant(merchant)}
            aria-label={`View details for ${merchant.name}`}
            className="block w-full px-4 py-4 text-left transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                      merchant.riskLevel === "critical"
                        ? "bg-red-500"
                        : merchant.riskLevel === "high"
                          ? "bg-amber-500"
                          : merchant.riskLevel === "medium"
                            ? "bg-yellow-400"
                            : "bg-emerald-500"
                    }`}
                  />
                  <span className="break-words text-sm font-medium text-foreground">{merchant.name}</span>
                  <SeverityBadge level={merchant.riskLevel} />
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {merchant.txnVolume} · {merchant.region} · {merchant.owner}
                </div>
              </div>
              <ScoreBar score={merchant.riskScore} />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/8 pt-3 sm:grid-cols-3">
              <DetailField label="Category" value={merchant.category} />
              <DetailField label="Business ID" value={merchant.id} />
              <DetailField label="Chargeback rate" value={merchant.cbRate} tone={parseFloat(merchant.cbRate) > 1.5 ? "bad" : parseFloat(merchant.cbRate) > 0.5 ? "warn" : "good"} />
              <DetailField label="Risk rate" value={merchant.fraudRate} tone={parseFloat(merchant.fraudRate) > 2 ? "bad" : parseFloat(merchant.fraudRate) > 0.5 ? "warn" : "good"} />
              <DetailField label="Active alerts" value={merchant.alerts.toLocaleString("en-IN")} tone={merchant.alerts > 0 ? "bad" : "good"} />
            </dl>
          </button>
        ))}
      </div>
      <TablePagination page={currentPage} pageSize={pageSize} totalItems={filtered.length} onPageChange={setPage} />
      <AnimatePresence>
        {selectedMerchant ? (
          <RecordDetailDialog
            recordLabel="Business"
            title={selectedMerchant.name}
            summary={`${selectedMerchant.name} is currently rated ${selectedMerchant.riskLevel} risk with a score of ${selectedMerchant.riskScore} out of 100. ${selectedMerchant.alerts > 0 ? `${selectedMerchant.alerts} active warning${selectedMerchant.alerts === 1 ? " needs" : "s need"} review.` : "There are no active warnings for this business."}`}
            onClose={closeMerchantDetails}
          >
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge level={selectedMerchant.riskLevel} />
              <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-mono text-muted-foreground">{selectedMerchant.id}</span>
              <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-mono text-muted-foreground">{selectedMerchant.tier} tier</span>
            </div>

            <section className="mt-6" aria-labelledby="merchant-profile-heading">
              <h3 id="merchant-profile-heading" className="text-sm font-semibold text-foreground">Business profile</h3>
              <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                <DetailField label="Category" value={selectedMerchant.category} />
                <DetailField label="Operating region" value={selectedMerchant.region} />
                <DetailField label="Account owner" value={selectedMerchant.owner} />
                <DetailField label="Payment volume" value={selectedMerchant.txnVolume} />
              </dl>
            </section>

            <section className="mt-6" aria-labelledby="merchant-risk-heading">
              <h3 id="merchant-risk-heading" className="text-sm font-semibold text-foreground">Risk and review position</h3>
              <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                <DetailField label="Risk score" value={`${selectedMerchant.riskScore} / 100`} tone={selectedMerchant.riskScore >= 80 ? "bad" : selectedMerchant.riskScore >= 60 ? "warn" : "good"} />
                <DetailField label="Active warnings" value={selectedMerchant.alerts.toLocaleString("en-IN")} tone={selectedMerchant.alerts > 0 ? "warn" : "good"} />
                <DetailField label="Chargeback rate" value={selectedMerchant.cbRate} tone={parseFloat(selectedMerchant.cbRate) > 1.5 ? "bad" : parseFloat(selectedMerchant.cbRate) > 0.5 ? "warn" : "good"} />
                <DetailField label="Suspected fraud rate" value={selectedMerchant.fraudRate} tone={parseFloat(selectedMerchant.fraudRate) > 2 ? "bad" : parseFloat(selectedMerchant.fraudRate) > 0.5 ? "warn" : "good"} />
                <DetailField label="Payments currently held" value={selectedMerchant.holdPct} tone={parseFloat(selectedMerchant.holdPct) > 5 ? "warn" : "default"} />
                <DetailField label="Current review rule" value={selectedMerchant.override?.summary ?? "Standard review rules are active."} />
              </dl>
            </section>

            <section className="mt-6 border-y border-white/8 py-5" aria-labelledby="merchant-rules-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="merchant-rules-heading" className="text-sm font-semibold text-foreground">Business-specific review rules</h3>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {selectedMerchant.override?.summary ?? "Standard review rules are active."}
                  </p>
                </div>
                <span className="rounded-md border border-primary/25 bg-primary/8 px-2 py-1 text-[10px] font-mono uppercase text-primary">
                  {selectedMerchant.override?.strategy ?? "standard"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["strict", "balanced", "lenient"] as const).map((strategy) => (
                  <button
                    key={`${selectedMerchant.id}-modal-${strategy}`}
                    type="button"
                    onClick={() => void applyOverride(selectedMerchant.id.toLowerCase(), selectedMerchant.name, strategy)}
                    disabled={isHalted || !canManageMerchant(selectedMerchant.id) || overrideLoading !== null}
                    className={`min-h-9 rounded-md border px-3 text-[11px] font-mono transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      selectedMerchant.override?.strategy === strategy
                        ? "border-primary/40 bg-primary/12 text-primary"
                        : "border-white/12 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {overrideLoading === `${selectedMerchant.id.toLowerCase()}:${strategy}`
                      ? "Saving..."
                      : strategy === "strict"
                        ? "More checks"
                        : strategy === "lenient"
                          ? "Fewer checks"
                          : "Balanced"}
                  </button>
                ))}
              </div>
              {isHalted ? (
                <p className="mt-3 text-xs text-amber-300">Continue operations before changing review rules.</p>
              ) : !canManageMerchant(selectedMerchant.id) ? (
                <p className="mt-3 text-xs text-amber-300">You can inspect this business but your role cannot change its review rules.</p>
              ) : null}
            </section>

            <section className="mt-6" aria-labelledby="merchant-payments-heading">
              <div className="flex items-center justify-between gap-4">
                <h3 id="merchant-payments-heading" className="text-sm font-semibold text-foreground">Recent payments in this view</h3>
                <span className="text-[10px] font-mono text-muted-foreground">Latest 5</span>
              </div>
              <div className="mt-2 divide-y divide-white/8 border-y border-white/8">
                {data.transactions.filter((transaction) => transaction.merchant === selectedMerchant.name).slice(0, 5).map((transaction) => (
                  <div key={`${selectedMerchant.id}-${transaction.id}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-mono text-foreground">{transaction.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{transaction.method} · {transaction.device}</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{transaction.amount}</div>
                    <StatusBadge status={transaction.status} />
                  </div>
                ))}
                {data.transactions.every((transaction) => transaction.merchant !== selectedMerchant.name) ? (
                  <p className="py-4 text-sm text-muted-foreground">No recent payment from this business is present in the current live snapshot.</p>
                ) : null}
              </div>
            </section>
          </RecordDetailDialog>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function TransactionsScreen({ data, headerAccount }: { data: ConsoleData; headerAccount?: ReactNode }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "held" | "declined" | "success" | "processing">("all");
  const [page, setPage] = useState(1);
  const [selectedTransaction, setSelectedTransaction] = useState<ConsoleData["transactions"][number] | null>(null);
  const closeTransactionDetails = useCallback(() => setSelectedTransaction(null), []);
  const filtered = data.transactions.filter((transaction) => statusFilter === "all" || transaction.status === statusFilter);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedTransactions = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedTransactionMerchant = selectedTransaction
    ? data.merchants.find((merchant) => merchant.name === selectedTransaction.merchant) ?? null
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="flex-1 flex flex-col h-full overflow-hidden"
    >
      <PageHeader
        title="Recent payments"
        live
        account={headerAccount}
        right={<span className="text-[11px] font-mono text-muted-foreground">{data.transactions.length} recent payments</span>}
      />

      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-border">
        {(["all", "held", "declined", "processing", "success"] as const).map((item) => (
          <button
            key={item}
            onClick={() => {
              setStatusFilter(item);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all ${
              statusFilter === item ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid px-5 py-2.5 border-b border-border" style={{ gridTemplateColumns: "130px 1.5fr 80px 1fr 80px 80px 80px" }}>
        {["Payment ID", "Business", "Amount", "Payment method / device", "Status", "Risk score", "Time"].map((header) => (
          <div key={header} className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {header}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto divide-y divide-border">
        {paginatedTransactions.map((transaction) => (
          <button
            type="button"
            key={transaction.id}
            onClick={() => setSelectedTransaction(transaction)}
            aria-label={`View details for payment ${transaction.id}`}
            className="grid w-full items-center px-5 py-3 text-left transition-colors hover:bg-white/[0.025] focus-visible:z-10 focus-visible:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
            style={{ gridTemplateColumns: "130px 1.5fr 80px 1fr 80px 80px 80px" }}
          >
            <div>
              <div className="text-[11px] font-mono text-muted-foreground">{transaction.id}</div>
              {transaction.flag && (
                <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 mt-0.5 inline-block">
                  {transaction.flag.replaceAll("_", " ")}
                </span>
              )}
            </div>
            <div className="text-[12px] text-foreground/90 truncate pr-4">{transaction.merchant}</div>
            <div className="font-display font-bold text-foreground text-sm">{transaction.amount}</div>
            <div>
              <div className="text-[11px] text-muted-foreground">
                {transaction.method}
                {transaction.bin ? ` · ${transaction.bin}` : ""}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">{transaction.device}</div>
            </div>
            <StatusBadge status={transaction.status} />
            <ScoreBar score={transaction.score} size="sm" />
            <div className="text-[11px] font-mono text-muted-foreground/60">{transaction.time}</div>
          </button>
        ))}
      </div>
      <TablePagination page={currentPage} pageSize={pageSize} totalItems={filtered.length} onPageChange={setPage} />
      <AnimatePresence>
        {selectedTransaction ? (
          <RecordDetailDialog
            recordLabel="Payment"
            title={selectedTransaction.id}
            summary={`${selectedTransaction.amount} was submitted to ${selectedTransaction.merchant} using ${selectedTransaction.method}. It is ${selectedTransaction.status} with a risk score of ${selectedTransaction.score} out of 100${selectedTransaction.flag ? ` because ${selectedTransaction.flag.replaceAll("_", " ")}.` : "."}`}
            onClose={closeTransactionDetails}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selectedTransaction.status} />
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono ${selectedTransaction.score >= 80 ? "border-red-500/25 bg-red-500/10 text-red-300" : selectedTransaction.score >= 60 ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"}`}>
                Risk {selectedTransaction.score}/100
              </span>
            </div>

            <section className="mt-6" aria-labelledby="payment-summary-heading">
              <h3 id="payment-summary-heading" className="text-sm font-semibold text-foreground">Payment summary</h3>
              <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                <DetailField label="Amount" value={selectedTransaction.amount} />
                <DetailField label="Current status" value={selectedTransaction.status.charAt(0).toUpperCase() + selectedTransaction.status.slice(1)} tone={selectedTransaction.status === "success" ? "good" : selectedTransaction.status === "processing" ? "warn" : "bad"} />
                <DetailField label="Business" value={selectedTransaction.merchant} />
                <DetailField label="Observed at" value={selectedTransaction.time} />
                <DetailField label="Risk score" value={`${selectedTransaction.score} / 100`} tone={selectedTransaction.score >= 80 ? "bad" : selectedTransaction.score >= 60 ? "warn" : "good"} />
                <DetailField label="Primary warning" value={selectedTransaction.flag?.replaceAll("_", " ") ?? "No specific warning was attached."} tone={selectedTransaction.flag ? "warn" : "good"} />
              </dl>
            </section>

            <section className="mt-6" aria-labelledby="payment-source-heading">
              <h3 id="payment-source-heading" className="text-sm font-semibold text-foreground">Payment source</h3>
              <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                <DetailField label="Payment method" value={selectedTransaction.method} />
                <DetailField label="Card or bank identifier" value={selectedTransaction.bin ?? "Not provided for this payment method"} />
                <DetailField label="Device" value={selectedTransaction.device} />
                <DetailField label="Network address" value={selectedTransaction.ip} />
              </dl>
            </section>

            <section className="mt-6" aria-labelledby="payment-business-heading">
              <h3 id="payment-business-heading" className="text-sm font-semibold text-foreground">Business context</h3>
              {selectedTransactionMerchant ? (
                <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                  <DetailField label="Business ID" value={selectedTransactionMerchant.id} />
                  <DetailField label="Category" value={selectedTransactionMerchant.category} />
                  <DetailField label="Business risk" value={`${selectedTransactionMerchant.riskLevel} (${selectedTransactionMerchant.riskScore}/100)`} tone={selectedTransactionMerchant.riskScore >= 80 ? "bad" : selectedTransactionMerchant.riskScore >= 60 ? "warn" : "good"} />
                  <DetailField label="Active business warnings" value={selectedTransactionMerchant.alerts.toLocaleString("en-IN")} tone={selectedTransactionMerchant.alerts > 0 ? "warn" : "good"} />
                </dl>
              ) : (
                <p className="mt-3 border-y border-white/8 py-4 text-sm text-muted-foreground">This payment is available, but its business profile is not in the current live snapshot.</p>
              )}
            </section>
          </RecordDetailDialog>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export default function ConsoleApp({
  initialScreen = "overview",
  initialOperationsMode = "running",
  data,
  viewer,
}: {
  initialScreen?: Screen;
  initialOperationsMode?: OperationsMode;
  data: ConsoleData;
  viewer: AuthSessionUser;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const operationsControl = useOperationsControl(initialOperationsMode);
  const { mode: operationsMode, isHalted } = operationsControl;
  const setOperationsMode = viewer.capabilities.canManageSystem
    ? operationsControl.setMode
    : () => undefined;
  const [liveData, setLiveData] = useState(data);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [lastNonImmersiveScreen, setLastNonImmersiveScreen] = useState<Screen>(
    initialScreen === "simulator" || initialScreen === "control-room" ? "overview" : initialScreen,
  );

  useEffect(() => {
    // Keep the mutable live snapshot aligned with server-provided route data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveData(data);
  }, [data]);

  useEffect(() => {
    const syncFromLocation = () => {
      const next = screenFromPathname(window.location.pathname);
      if (!canViewScreen(viewer.role, next)) {
        window.history.replaceState({ screen: "overview" }, "", "/overview");
        startTransition(() => setScreen("overview"));
        return;
      }
      startTransition(() => {
        setScreen(next);
      });
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [viewer.role]);

  useEffect(() => {
    if (screen !== "simulator" && screen !== "control-room") {
      // Remember the last standard route so immersive views can return to it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastNonImmersiveScreen(screen);
    }
  }, [screen]);

  useEffect(() => {
    if (isHalted) return;

    let active = true;
    let controller: AbortController | null = null;

    const refreshLiveFeed = async () => {
      if (document.visibilityState !== "visible") return;

      controller?.abort();
      controller = new AbortController();

      try {
        const response = await fetch("/api/console?live=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { data?: ConsoleData };
        if (active && payload.data) {
          startTransition(() => setLiveData(payload.data!));
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the last complete snapshot visible during a temporary feed interruption.
        }
      }
    };

    const timer = window.setInterval(() => void refreshLiveFeed(), 10_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [isHalted, screen]);

  const navigate = useCallback((next: Screen) => {
    if (!canViewScreen(viewer.role, next)) return;
    const path = pathForScreen(next);

    startTransition(() => {
      setScreen(next);
    });

    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState({ screen: next }, "", path);
    }
  }, [viewer.role]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }, [router]);

  const headerAccount = <HeaderAccountChrome viewer={viewer} onLogout={() => void logout()} />;
  const immersiveScreen = screen === "simulator" || screen === "control-room";

  const renderedScreen =
    screen === "overview" ? (
      <OverviewScreen data={liveData} onNavigate={navigate} headerAccount={headerAccount} isHalted={isHalted} />
    ) : screen === "copilot" ? (
      <CopilotScreen data={liveData} headerAccount={headerAccount} />
    ) : screen === "control-room" ? (
    <SentinelControlRoomScreen
      data={liveData}
      onBack={() => navigate(lastNonImmersiveScreen)}
      onDataReplace={setLiveData}
      canResolveApprovals={viewer.capabilities.canEditSimulator}
      canManageOperations={viewer.capabilities.canManageSystem}
      operationsMode={operationsMode}
      onOperationsModeChange={setOperationsMode}
    />
    ) : screen === "simulator" ? (
      <SimulatorScreen
        data={liveData}
        onBack={() => navigate(lastNonImmersiveScreen)}
        onDataReplace={setLiveData}
        viewer={viewer}
        operationsMode={operationsMode}
        onOperationsModeChange={setOperationsMode}
      />
    ) : screen === "alerts" ? (
      <AlertsScreen data={liveData} onDataReplace={setLiveData} viewer={viewer} headerAccount={headerAccount} />
    ) : screen === "merchants" ? (
      <MerchantsScreen data={liveData} onDataReplace={setLiveData} viewer={viewer} headerAccount={headerAccount} />
    ) : screen === "admin" ? (
      <AdminUsersScreen viewer={viewer} onLogout={() => void logout()} />
    ) : (
      <TransactionsScreen data={liveData} headerAccount={headerAccount} />
    );

  return (
    <OperationsControlContext.Provider value={operationsControl}>
    <div className="flex h-dvh max-h-dvh bg-background overflow-hidden" style={{ fontFamily: "var(--font-sans)" }}>
      <AnimatePresence initial={false}>
        {!immersiveScreen && (
          <motion.div
            key="sidebar"
            initial={reduceMotion ? false : { opacity: 0, x: -18 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}
            transition={{ duration: 0.2, ease: UI_EASE_OUT }}
            className="flex-shrink-0"
          >
            <Sidebar current={screen} onNavigate={navigate} viewer={viewer} />
          </motion.div>
        )}
      </AnimatePresence>
      <main className="relative flex-1 flex flex-col overflow-hidden min-w-0">
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={screen}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(8px)" }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.22, ease: UI_EASE_OUT }}
            className="absolute inset-0"
          >
            {renderedScreen}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
    </OperationsControlContext.Provider>
  );
}

