"use client";

/**
 * PUBLIC SIGN-IN CARD
 * -------------------
 * The one sign-in surface for the public site: it is rendered on the landing
 * page (beside the hero) and again on /login, so the QR/field links that point
 * at /login keep working.
 *
 * Design contract (approved mockups):
 *  - three fields only: Email, Password, Target Robot
 *  - two actions: Mission Console -> and View Mission Replay
 *  - amber is used on the primary button and on hover/focus only; the card is
 *    quiet at rest
 *  - demo credentials are one click away, because nobody evaluating this
 *    should have to type them
 *
 * It performs the real login (POST /api/auth/login) — there is no bypass.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Eye, EyeOff, KeyRound, Lock, User } from "lucide-react";

interface RobotOption {
  id: string;
  name: string;
}

const DEMO = {
  operator: { email: "operator@paws.local", password: "paws-demo-operator", label: "Operator" },
  observer: { email: "observer@paws.local", password: "paws-demo-observer", label: "Observer" },
} as const;

type DemoRole = keyof typeof DEMO;

export function SignInCard({
  next = "/console",
  className,
}: {
  /** Where "Mission Console" lands after a successful sign-in. */
  next?: string;
  className?: string;
}) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState<string>(DEMO.operator.email);
  const [password, setPassword] = useState<string>(DEMO.operator.password);
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<DemoRole>("operator");
  const [robotId, setRobotId] = useState("paws-01");
  const [robots, setRobots] = useState<RobotOption[]>([{ id: "paws-01", name: "PAWS Alpha" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"/console" | "/replay" | null>(null);

  // The robot list is server-owned; mirror it into the dropdown.
  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.robots) && d.robots.length > 0) {
          setRobots(d.robots);
          setRobotId((cur) => (d.robots.some((r: RobotOption) => r.id === cur) ? cur : d.robots[0].id));
        }
      })
      .catch(() => {});
  }, []);

  function fillDemo(which: DemoRole) {
    setRole(which);
    setEmail(DEMO[which].email);
    setPassword(DEMO[which].password);
    setError(null);
    emailRef.current?.focus();
  }

  async function submit(destination: "/console" | "/replay") {
    setBusy(destination);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, robotId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Sign-in failed. Check the credentials.");
        setBusy(null);
        return;
      }
      router.push(destination === "/console" ? next : "/replay");
      router.refresh();
    } catch {
      setError("Could not reach the console. Is the server running?");
      setBusy(null);
    }
  }

  const labelCls = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-muted";
  const iconCls = "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint";

  return (
    <section
      id="access"
      className={`land-card w-full max-w-[420px] rounded-2xl p-5 sm:p-6 ${className ?? ""}`}
      aria-labelledby="signin-heading"
    >
      <h2 id="signin-heading" className="text-[19px] font-extrabold tracking-tight text-text-primary">
        Mission Control Access
      </h2>
      <p className="mt-0.5 text-[12.5px] text-text-muted">Demo credentials pre-filled for evaluation.</p>

      <form
        className="mt-4 space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("/console");
        }}
      >
        <div>
          <label className={labelCls} htmlFor="paws-email">
            Email
          </label>
          <div className="relative">
            <User size={15} className={iconCls} />
            <input
              id="paws-email"
              ref={emailRef}
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="land-field w-full rounded-lg py-2 pl-9 pr-3 text-[13px] font-medium"
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="paws-password">
            Password
          </label>
          <div className="relative">
            <Lock size={15} className={iconCls} />
            <input
              id="paws-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="land-field w-full rounded-lg py-2 pl-9 pr-10 text-[13px] font-medium"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="land-focus absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-faint hover:text-text-primary"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="paws-robot">
            Target Robot
          </label>
          <div className="relative">
            <select
              id="paws-robot"
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
              className="land-field w-full appearance-none rounded-lg py-2 pl-3 pr-9 text-[13px] font-medium"
            >
              {robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint" />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-[12px] font-semibold text-critical">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="submit"
            disabled={busy !== null}
            className="land-btn-primary land-focus inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-bold"
          >
            {busy === "/console" ? "Signing in…" : "Mission Console"}
            {busy !== "/console" && <ArrowRight size={15} />}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void submit("/replay")}
            className="land-btn-ghost land-focus inline-flex items-center justify-center gap-1.5 rounded-lg bg-transparent px-4 py-2.5 text-[13px] font-semibold disabled:opacity-55"
          >
            {busy === "/replay" ? "Signing in…" : "View Mission Replay"}
          </button>
        </div>
      </form>

      <div className="mt-3.5 border-t pt-3" style={{ borderColor: "rgb(var(--land-hair) / var(--land-hair-a))" }}>
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-faint">Demo access</span>
          <span className="h-px flex-1" style={{ background: "rgb(var(--land-hair) / var(--land-hair-a))" }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(Object.keys(DEMO) as DemoRole[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => fillDemo(k)}
              aria-pressed={role === k}
              className={`land-chip land-focus inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
                role === k ? "land-amber-text" : "text-text-muted"
              }`}
              style={role === k ? { borderColor: "rgb(var(--land-amber) / 0.7)" } : undefined}
            >
              <KeyRound size={12} />
              {DEMO[k].label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
          Operator can command the scout · Observer is read-only
        </p>
      </div>
    </section>
  );
}
