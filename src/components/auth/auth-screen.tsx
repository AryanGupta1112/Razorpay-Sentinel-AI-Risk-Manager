"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { PORTRAIT_H, PORTRAIT_W, paintPortrait } from "@/lib/sentinel-pixel-art/agent-art";
import type { AgentCharacter } from "@/lib/sentinel-pixel-art/agent-art";
import { useRouteTransition } from "@/components/motion/route-transition-provider";
import styles from "./auth-screen.module.css";

type AuthMode = "login" | "verify" | "forgot" | "reset";

type ApiFailure = {
  error?: string;
  code?: string;
  verificationRequired?: boolean;
  username?: string;
};

const AUTH_AGENTS = [
  { name: "Signal Scout", role: "Finds connected warning signs", character: "signal-scout" },
  { name: "Merchant Guard", role: "Checks business impact", character: "merchant-guard" },
  { name: "Policy Guard", role: "Checks the safety rules", character: "policy-guard" },
  { name: "Queue Ops", role: "Keeps reviews moving", character: "queue-ops" },
] as const satisfies ReadonlyArray<{
  name: string;
  role: string;
  character: AgentCharacter;
}>;

function AgentPortrait({ character }: { character: AgentCharacter }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context) paintPortrait(context, character, 1);
  }, [character]);

  return (
    <canvas
      ref={canvasRef}
      width={PORTRAIT_W}
      height={PORTRAIT_H}
      className={styles.agentPortrait}
      aria-hidden="true"
    />
  );
}

function BadgeGlyph() {
  return (
    <svg viewBox="0 0 582 557" aria-hidden="true" className={styles.badgeGlyph}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M449 0h-14l-20 10-215 239-13 27 2 23 23 27 20 6 57 2v182l12 27 23 13h22l28-20 199-225 9-23-3-24-20-24-20-7-61-3V32l-8-19ZM442 38l4 212 20 17 74 3 7 15-206 235-9 2-8-8-3-200-14-14-12-3h-62l-9-6-3-9ZM1 67l3 14 13 9h199l7-3 9-13-4-17-13-8H18L5 57ZM0 285l4 15 13 8h88l13-9 3-8-2-13-8-8-8-3H17l-13 8ZM1 495l3 16 6 6 13 3h156l12-4 9-16-4-12-14-9H18l-9 4Z"
      />
    </svg>
  );
}

function AuthField({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={styles.fieldGroup}>
      <span className={styles.fieldHeader}>
        <span className={styles.fieldLabel}>{label}</span>
        {action}
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

function AuthInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} suppressHydrationWarning className={styles.input} />;
}

function StatusPanel({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className={styles.statusPanel}>
      <div className={styles.statusTitle}>
        <CheckCircle2 className={styles.statusIcon} />
        <span>{title}</span>
      </div>
      <p className={styles.statusMessage}>{message}</p>
    </div>
  );
}

export default function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { navigate } = useRouteTransition();
  const searchParams = useSearchParams();
  const [entered, setEntered] = useState(false);
  const initialStatus = useMemo(() => {
    const notice = searchParams.get("notice");

    if (mode === "reset" && notice === "reset_code_sent") {
      return {
        title: "Reset email sent",
        message: "Check the inbox for this Sentinel account. Enter the reset code from that email to set a new password.",
      };
    }

    return null;
  }, [mode, searchParams]);
  const [username, setUsername] = useState(searchParams.get("username") ?? "");
  const [password, setPassword] = useState("");
  const [requestId, setRequestId] = useState(searchParams.get("requestId") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ title: string; message: string; code?: string | null } | null>(
    initialStatus,
  );

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const surface = useMemo(() => {
    if (mode === "login") {
      return {
        title: "Welcome back!",
        body: "Log in to continue monitoring your signals, review high-risk payments, and keep defense actions moving.",
        cta: "Open home screen",
      };
    }
    if (mode === "verify") {
      return {
        title: requestId ? "Confirm verification" : "Verify your analyst account",
        body: requestId
          ? "Enter the 6-digit code sent to the email on this Sentinel account to finish activation."
          : "Enter the Sentinel username for the account you want to activate. We will send a short-lived verification code to the email on that profile.",
        cta: requestId ? "Confirm code" : "Send verification code",
      };
    }
    if (mode === "forgot") {
      return {
        title: "Recover access",
        body: "Enter the Sentinel username for the account. We will email a short-lived reset code to the verified address on file.",
        cta: "Send reset code",
      };
    }
    return {
      title: "Set a new password",
      body: "Complete the reset with the request id and code sent to the account email.",
      cta: "Update password",
    };
  }, [mode, requestId]);

  async function readJson<T>(response: Response) {
    return (await response.json()) as T;
  }

  async function handleLogin() {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const payload = await readJson<ApiFailure>(response);
      if (payload.verificationRequired && payload.username) {
        router.push(`/verify-email?username=${encodeURIComponent(payload.username)}`);
        return;
      }
      throw new Error(payload.error ?? "Login failed.");
    }

    navigate({ href: "/overview", label: "Preparing your risk floor", variant: "console-entry" });
  }

  async function handleVerificationSend() {
    const response = await fetch("/api/auth/verify/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    const payload = await readJson<
      | { status: "already_verified" }
      | { requestId: string; expiresAt: string; devCode?: string; status: "sent" }
      | ApiFailure
    >(response);

    if (!response.ok) {
      throw new Error("error" in payload ? payload.error ?? "Verification send failed." : "Verification send failed.");
    }

    if ("status" in payload && payload.status === "already_verified") {
      setStatus({
        title: "Email already verified",
        message: "This account can log in immediately. Continue to sign in.",
      });
      return;
    }

    if ("requestId" in payload) {
      setRequestId(payload.requestId);
      setStatus({
        title: "Verification email sent",
        message: `A 6-digit verification code was sent to the email address on file for ${username}. Enter that code below to activate the account.`,
      });
    }
  }

  async function handleVerificationConfirm() {
    const response = await fetch("/api/auth/verify/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, requestId, code }),
    });
    const payload = await readJson<ApiFailure>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Verification failed.");
    }

    setStatus({
      title: "Account verified",
      message: "Email verification is complete. You can now sign in to Sentinel.",
    });
    window.setTimeout(() => router.push(`/login?username=${encodeURIComponent(username)}`), 800);
  }

  async function handleForgot() {
    const response = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const payload = await readJson<{ requestId?: string; devCode?: string; error?: string }>(response);

    if (!response.ok || !payload.requestId) {
      throw new Error(payload.error ?? "Reset request failed.");
    }

    router.push(
      `/reset-password?username=${encodeURIComponent(username)}&requestId=${encodeURIComponent(payload.requestId)}&notice=reset_code_sent`,
    );
  }

  async function handleReset() {
    if (newPassword !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    const response = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, code, newPassword }),
    });
    const payload = await readJson<ApiFailure>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Password reset failed.");
    }

    setStatus({
      title: "Password updated",
      message: "The password has been reset. Sign in again with the new credential.",
    });
    window.setTimeout(() => router.push(`/login?username=${encodeURIComponent(username)}`), 900);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (mode === "login") {
        await handleLogin();
      } else if (mode === "verify") {
        if (requestId) {
          await handleVerificationConfirm();
        } else {
          await handleVerificationSend();
        }
      } else if (mode === "forgot") {
        await handleForgot();
      } else {
        await handleReset();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Request failed.");
    } finally {
      setPending(false);
    }
  }

  const showLoginFields = mode === "login";
  const showIdentifierField = mode === "login" || mode === "verify" || mode === "forgot";

  return (
    <div className={`${styles.stage} ${entered ? styles.stageReady : ""}`}>
      <Link href="/" className={styles.stageBackButton}>
        <ArrowLeft size={16} />
        <span>Home</span>
      </Link>

      <section className={styles.visual} aria-label="Illustration of Sentinel agents reviewing a simulated risky payment">
        <div className={styles.sceneShell}>
          <div className={styles.sceneTopbar}>
            <span>Simulated defense floor</span>
            <span className={styles.sceneLive}><i />4 agents ready</span>
          </div>
          <div className={styles.officeMap} />
          <div className={styles.paymentCard}>
            <div className={styles.paymentLabel}>Payment under review</div>
            <strong>Vyra Travels - INR 2.12L</strong>
            <div className={styles.paymentSignals}>
              <span>New device</span>
              <span>Fast retries</span>
              <span>Location change</span>
            </div>
          </div>
          <div className={styles.decisionCard}>
            <div>
              <span>Team recommendation</span>
              <strong>Hold for review</strong>
            </div>
            <b>4/4 agree</b>
          </div>
          <div className={styles.agentRail}>
            {AUTH_AGENTS.map((agent) => (
              <div key={agent.name} className={styles.agentCard}>
                <div className={styles.agentFace}>
                  <AgentPortrait character={agent.character} />
                </div>
                <div className={styles.agentCopy}>
                  <strong>{agent.name}</strong>
                  <span>{agent.role}</span>
                </div>
                <i title="Ready" />
              </div>
            ))}
          </div>
        </div>

        <div className={styles.hero}>
          <div className={styles.badge}>
            <BadgeGlyph />
            <span>Four specialists, one shared view</span>
          </div>
          <div className={styles.heroText}>
            <h1 className={styles.heroLinePrimary}>See the risk clearly.</h1>
            <h2 className={styles.heroLineSecondary}>You make the final call.</h2>
          </div>
        </div>
      </section>

      <section className={styles.pane}>
        <div className={styles.card}>
          <div className={styles.cardInner}>
            <div className={styles.cardHeader}>
              <div className={styles.cardWordmark}>Sentinel</div>
              <div className={styles.cardIcon}>
                {mode === "verify" ? <MailCheck size={18} /> : mode === "forgot" || mode === "reset" ? <KeyRound size={18} /> : <ShieldCheck size={18} />}
              </div>
            </div>

            <div className={styles.copyBlock}>
              <h3 className={styles.title}>{surface.title}</h3>
              <p className={styles.description}>{surface.body}</p>
            </div>

            {status ? <StatusPanel title={status.title} message={status.message} /> : null}
            {error ? <div className={styles.errorPanel}>{error}</div> : null}

            <form className={styles.form} onSubmit={handleSubmit}>
              {showIdentifierField ? (
                <AuthField
                  label={mode === "login" ? "Username" : "Sentinel username"}
                  hint={
                    mode === "login"
                      ? "Use the provisioned Sentinel username for this environment."
                      : mode === "verify"
                        ? "Enter the username tied to the email inbox where you want to receive the verification code."
                        : mode === "forgot"
                          ? "Enter the username for the account you want to recover."
                          : undefined
                  }
                >
                  <AuthInput
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={mode === "login" ? "platform_admin" : "fraud_ops_north"}
                    autoComplete="username"
                  />
                </AuthField>
              ) : null}

              {showLoginFields ? (
                <AuthField
                  label="Password"
                  action={
                    <Link className={styles.fieldAction} href="/forgot-password">
                      Forgot password?
                    </Link>
                  }
                >
                  <AuthInput
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                  />
                </AuthField>
              ) : null}

              {mode === "verify" && requestId ? (
                <>
                  <AuthField
                    label="Verification code"
                    hint="Enter the 6-digit code from the verification email sent to the address on file."
                  >
                    <AuthInput
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="6-digit code"
                      inputMode="numeric"
                    />
                  </AuthField>
                </>
              ) : null}

              {mode === "reset" ? (
                <>
                  <AuthField label="Username" hint="Used to return you to the right account after reset.">
                    <AuthInput
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="fraud_ops"
                      autoComplete="username"
                    />
                  </AuthField>
                  <AuthField label="Reset code">
                    <AuthInput
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="6-digit code"
                      inputMode="numeric"
                    />
                  </AuthField>
                  <AuthField label="New password">
                    <AuthInput
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                    />
                  </AuthField>
                  <AuthField label="Confirm password">
                    <AuthInput
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat the new password"
                      autoComplete="new-password"
                    />
                  </AuthField>
                </>
              ) : null}

              <button type="submit" disabled={pending} className={styles.primaryButton}>
                <span>{pending ? "Working..." : surface.cta}</span>
                <ArrowRight size={18} />
              </button>
            </form>

            {mode === "login" ? (
              <div className={styles.accountPrompt}>
                <span>Signing in for the first time?</span>
                <Link href="/verify-email">
                  <MailCheck size={15} />
                  Verify your email
                  <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className={styles.linkRow}>
                <Link className={styles.secondaryButton} href="/login">
                  <ArrowLeft size={15} />
                  Back to login
                </Link>
                {mode === "forgot" ? (
                  <Link className={styles.secondaryButton} href="/verify-email">
                    Verify an account
                  </Link>
                ) : null}
              </div>
            )}

            <div className={styles.footnote}>
              <span>Need access?</span>
              <span>Ask a platform admin to provision your Sentinel account.</span>
            </div>

          </div>
        </div>
      </section>
    </div>
  );
}
