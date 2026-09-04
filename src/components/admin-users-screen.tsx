"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ChevronRight,
  Crown,
  KeyRound,
  MailCheck,
  RefreshCcw,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { AdminUserSummary, AuthSessionUser } from "@/types/auth";

type RoleOption =
  | "platform_admin"
  | "risk_lead"
  | "fraud_ops_analyst"
  | "merchant_risk_analyst";

const ROLE_OPTIONS: Array<{ value: RoleOption; label: string }> = [
  { value: "platform_admin", label: "Platform Admin" },
  { value: "risk_lead", label: "Risk Lead" },
  { value: "fraud_ops_analyst", label: "Fraud Ops Analyst" },
  { value: "merchant_risk_analyst", label: "Merchant Risk Analyst" },
];

const ROLE_META: Record<
  RoleOption,
  {
    title: string;
    summary: string;
    detail: string;
    icon: typeof Crown;
    badgeClass: string;
    cardClass: string;
    points: string[];
  }
> = {
  platform_admin: {
    title: "Platform control",
    summary: "Global system access, account administration, and policy authority.",
    detail:
      "Platform admins have global access and account controls. Newly provisioned admins must verify their email; only the original recovery superuser bypasses verification.",
    icon: Crown,
    badgeClass: "border-amber-400/25 bg-amber-500/12 text-amber-200",
    cardClass: "border-amber-400/18 bg-[linear-gradient(180deg,rgba(245,182,66,0.14),rgba(245,182,66,0.04))]",
    points: ["Manage users and roles", "Promote simulator policies", "Review all merchants and queues"],
  },
  risk_lead: {
    title: "Policy authority",
    summary: "Adjust review rules, test changes, and approve how fraud protection works.",
    detail:
      "Risk leads can edit live-defense settings and compare policy tradeoffs before rollout, but they do not administer platform users.",
    icon: ShieldCheck,
    badgeClass: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
    cardClass: "border-cyan-400/18 bg-[linear-gradient(180deg,rgba(43,187,215,0.14),rgba(43,187,215,0.04))]",
    points: ["Adjust when payments are reviewed", "Compare fraud found with safe payments delayed", "Coordinate urgent reviews across teams"],
  },
  fraud_ops_analyst: {
    title: "Queue execution",
    summary: "Operational review access for live fraud queues and case handling.",
    detail:
      "Fraud ops analysts work the queue, inspect alerts, and use Sentinel and the simulator in read-oriented mode without changing policy.",
    icon: Briefcase,
    badgeClass: "border-violet-400/20 bg-violet-500/10 text-violet-200",
    cardClass: "border-violet-400/18 bg-[linear-gradient(180deg,rgba(151,97,255,0.14),rgba(151,97,255,0.04))]",
    points: ["Review live alerts", "Inspect transactions and merchants", "Use Sentinel reasoning during triage"],
  },
  merchant_risk_analyst: {
    title: "Merchant-scoped review",
    summary: "Targeted merchant investigations with scope-limited access.",
    detail:
      "Merchant risk analysts should only see the merchants assigned to them. Scope ids determine which merchants they can review and override.",
    icon: Store,
    badgeClass: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    cardClass: "border-emerald-400/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))]",
    points: ["Investigate assigned merchants", "Manage merchant overrides", "Stay scoped to explicit merchant ids"],
  },
};

const DEFAULT_PASSWORD = "SentinelTemp!2026";
const SUGGESTED_SCOPE_IDS = ["M_QUICKBASKET", "M_VYRA"];

function roleValueLabel(role: RoleOption) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function scopeToInput(scopeIds: string[]) {
  return scopeIds.join(", ");
}

export default function AdminUsersScreen({
  viewer,
  onLogout,
}: {
  viewer: AuthSessionUser;
  onLogout: () => void;
}) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [role, setRole] = useState<RoleOption>("fraud_ops_analyst");
  const [merchantScope, setMerchantScope] = useState("M_QUICKBASKET, M_VYRA");
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<RoleOption>("fraud_ops_analyst");
  const [editEmailVerified, setEditEmailVerified] = useState(false);
  const [editMerchantScope, setEditMerchantScope] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const payload = (await response.json()) as { ok?: boolean; users?: AdminUserSummary[]; error?: string };
      if (!response.ok || !payload.users) {
        throw new Error(payload.error ?? "Could not load Sentinel users.");
      }
      setUsers(payload.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Sentinel users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial request synchronizes this client view with the external user store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    // Reset the edit draft when the selected external record changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditUsername(selectedUser.username);
    setEditEmail(selectedUser.email);
    setEditRole(selectedUser.role);
    setEditEmailVerified(selectedUser.emailVerified);
    setEditMerchantScope(scopeToInput(selectedUser.merchantScopeIds));
    setEditPassword("");
    setEditError(null);
    setDeleteConfirming(false);
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedUser) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedUser(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedUser]);

  const counts = useMemo(
    () => ({
      total: users.length,
      verified: users.filter((user) => user.emailVerified).length,
      admins: users.filter((user) => user.role === "platform_admin").length,
      merchantScoped: users.filter((user) => user.merchantScopeIds.length > 0).length,
    }),
    [users],
  );

  const editRoleMeta = ROLE_META[editRole];
  const editScopeIds =
    editRole === "merchant_risk_analyst"
      ? editMerchantScope
          .split(",")
          .map((scopeId) => scopeId.trim().toUpperCase())
          .filter(Boolean)
      : [];

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          role,
          merchantScopeIds:
            role === "merchant_risk_analyst"
              ? merchantScope.split(",").map((scopeId) => scopeId.trim()).filter(Boolean)
              : [],
        }),
      });
      const payload = (await response.json()) as { user?: AdminUserSummary; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Could not provision Sentinel user.");
      }

      const createdUser = payload.user;
      setUsers((current) => [...current, createdUser].sort((left, right) => left.username.localeCompare(right.username)));
      setSuccess(`Provisioned ${createdUser.username}. Temporary password: ${password}`);
      setUsername("");
      setEmail("");
      setPassword(DEFAULT_PASSWORD);
      setRole("fraud_ops_analyst");
      setMerchantScope("M_QUICKBASKET, M_VYRA");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not provision Sentinel user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;

    setEditSaving(true);
    setEditError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          username: editUsername,
          email: editEmail,
          password: editPassword.trim() ? editPassword : undefined,
          role: editRole,
          merchantScopeIds: editScopeIds,
        }),
      });
      const payload = (await response.json()) as { user?: AdminUserSummary; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Could not update Sentinel user.");
      }

      const updatedUser = payload.user;
      setUsers((current) =>
        current
          .map((user) => (user.id === updatedUser.id ? updatedUser : user))
          .sort((left, right) => left.username.localeCompare(right.username)),
      );
      setSelectedUser(updatedUser);
      setEditPassword("");
      setSuccess(
        editPassword.trim()
          ? `Updated ${updatedUser.username}. Active sessions were revoked because credentials changed.`
          : `Updated ${updatedUser.username}.`,
      );
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Could not update Sentinel user.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedUser || selectedUser.id === viewer.id) return;

    setDeleting(true);
    setEditError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id }),
      });
      const payload = (await response.json()) as { user?: AdminUserSummary; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Could not delete Sentinel user.");
      }

      const deletedUser = payload.user;
      setUsers((current) => current.filter((user) => user.id !== deletedUser.id));
      setSelectedUser(null);
      setSuccess(`Deleted ${deletedUser.username}. Their active sessions and recovery requests were removed.`);
    } catch (deleteError) {
      setEditError(deleteError instanceof Error ? deleteError.message : "Could not delete Sentinel user.");
      setDeleteConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-6">
        <section className="rounded-[26px] border border-border bg-panel px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[720px]">
              <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                Platform Administration
              </div>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.05em] text-foreground">
                Provision Sentinel operators
              </h1>
              <p className="mt-3 max-w-[62ch] text-sm leading-7 text-muted-foreground">
                Django-backed account management for fraud ops analysts, risk leads, merchant risk teams, and platform
                admins. Open any operator record to update access or permanently remove the account.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                  {viewer.username.slice(0, 2)}
                </div>
                <div className="leading-none">
                  <div className="text-sm font-medium text-foreground">{viewer.username}</div>
                  <div className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {viewer.role.replaceAll("_", " ")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-white/[0.03] px-4 text-sm text-foreground transition hover:bg-white/[0.05]"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh users
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex h-11 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] px-4 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground transition hover:border-white/12 hover:bg-white/[0.05] hover:text-foreground"
              >
                Logout
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,420px)]">
          <div className="rounded-[26px] border border-border bg-panel px-6 py-6">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              {[
                { label: "Total users", value: counts.total },
                { label: "Verified", value: counts.verified },
                { label: "Admins", value: counts.admins },
                { label: "Merchant-scoped", value: counts.merchantScoped },
              ].map((item) => (
                <div key={item.label} className="min-w-[140px] rounded-2xl border border-border bg-white/[0.02] px-4 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-3xl border border-border">
              <div className="grid grid-cols-[1.2fr_1.1fr_0.7fr_0.9fr_0.9fr_auto] gap-3 border-b border-border px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span>User</span>
                <span>Role</span>
                <span>Verification</span>
                <span>Scope</span>
                <span>Updated</span>
                <span className="text-right">Manage</span>
              </div>
              <div className="max-h-[540px] overflow-auto">
                {loading ? (
                  <div className="px-4 py-10 text-sm text-muted-foreground">Loading Sentinel operators...</div>
                ) : (
                  users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => setSelectedUser(user)}
                      className="grid w-full grid-cols-[1.2fr_1.1fr_0.7fr_0.9fr_0.9fr_auto] gap-3 border-b border-border/80 px-4 py-4 text-left text-sm transition hover:bg-white/[0.03] last:border-b-0"
                    >
                      <div>
                        <div className="font-medium text-foreground">{user.username}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{user.email}</div>
                      </div>
                      <div>
                        <div className="text-foreground">{user.roleLabel}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{user.isSuperuser ? "Superuser" : user.role}</div>
                      </div>
                      <div className={user.emailVerified ? "text-emerald-400" : "text-amber-300"}>
                        {user.emailVerified ? "Verified" : "Pending"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {user.merchantScopeIds.length > 0
                          ? user.merchantScopeIds.join(", ")
                          : user.role === "merchant_risk_analyst"
                            ? "No businesses assigned"
                            : "Global"}
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(user.updatedAt).toLocaleString()}</div>
                      <div className="flex items-center justify-end gap-2 text-xs text-foreground/78">
                        <span>Manage</span>
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <aside className="rounded-[26px] border border-border bg-panel px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  New operator
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">Provision account</div>
              </div>
            </div>

            {success ? (
              <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {success}
              </div>
            ) : null}
            {error ? (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <form className="mt-6 space-y-4" onSubmit={handleCreate}>
              <label className="block">
                <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Username</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-border bg-white/[0.03] px-4 text-sm text-foreground outline-none transition focus:border-primary"
                  placeholder="fraud_ops_north"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Email</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-border bg-white/[0.03] px-4 text-sm text-foreground outline-none transition focus:border-primary"
                  placeholder="ops.user@company.com"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Role</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as RoleOption)}
                  className="h-12 w-full rounded-2xl border border-border bg-[#0e1117] px-4 text-sm font-medium text-white outline-none transition focus:border-primary"
                  style={{ colorScheme: "dark" }}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#0e1117] text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                  Pick the operator role that determines queue access, simulator permissions, and account scope.
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Temporary password</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-border bg-white/[0.03] px-4 text-sm text-foreground outline-none transition focus:border-primary"
                />
              </label>

              {role === "merchant_risk_analyst" ? (
                <label className="block">
                  <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Merchant scope ids</span>
                  <input
                    value={merchantScope}
                    onChange={(event) => setMerchantScope(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-border bg-white/[0.03] px-4 text-sm text-foreground outline-none transition focus:border-primary"
                    placeholder="M_QUICKBASKET, M_VYRA"
                  />
                </label>
              ) : null}

              <div className="rounded-2xl border border-border bg-white/[0.02] px-4 py-3 text-sm text-foreground">
                New accounts start unverified. The operator must use Verify Email before signing in.
              </div>

              <button
                type="submit"
                disabled={saving}
                className="h-12 w-full rounded-full bg-[linear-gradient(180deg,#f5d76a_0%,#d7b232_100%)] px-5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Provisioning..." : "Create Sentinel user"}
              </button>
            </form>
          </aside>
        </section>
      </div>

      {selectedUser ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6">
          <button
            type="button"
            aria-label="Close account editor"
            className="absolute inset-0 bg-black/72 backdrop-blur-sm"
            onClick={() => setSelectedUser(null)}
          />
          <div className="relative z-[121] flex max-h-[92vh] w-full max-w-[1120px] items-stretch overflow-hidden rounded-[30px] border border-white/10 bg-[#090a0f] shadow-[0_36px_120px_rgba(0,0,0,0.58)]">
            <div className="hidden min-h-0 w-[360px] shrink-0 overflow-y-auto border-r border-white/8 bg-[linear-gradient(180deg,#0d1018_0%,#090a0f_100%)] p-6 lg:block">
              <div className={`rounded-[26px] border px-5 py-5 ${editRoleMeta.cardClass}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${editRoleMeta.badgeClass}`}>
                    <editRoleMeta.icon className="h-5 w-5" />
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.16em] ${editRoleMeta.badgeClass}`}>
                    {roleValueLabel(editRole)}
                  </div>
                </div>
                <div className="mt-5 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">Role surface</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">{editRoleMeta.title}</div>
                <p className="mt-3 text-sm leading-6 text-white/72">{editRoleMeta.detail}</p>
                <div className="mt-5 space-y-3">
                  {editRoleMeta.points.map((point) => (
                    <div key={point} className="rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-white/82">
                      {point}
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Account editor</div>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                    Manage {selectedUser.username}
                  </h2>
                  <p className="mt-3 max-w-[56ch] text-sm leading-6 text-white/62">
                    Update identity, role assignment, and merchant scope for this operator. Password rotation is optional; email verification is completed by the operator.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/72 transition hover:bg-white/[0.06] hover:text-white"
                  aria-label="Close account editor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {success ? (
                <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {success}
                </div>
              ) : null}
              {editError ? (
                <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {editError}
                </div>
              ) : null}

              <form className="mt-6 space-y-5" onSubmit={handleUpdate}>
                <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-5">
                  <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Identity</div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Username</span>
                      <input
                        value={editUsername}
                        onChange={(event) => setEditUsername(event.target.value)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-primary"
                        placeholder="fraud_ops_north"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Email</span>
                      <input
                        value={editEmail}
                        onChange={(event) => setEditEmail(event.target.value)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-primary"
                        placeholder="ops.user@company.com"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Role assignment</div>
                      <div className="mt-2 text-lg font-semibold text-white">{editRoleMeta.summary}</div>
                    </div>
                    <div className={`hidden rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.16em] lg:inline-flex ${editRoleMeta.badgeClass}`}>
                      {roleValueLabel(editRole)}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Role</span>
                      <select
                        value={editRole}
                        onChange={(event) => setEditRole(event.target.value as RoleOption)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-[#0f131a] px-4 text-sm font-medium text-white outline-none transition focus:border-primary"
                        style={{ colorScheme: "dark" }}
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-[#0f131a] text-white">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={`rounded-[22px] border px-4 py-4 ${editRoleMeta.cardClass}`}>
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                        <editRoleMeta.icon className="h-4 w-4" />
                        {editRoleMeta.title}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-white/72">{editRoleMeta.detail}</p>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-5">
                  <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Access and verification</div>
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white">
                      <input
                        type="checkbox"
                        checked={editEmailVerified}
                        readOnly
                        disabled
                        className="h-4 w-4 accent-[color:var(--primary)]"
                      />
                      <div>
                        <div className="font-medium text-white">Email verification complete</div>
                        <div className="mt-1 text-xs text-white/55">
                          Verification can only be completed with the code sent to this operator&apos;s email.
                        </div>
                      </div>
                    </label>

                    {editRole === "merchant_risk_analyst" ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <label className="block">
                          <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">Merchant scope ids</span>
                          <input
                            value={editMerchantScope}
                            onChange={(event) => setEditMerchantScope(event.target.value)}
                            className="h-12 w-full rounded-2xl border border-white/10 bg-[#0f131a] px-4 text-sm text-white outline-none transition focus:border-primary"
                            placeholder="M_QUICKBASKET, M_VYRA"
                          />
                        </label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {SUGGESTED_SCOPE_IDS.map((scopeId) => (
                            <button
                              key={scopeId}
                              type="button"
                              onClick={() => {
                                if (editScopeIds.includes(scopeId)) return;
                                setEditMerchantScope((current) => (current.trim() ? `${current}, ${scopeId}` : scopeId));
                              }}
                              className="rounded-full border border-emerald-400/18 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] text-emerald-200 transition hover:bg-emerald-500/16"
                            >
                              Add {scopeId}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {editScopeIds.length > 0 ? (
                            editScopeIds.map((scopeId) => (
                              <div
                                key={scopeId}
                                className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] text-white/75"
                              >
                                {scopeId}
                              </div>
                            ))
                          ) : (
                            <div className="text-xs text-white/48">No merchant ids assigned yet.</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                        <div className="text-sm font-medium text-white">Global account scope</div>
                        <div className="mt-1 text-xs leading-5 text-white/55">
                          This role is not restricted to merchant ids. Access is determined entirely by role-based permissions.
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-white/[0.02] p-5">
                  <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">
                    <KeyRound className="h-4 w-4" />
                    Password rotation
                  </div>
                  <div className="mt-4">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-mono uppercase tracking-[0.18em] text-white/45">New temporary password</span>
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(event) => setEditPassword(event.target.value)}
                        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-primary"
                        placeholder="Leave blank to keep the current password"
                      />
                    </label>
                    <div className="mt-2 text-xs leading-5 text-white/48">
                      Use this only when you need to rotate credentials. Saving a new password revokes all active sessions for this operator.
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] border border-red-500/20 bg-red-500/[0.06] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
                        <Trash2 className="h-4 w-4" />
                        Delete account
                      </div>
                      <p className="mt-2 max-w-[58ch] text-xs leading-5 text-red-100/62">
                        Permanently removes this operator and immediately invalidates all of their sessions, email-verification requests, and password-reset requests.
                      </p>
                    </div>
                    {!deleteConfirming ? (
                      <button
                        type="button"
                        disabled={selectedUser.id === viewer.id}
                        onClick={() => setDeleteConfirming(true)}
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition hover:bg-red-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {selectedUser.id === viewer.id ? "Current account" : "Delete account"}
                      </button>
                    ) : (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => setDeleteConfirming(false)}
                          className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 px-4 text-sm text-white/70 transition hover:bg-white/[0.05] disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => void handleDelete()}
                          className="inline-flex h-11 items-center justify-center rounded-full bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deleting ? "Deleting..." : `Delete ${selectedUser.username}`}
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedUser.id === viewer.id ? (
                    <div className="mt-3 text-xs text-red-100/55">
                      You cannot delete the account used by your current session.
                    </div>
                  ) : null}
                </section>

                <div className="flex flex-col-reverse gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-flex items-center gap-2 text-xs text-white/52">
                    <MailCheck className="h-4 w-4" />
                    Updates are persisted through the backend auth workflow.
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="inline-flex h-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 text-sm text-white/72 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      Close
                    </button>
                    <button
                      type="submit"
                      disabled={editSaving}
                      className="inline-flex h-12 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f5d76a_0%,#d7b232_100%)] px-5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {editSaving ? "Saving changes..." : "Save account changes"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
