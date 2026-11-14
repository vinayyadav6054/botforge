"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Shell, { daysLeft } from "@/components/Shell";
import { Account, api, clearSession, getSession, Plan } from "@/lib/api";
import { site, whatsappLink } from "@/lib/site";

function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "–";
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{label}</span>
        <span className="muted">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className={`meter-bar${pct >= 100 ? " full" : ""}`} role="progressbar" aria-label={label}
        aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function planFeatures(p: Plan) {
  return [
    `${p.bots} bot${p.bots === 1 ? "" : "s"}`,
    `${p.answersPerMonth.toLocaleString()} answers a month`,
    `${p.documents} documents`,
    p.removeBranding ? "No “Powered by” badge" : "“Powered by BotForge” badge",
    p.messagingApps ? "WhatsApp, Instagram, Messenger, Telegram" : "Website chat only",
  ];
}

function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.account().then(setAccount).catch((e: Error) => setError(e.message));
  }, []);

  async function upgrade(plan: Plan) {
    setError(null);
    if (!account?.onlinePayment.includes(plan.id)) {
      if (site.whatsapp) {
        window.open(whatsappLink(`Hi! I'd like the BotForge ${plan.name} plan (₹${plan.priceInr}/month). My account: ${getSession()?.email ?? ""}`), "_blank", "noopener");
      } else {
        setNotice(`Online payment is not set up yet. Contact us to activate the ${plan.name} plan.`);
      }
      return;
    }
    setBusy(plan.id);
    try {
      const { url } = await api.checkout(plan.id);
      window.location.href = url;   // Razorpay's secure payment page
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm("Stop renewing your plan? It keeps working until the end of the period you paid for.")) return;
    setBusy("cancel");
    try {
      await api.cancelSubscription();
      setAccount(await api.account());
      setNotice("Your plan will not renew. It keeps working until the end of the paid period.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    setBusy("export");
    try {
      const blob = await api.exportAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `botforge-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    setBusy("delete");
    setError(null);
    try {
      await api.deleteAccount(password);
      clearSession();
      router.replace("/?deleted=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  if (!account) {
    return error ? <div className="alert error" role="alert">{error}</div> : <span className="spinner" aria-label="Loading" />;
  }

  const { plan, subscription: sub, usage } = account;
  const status =
    plan.id === "expired" ? "Ended"
      : sub.status === "trialing" ? `Free trial · ${daysLeft(sub.trialEndsAt)} days left`
        : sub.status === "cancelled" ? `Cancelled · works until ${fmtDate(sub.currentPeriodEnd)}`
          : sub.status === "halted" ? "Payment failed · please update your payment"
            : `Active · renews ${fmtDate(sub.currentPeriodEnd)}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan &amp; account</h1>
          <p className="muted" style={{ margin: 0 }}>Your plan, this month&apos;s usage and your data.</p>
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert ok" role="status">{notice}</div>}

      <section className="card">
        <div className="card-head">
          <div>
            <h2 style={{ marginBottom: 4 }}>{plan.name}</h2>
            <span className={`badge ${plan.id === "expired" || sub.status === "halted" ? "failed" : sub.status === "trialing" ? "processing" : "ready"}`}>
              {status}
            </span>
          </div>
          {sub.status === "active" && sub.provider === "razorpay" && (
            <button className="btn secondary small" onClick={cancel} disabled={busy === "cancel"}>Cancel renewal</button>
          )}
        </div>
        <Meter label="Answers this month" used={usage.answers} limit={plan.answersPerMonth} />
        <Meter label="Bots" used={usage.bots} limit={plan.bots} />
        <Meter label="Documents" used={usage.documents} limit={plan.documents} />
        <p className="small muted" style={{ margin: 0 }}>
          Answers reset on the 1st of every month. When the limit is reached, the bot politely asks visitors to contact you directly.
        </p>
      </section>

      <section className="card">
        <h2>Choose a plan</h2>
        <div className="plan-grid">
          {account.plans.map((p) => {
            const current = plan.id === p.id;
            return (
              <div key={p.id} className={`plan-mini${current ? " current" : ""}`}>
                <strong>{p.name}</strong>
                <div className="price">₹{p.priceInr.toLocaleString("en-IN")}<span className="small muted"> /month</span></div>
                <ul>{planFeatures(p).map((f) => <li key={f}>{f}</li>)}</ul>
                <button className={`btn${current ? " secondary" : ""}`} disabled={!!busy || (current && sub.status === "active")}
                  onClick={() => upgrade(p)}>
                  {busy === p.id ? "Opening payment…" : current && sub.status === "active" ? "Current plan" : current ? "Renew" : `Choose ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="small muted" style={{ margin: "14px 0 0" }}>
          {account.onlinePayment.length > 0
            ? "Payments are handled securely by Razorpay (UPI, cards, net banking) and renew monthly. Cancel any time."
            : "Online payment is coming soon. Pay by UPI or bank transfer and we activate your plan the same day."}
        </p>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="muted small">Download everything stored for your business: bots, documents list, leads and conversations.</p>
        <button className="btn secondary" onClick={exportData} disabled={busy === "export"}>
          {busy === "export" ? "Preparing…" : "Download my data (JSON)"}
        </button>
      </section>

      <section className="card danger-zone">
        <h2>Delete account</h2>
        <p className="muted small">
          Permanently deletes your business, all bots, documents, leads and conversations, and stops any subscription. This cannot be undone.
        </p>
        {!confirmDelete ? (
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete my account…</button>
        ) : (
          <form onSubmit={deleteAccount} aria-label="Delete account">
            <div className="field" style={{ maxWidth: 360 }}>
              <label htmlFor="deletePassword">Enter your password to confirm</label>
              <input id="deletePassword" type="password" required value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn danger" type="submit" disabled={busy === "delete" || !password}>
                {busy === "delete" ? "Deleting…" : "Delete everything permanently"}
              </button>
              <button className="btn secondary" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}

export default function Page() {
  return (
    <Shell>
      <AccountPage />
    </Shell>
  );
}
