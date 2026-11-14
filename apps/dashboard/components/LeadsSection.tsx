"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, Lead, LEAD_STATUSES, LeadStatus } from "@/lib/api";

interface Turn {
  role: string;
  text: string;
}

function parseTranscript(json: string): Turn[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t) => t && typeof t.text === "string") : [];
  } catch {
    return [];
  }
}

/** wa.me needs the full international number; a 10-digit number without + is taken as Indian. */
export function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return !phone.startsWith("+") && digits.length === 10 ? `91${digits}` : digits;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function LeadsSection({ botId, enabled }: { botId: string; enabled: boolean }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLeads(await api.listLeads(botId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(lead: Lead, status: LeadStatus) {
    try {
      const updated = await api.updateLeadStatus(botId, lead.id, status);
      setLeads((ls) => ls?.map((l) => (l.id === lead.id ? updated : l)) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(lead: Lead) {
    if (!confirm(`Delete the enquiry from ${lead.name}? Use this when someone asks for their data to be removed.`)) return;
    try {
      await api.deleteLead(botId, lead.id);
      setLeads((ls) => ls?.filter((l) => l.id !== lead.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.exportLeads(botId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const newCount = leads?.filter((l) => l.status === "New").length ?? 0;

  return (
    <section className="card" aria-label="Leads">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          Leads {newCount > 0 && <span className="badge processing">{newCount} new</span>}
        </h2>
        <div className="row">
          <button className="btn secondary small" onClick={() => void load()}>Refresh</button>
          <button className="btn secondary small" onClick={exportCsv} disabled={exporting || !leads?.length}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {!enabled && (
        <p className="muted small">
          Lead capture is off. Turn it on in <strong>Settings</strong> below so visitors can ask for a call back.
        </p>
      )}

      {leads === null ? (
        <span className="spinner" aria-label="Loading" />
      ) : leads.length === 0 ? (
        <p className="empty small" style={{ padding: 16 }}>No enquiries yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Name</th><th>Phone</th><th>Course</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const turns = parseTranscript(l.transcript);
                return (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatWhen(l.createdAt)}</td>
                      <td>
                        {l.name}
                        {l.channel && l.channel !== "web" && <span className="badge processing" style={{ marginLeft: 6 }}>{l.channel}</span>}
                        {l.email && <div className="small muted">{l.email}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <a href={`tel:${l.phone}`}>{l.phone}</a>
                        <div className="small">
                          <a href={`https://wa.me/${whatsappNumber(l.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        </div>
                      </td>
                      <td>{l.course ?? <span className="muted">–</span>}</td>
                      <td>
                        <select
                          className="status-select"
                          aria-label={`Status of ${l.name}`}
                          value={l.status}
                          onChange={(e) => void setStatus(l, e.target.value as LeadStatus)}
                        >
                          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {turns.length > 0 && (
                          <button className="btn secondary small" onClick={() => setOpen(open === l.id ? null : l.id)}
                            aria-expanded={open === l.id}>
                            {open === l.id ? "Hide chat" : "View chat"}
                          </button>
                        )}{" "}
                        <button className="btn danger small" onClick={() => void remove(l)} aria-label={`Delete lead ${l.name}`}>
                          Delete
                        </button>
                      </td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="transcript">
                            {l.pageUrl && <div className="small muted">From page: {l.pageUrl}</div>}
                            {turns.map((t, i) => (
                              <div key={i} className={`turn ${t.role === "user" ? "user" : "bot"}`}>
                                <strong>{t.role === "user" ? "Visitor" : "Assistant"}:</strong> {t.text}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
