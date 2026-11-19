"use client";

import { FormEvent, useEffect, useState } from "react";
import CenterCard from "@/components/CenterCard";
import Logo from "@/components/Logo";
import { AdminSubscription, AdminTenant, api } from "@/lib/api";

const KEY = "kahiye.admin";

interface Row extends AdminTenant {
  sub?: AdminSubscription;
}

function fmt(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–";
}

/**
 * For the platform owner only (needs Admin:ApiKey): all businesses, their plan and usage, and a form to
 * activate a plan after a manual UPI/bank payment. The key stays in this browser tab (sessionStorage).
 */
export default function AdminPage() {
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [plan, setPlan] = useState("starter");
  const [months, setMonths] = useState(1);
  const [founding, setFounding] = useState(false);

  async function load(k: string) {
    setError(null);
    try {
      const [tenants, subs] = await Promise.all([api.adminTenants(k), api.adminSubscriptions(k)]);
      const byTenant = new Map(subs.map((s) => [s.tenantId, s]));
      setRows(tenants.map((t) => ({ ...t, sub: byTenant.get(t.tenantId) })));
      try { sessionStorage.setItem(KEY, k); } catch { /* storage blocked: ask again next time */ }
    } catch (e) {
      setRows(null);
      setError((e as Error).message.includes("401") || (e as { status?: number }).status === 401 ? "Wrong admin key." : (e as Error).message);
    }
  }

  useEffect(() => {
    let saved = "";
    try { saved = sessionStorage.getItem(KEY) ?? ""; } catch { /* ignore */ }
    if (saved) {
      setKey(saved);
      void load(saved);
    }
  }, []);

  async function save(tenantId: string, body: { plan?: string; months?: number; trialDays?: number; founding?: boolean }) {
    setError(null);
    try {
      await api.adminSetPlan(key, tenantId, body);
      setEditing(null);
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
      await load(key);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!rows) {
    return (
      <CenterCard>
        <h1>Admin</h1>
        <p className="muted">Enter the admin key (the <code>ADMIN_API_KEY</code> setting on your server).</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void load(key); }}>
          <div className="field">
            <label htmlFor="adminKey">Admin key</label>
            <input id="adminKey" type="password" required value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </div>
          <button className="btn block" type="submit">Open</button>
        </form>
      </CenterCard>
    );
  }

  const q = filter.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.owner?.email.toLowerCase().includes(q));
  const paying = rows.filter((r) => r.sub?.status === "active" && r.sub.effectivePlan !== "expired").length;

  return (
    <>
      <header className="topbar">
        <Logo href="/" />
        <strong style={{ marginRight: "auto", marginLeft: 16 }}>Admin</strong>
        <button className="btn secondary small" onClick={() => {
          try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
          setRows(null);
          setKey("");
        }}>Lock</button>
      </header>
      <main className="container" style={{ maxWidth: 1200 }}>
        <div className="stats">
          <div className="stat"><div className="label">Businesses</div><div className="value">{rows.length}</div></div>
          <div className="stat"><div className="label">Paying</div><div className="value">{paying}</div></div>
          <div className="stat"><div className="label">On trial</div><div className="value">{rows.filter((r) => r.sub?.effectivePlan === "trial").length}</div></div>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert ok" role="status">{notice}</div>}
        <div className="card">
          <div className="card-head">
            <h2>Businesses</h2>
            <input type="text" placeholder="Search name or email" value={filter} onChange={(e) => setFilter(e.target.value)}
              aria-label="Search" style={{ maxWidth: 260 }} />
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Business</th><th>Owner</th><th>Plan</th><th>Until</th><th>Answers (month)</th><th>Bots</th><th>Joined</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.tenantId}>
                    <td><strong>{r.name}</strong><div className="small muted">{r.tenantId.slice(0, 8)}</div></td>
                    <td>{r.owner?.email ?? "–"} {r.owner && !r.owner.emailVerified && <span className="badge processing">unverified</span>}</td>
                    <td>
                      <span className={`badge ${r.sub?.effectivePlan === "expired" ? "failed" : r.sub?.effectivePlan === "trial" ? "processing" : "ready"}`}>
                        {r.sub?.effectivePlan ?? "trial (not started)"}
                      </span>
                      {r.sub?.provider && <div className="small muted">{r.sub.provider}</div>}
                      {r.sub?.founding && <div className="small"><span className="badge ready">founding</span></div>}
                    </td>
                    <td>{fmt(r.sub?.status === "trialing" ? r.sub.trialEndsAt : r.sub?.currentPeriodEnd)}</td>
                    <td>{r.sub?.answersThisMonth ?? 0}</td>
                    <td>{r.sub?.bots ?? 0}</td>
                    <td>{fmt(r.createdAt)}</td>
                    <td>
                      {editing === r.tenantId ? (
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                          <select className="status-select" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
                            <option value="starter">Starter</option>
                            <option value="business">Business</option>
                            <option value="pro">Pro</option>
                          </select>
                          <input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value))}
                            aria-label="Months" style={{ width: 70 }} />
                          <label className="small" style={{ whiteSpace: "nowrap" }} title="Founding customer: pays 40% less, for life">
                            <input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} /> Founding
                          </label>
                          <button className="btn small" onClick={() => save(r.tenantId, { plan, months, founding })}>Activate</button>
                          <button className="btn secondary small" onClick={() => save(r.tenantId, { trialDays: 7 })} title="Give 7 more trial days">+7d trial</button>
                          <button className="btn secondary small" onClick={() => setEditing(null)}>×</button>
                        </div>
                      ) : (
                        <button className="btn secondary small" onClick={() => { setFounding(!!r.sub?.founding); setEditing(r.tenantId); }}>Set plan</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            After a customer pays you by UPI or bank transfer: Set plan → choose the plan and number of months → Activate.
            Paying again before the end extends from the current end date. Tick Founding for the first 10 paying businesses:
            they pay the founding price (40% off) for as long as they stay.
          </p>
        </div>
      </main>
    </>
  );
}
