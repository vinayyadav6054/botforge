"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { api, Bot } from "@/lib/api";
import Icon, { IconName } from "@/components/Icon";
import { ActivePill } from "@/components/AppMotion";

const QUESTION_EXAMPLES = [
  "e.g. What are the fees?",
  "e.g. When does the next batch start?",
  "e.g. Is there a scholarship test?",
  "e.g. Do you offer a free demo class?",
];
const COLORS = ["#4f46e5", "#c8461f", "#1d4ed8", "#0f766e", "#15803d", "#be185d", "#1f2937"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LANGUAGES: [string, string][] = [["en", "English"], ["hi", "Hindi"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"],
  ["bn", "Bengali"], ["gu", "Gujarati"], ["kn", "Kannada"], ["ml", "Malayalam"], ["pa", "Punjabi"], ["ur", "Urdu"]];
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London",
  "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

type Group = "basics" | "answers" | "leads" | "buttons" | "hours";
/** One group at a time keeps the form short; everything is saved together. */
const GROUPS: { id: Group; label: string; icon: IconName }[] = [
  { id: "basics", label: "Basics & look", icon: "spark" },
  { id: "answers", label: "How it answers", icon: "chat" },
  { id: "leads", label: "Leads & alerts", icon: "users" },
  { id: "buttons", label: "Booking & payment", icon: "layers" },
  { id: "hours", label: "Opening hours", icon: "home" },
];

/** Always four boxes in the form; the bot keeps only the filled ones. */
function padQuestions(qs: string[] | undefined): string[] {
  return [...(qs ?? []), "", "", "", ""].slice(0, 4);
}

/** Resizes a logo to at most 160 px and returns a small data: URL (WebP when the browser can, else PNG). */
async function logoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

export default function SettingsForm({ bot, onSaved }: { bot: Bot; onSaved: (b: Bot, message: string) => void }) {
  const [s, setS] = useState({ ...bot, suggestedQuestions: padQuestions(bot.suggestedQuestions) });
  const [saving, setSaving] = useState(false);
  const [group, setGroup] = useState<Group>("basics");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => {
    setS((x) => ({ ...x, [key]: value }));
    setDirty(true);
  };

  async function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    try {
      set("avatarDataUrl", await logoDataUrl(file));
      setError(null);
    } catch {
      setError("This image could not be read.");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const b = await api.updateBot(bot.id, {
        name: s.name.trim(),
        welcomeMessage: s.welcomeMessage.trim(),
        suggestedQuestions: s.suggestedQuestions.map((q) => q.trim()).filter(Boolean),
        leadCaptureEnabled: s.leadCaptureEnabled,
        leadPrompt: s.leadPrompt.trim(),
        leadAfterMessages: Math.min(20, Math.max(0, Math.round(s.leadAfterMessages) || 0)),
        leadTiming: s.leadTiming,
        leadAskEmail: s.leadAskEmail,
        leadAskCourse: s.leadAskCourse,
        leadCourseLabel: s.leadCourseLabel.trim() || "Course / interest",
        tone: s.tone,
        answerLength: s.answerLength,
        topicsToAvoid: s.topicsToAvoid,
        customInstructions: s.customInstructions,
        showSources: s.showSources,
        widgetColor: s.widgetColor ?? "",
        widgetPosition: s.widgetPosition,
        avatarDataUrl: s.avatarDataUrl ?? "",
        hoursEnabled: s.hoursEnabled,
        hoursStart: s.hoursStart,
        hoursEnd: s.hoursEnd,
        hoursDays: s.hoursDays,
        timeZone: s.timeZone,
        offlineMessage: s.offlineMessage,
        replyLanguage: s.replyLanguage,
        voiceEnabled: s.voiceEnabled,
        alertEmailEnabled: s.alertEmailEnabled,
        alertEmail: s.alertEmail ?? "",
        webhookUrl: s.webhookUrl ?? "",
        bookingUrl: s.bookingUrl ?? "",
        bookingLabel: s.bookingLabel.trim() || "Book a visit",
        paymentUrl: s.paymentUrl ?? "",
        upiId: s.upiId ?? "",
        paymentLabel: s.paymentLabel.trim() || "Pay fees",
      });
      setS({ ...b, suggestedQuestions: padQuestions(b.suggestedQuestions) });
      setDirty(false);
      onSaved(b, "Settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const color = s.widgetColor ?? "#4f46e5";

  return (
    <form className="card" onSubmit={save} aria-label="Bot settings" id="settings">
      <div className="card-head">
        <div className="section-title"><span className="section-icon" aria-hidden><Icon name="settings" /></span><h2>Settings</h2></div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="settings-tabs" role="tablist" aria-label="Settings groups">
        {GROUPS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={group === x.id} onClick={() => setGroup(x.id)}>
            {group === x.id && <ActivePill group="settings" />}
            <Icon name={x.icon} size={15} /> {x.label}
          </button>
        ))}
      </div>

      {group === "basics" && (
        <div className="settings-group">

      <div className="form-grid">
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" required maxLength={200} value={s.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="welcomeMessage">Welcome message</label>
          <textarea id="welcomeMessage" maxLength={500} value={s.welcomeMessage} rows={2} style={{ minHeight: 44 }}
            onChange={(e) => set("welcomeMessage", e.target.value)} />
        </div>
      </div>

      <fieldset className="field questions">
        <legend>Suggested questions <span className="muted small">(optional, up to 4)</span></legend>
        <p className="small muted" style={{ margin: "0 0 8px" }}>Shown as buttons under the welcome message, so visitors can ask with one tap.</p>
        <div className="question-grid">
          {s.suggestedQuestions.map((q, i) => (
            <input key={i} type="text" maxLength={120} value={q} aria-label={`Suggested question ${i + 1}`} placeholder={QUESTION_EXAMPLES[i]}
              onChange={(e) => set("suggestedQuestions", s.suggestedQuestions.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
        </div>
      </fieldset>

      {/* ---------- look ---------- */}
      <h3 className="subhead">Look</h3>
      <div className="look-grid">
        <div>
          <span className="small strong-label">Colour</span>
          <div className="swatches" role="group" aria-label="Chat colour">
            {COLORS.map((c) => (
              <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c}
                aria-label={c} title={c} onClick={() => set("widgetColor", c)} />
            ))}
            <input type="color" value={color} onChange={(e) => set("widgetColor", e.target.value)} aria-label="Custom colour" className="color-input" />
          </div>
          <span className="small strong-label" style={{ marginTop: 14 }}>Side of the screen</span>
          <div className="row">
            {(["right", "left"] as const).map((p) => (
              <label key={p} className="check small">
                <input type="radio" name="position" checked={s.widgetPosition === p} onChange={() => set("widgetPosition", p)} />
                {p === "right" ? "Bottom right" : "Bottom left"}
              </label>
            ))}
          </div>
          <span className="small strong-label" style={{ marginTop: 14 }}>Logo</span>
          <div className="row">
            <label className="btn secondary small" style={{ cursor: "pointer" }}>
              {s.avatarDataUrl ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogo} aria-label="Logo" />
            </label>
            {s.avatarDataUrl && <button type="button" className="btn danger small" onClick={() => set("avatarDataUrl", null)}>Remove</button>}
          </div>
        </div>
        <div className="look-preview" aria-hidden>
          <div className="lkp-head" style={{ background: color }}>
            <span className="lkp-avatar">{s.avatarDataUrl ? <img src={s.avatarDataUrl} alt="" /> : s.name.slice(0, 2).toUpperCase()}</span>
            <strong>{s.name}</strong>
          </div>
          <div className="lkp-body"><span className="lkp-msg">{s.welcomeMessage || "Hi! How can I help you today?"}</span></div>
          <span className="lkp-launcher" style={{ background: color, [s.widgetPosition === "left" ? "left" : "right"]: 10 }}>💬</span>
        </div>
      </div>

        </div>
      )}
      {group === "answers" && (
        <div className="settings-group">
      {/* ---------- personality ---------- */}
      <h3 className="subhead">Personality and rules</h3>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="tone">Tone</label>
          <select id="tone" className="status-select wide" value={s.tone} onChange={(e) => set("tone", e.target.value as Bot["tone"])}>
            <option value="friendly">Friendly and warm</option>
            <option value="professional">Polite and professional</option>
            <option value="casual">Casual, like a helpful friend</option>
            <option value="enthusiastic">Energetic and enthusiastic</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="answerLength">Answer length</label>
          <select id="answerLength" className="status-select wide" value={s.answerLength} onChange={(e) => set("answerLength", e.target.value as Bot["answerLength"])}>
            <option value="short">Short (1-2 sentences)</option>
            <option value="medium">Medium (a short paragraph)</option>
            <option value="detailed">Detailed (all the details)</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="topicsToAvoid">Topics to avoid <span className="muted small">(optional)</span></label>
        <input id="topicsToAvoid" type="text" maxLength={500} value={s.topicsToAvoid} onChange={(e) => set("topicsToAvoid", e.target.value)}
          placeholder="e.g. competitors, discounts not in the price list, politics" />
      </div>
      <div className="field">
        <label htmlFor="customInstructions">Extra instructions <span className="muted small">({s.customInstructions.length}/1000)</span></label>
        <textarea id="customInstructions" maxLength={1000} value={s.customInstructions} onChange={(e) => set("customInstructions", e.target.value)}
          placeholder="e.g. Always invite people to the free demo class on Sunday. Call fees “course fees”. Answer in Hindi if the visitor writes in Hindi." />
        <p className="small muted" style={{ margin: "4px 0 0" }}>The bot still only answers from your documents; these shape how it answers.</p>
      </div>
      <div className="form-grid" style={{ marginTop: 6 }}>
        <div className="field">
          <label htmlFor="replyLanguage">Reply language</label>
          <select id="replyLanguage" className="status-select wide" value={s.replyLanguage} onChange={(e) => set("replyLanguage", e.target.value)}>
            <option value="auto">Same as the visitor (Hindi, Hinglish, Tamil…) — recommended</option>
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>Always {label}</option>)}
          </select>
          <p className="small muted" style={{ margin: "4px 0 0" }}>The chat buttons and labels also switch to Hindi, Marathi, Tamil or Telugu.</p>
        </div>
        <div className="field">
          <span className="small strong-label">Voice</span>
          <label className="check small" htmlFor="voiceEnabled">
            <input id="voiceEnabled" type="checkbox" checked={s.voiceEnabled} onChange={(e) => set("voiceEnabled", e.target.checked)} />
            Let visitors speak their question and hear the answer
          </label>
        </div>
      </div>
      <label className="check" htmlFor="showSources">
        <input id="showSources" type="checkbox" checked={s.showSources} onChange={(e) => set("showSources", e.target.checked)} />
        Show where answers come from (e.g. “Source: Fee_List.pdf, page 2”)
      </label>

        </div>
      )}
      {group === "leads" && (
        <div className="settings-group">
      {/* ---------- leads ---------- */}
      <h3 className="subhead">Lead capture</h3>
      <div className="field">
        <label className="check" htmlFor="leadEnabled">
          <input id="leadEnabled" type="checkbox" checked={s.leadCaptureEnabled} onChange={(e) => set("leadCaptureEnabled", e.target.checked)} />
          Ask visitors for their name and phone number
        </label>
        <p className="small muted" style={{ margin: "4px 0 0 28px" }}>Adds a call-back button to the chat and collects enquiries in the Leads list.</p>
      </div>
      {s.leadCaptureEnabled && (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="leadPrompt">Invitation text</label>
              <textarea id="leadPrompt" maxLength={300} value={s.leadPrompt} onChange={(e) => set("leadPrompt", e.target.value)} />
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small strong-label">When to show the form</legend>
              {([["after", "After the bot has answered a few questions"], ["start", "As soon as the chat opens"], ["button", "Only when the visitor taps the call-back button"]] as const).map(([v, label]) => (
                <label key={v} className="check small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  <input type="radio" name="leadTiming" checked={s.leadTiming === v} onChange={() => set("leadTiming", v)} />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
          {s.leadTiming === "after" && (
            <div className="field">
              <label htmlFor="leadAfter">Show the form automatically after this many answers</label>
              <input id="leadAfter" type="number" min={0} max={20} value={s.leadAfterMessages} onChange={(e) => set("leadAfterMessages", Number(e.target.value))} />
            </div>
          )}
          <div className="form-grid">
            <label className="check small">
              <input type="checkbox" checked={s.leadAskEmail} onChange={(e) => set("leadAskEmail", e.target.checked)} />
              Also ask for email (optional for the visitor)
            </label>
            <div>
              <label className="check small">
                <input type="checkbox" checked={s.leadAskCourse} onChange={(e) => set("leadAskCourse", e.target.checked)} />
                Ask what they are interested in
              </label>
              {s.leadAskCourse && (
                <input type="text" maxLength={60} value={s.leadCourseLabel} onChange={(e) => set("leadCourseLabel", e.target.value)}
                  aria-label="Interest field label" placeholder="Course / interest" style={{ marginTop: 6 }} />
              )}
            </div>
          </div>
        </>
      )}

      {/* ---------- alerts ---------- */}
      <h3 className="subhead">Lead alerts</h3>
      <p className="small muted" style={{ marginTop: -4 }}>
        Get every new enquiry the moment it arrives, with one-tap Call and WhatsApp buttons. Owners who call back within an hour
        convert far more leads.
      </p>
      <div className="field">
        <label className="check" htmlFor="alertEmailEnabled">
          <input id="alertEmailEnabled" type="checkbox" checked={s.alertEmailEnabled} onChange={(e) => set("alertEmailEnabled", e.target.checked)} />
          Email me each new lead
        </label>
      </div>
      {s.alertEmailEnabled && (
        <div className="field">
          <label htmlFor="alertEmail">Send to (optional)</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="alertEmail" type="email" maxLength={200} value={s.alertEmail ?? ""} placeholder="Your account email"
              onChange={(e) => set("alertEmail", e.target.value)} />
            <AlertTest botId={bot.id} kind="email" dirty={(s.alertEmail ?? "") !== (bot.alertEmail ?? "") || s.alertEmailEnabled !== bot.alertEmailEnabled} />
          </div>
          <span className="small muted">For example your front desk or counsellor. Empty = your account email.</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="webhookUrl">Webhook: Google Sheets, Zapier, Make or your CRM (optional)</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="webhookUrl" type="url" maxLength={500} value={s.webhookUrl ?? ""} placeholder="https://script.google.com/macros/s/…/exec"
            onChange={(e) => set("webhookUrl", e.target.value)} />
          <AlertTest botId={bot.id} kind="webhook" dirty={(s.webhookUrl ?? "") !== (bot.webhookUrl ?? "")} disabled={!bot.webhookUrl && !s.webhookUrl} />
        </div>
        <span className="small muted">
          Each lead is POSTed as JSON (name, phone, email, course, channel, botName, transcript, createdAt).
          {bot.webhookSecret && <> Signature header <code>X-BotForge-Signature</code> = HMAC-SHA256 with secret <code>{bot.webhookSecret}</code>.</>}
        </span>
      </div>
      <details className="sheets-help">
        <summary>Send leads to a Google Sheet (5 minutes, no coding)</summary>
        <ol className="small">
          <li>Open a new Google Sheet. Menu <strong>Extensions → Apps Script</strong>.</li>
          <li>Delete what is there, paste the code below and click <strong>Save</strong>.</li>
          <li><strong>Deploy → New deployment</strong> → type <strong>Web app</strong>, Execute as <strong>Me</strong>, Who has access <strong>Anyone</strong> → Deploy, and allow access.</li>
          <li>Copy the <strong>Web app URL</strong>, paste it into Webhook above, Save changes, then <strong>Send test</strong>. A row appears in the sheet.</li>
        </ol>
        <pre className="snippet">{SHEETS_SCRIPT}</pre>
        <CopyButton text={SHEETS_SCRIPT} />
      </details>

        </div>
      )}
      {group === "buttons" && (
        <div className="settings-group">
      {/* ---------- action buttons ---------- */}
      <h3 className="subhead">Buttons in the chat</h3>
      <p className="small muted" style={{ marginTop: -4 }}>
        Shown above the message box, and the bot points visitors to them when they want to book or pay
        (on WhatsApp it sends the link). Leave a link empty to hide its button.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bookingUrl">Booking link</label>
          <input id="bookingUrl" type="url" maxLength={500} value={s.bookingUrl ?? ""} placeholder="https://calendly.com/your-name"
            onChange={(e) => set("bookingUrl", e.target.value)} />
          <span className="small muted">Calendly, Google Calendar booking page, Practo, or any form.</span>
        </div>
        <div className="field">
          <label htmlFor="bookingLabel">Button text</label>
          <input id="bookingLabel" type="text" maxLength={40} value={s.bookingLabel} placeholder="Book a visit"
            onChange={(e) => set("bookingLabel", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="paymentUrl">Payment link</label>
          <input id="paymentUrl" type="url" maxLength={500} value={s.paymentUrl ?? ""} placeholder="https://rzp.io/l/your-fees"
            onChange={(e) => set("paymentUrl", e.target.value)} />
          <span className="small muted">A Razorpay, Cashfree or Instamojo payment page.</span>
        </div>
        <div className="field">
          <label htmlFor="upiId">UPI ID</label>
          <input id="upiId" type="text" maxLength={300} value={s.upiId ?? ""} placeholder="yourname@okaxis"
            onChange={(e) => set("upiId", e.target.value)} />
          <span className="small muted">Opens GPay / PhonePe / Paytm on phones; on computers it copies the ID.</span>
        </div>
        <div className="field">
          <label htmlFor="paymentLabel">Payment button text</label>
          <input id="paymentLabel" type="text" maxLength={40} value={s.paymentLabel} placeholder="Pay fees"
            onChange={(e) => set("paymentLabel", e.target.value)} />
        </div>
      </div>

        </div>
      )}
      {group === "hours" && (
        <div className="settings-group">
      {/* ---------- hours ---------- */}
      <h3 className="subhead">Opening hours</h3>
      <label className="check" htmlFor="hoursEnabled">
        <input id="hoursEnabled" type="checkbox" checked={s.hoursEnabled} onChange={(e) => set("hoursEnabled", e.target.checked)} />
        Show a message when you are closed (the bot keeps answering)
      </label>
      {s.hoursEnabled && (
        <div className="hours-grid">
          <div className="row">
            <label className="small" htmlFor="hoursStart">Open</label>
            <input id="hoursStart" type="time" value={s.hoursStart} onChange={(e) => set("hoursStart", e.target.value)} />
            <label className="small" htmlFor="hoursEnd">Close</label>
            <input id="hoursEnd" type="time" value={s.hoursEnd} onChange={(e) => set("hoursEnd", e.target.value)} />
            <select className="status-select" value={s.timeZone} onChange={(e) => set("timeZone", e.target.value)} aria-label="Time zone">
              {[...new Set([s.timeZone, ...ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="day-toggles" role="group" aria-label="Open on">
            {DAYS.map((d, i) => {
              const day = i + 1;
              const on = s.hoursDays.includes(day);
              return (
                <button key={d} type="button" className={`day${on ? " on" : ""}`} aria-pressed={on}
                  onClick={() => set("hoursDays", on ? s.hoursDays.filter((x) => x !== day) : [...s.hoursDays, day].sort())}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="field">
            <label htmlFor="offlineMessage">Message while closed</label>
            <input id="offlineMessage" type="text" maxLength={300} value={s.offlineMessage} onChange={(e) => set("offlineMessage", e.target.value)} />
          </div>
        </div>
      )}

        </div>
      )}

      <div className="save-bar">
        <span className={dirty ? "dirty" : "muted small"}>{dirty ? "You have unsaved changes" : "All changes saved"}</span>
        <button className="btn" type="submit" disabled={saving || !s.name.trim()}>{saving ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}

/** Apps Script for "send leads to a Google Sheet": appends one row per lead. */
const SHEETS_SCRIPT = `function doPost(e) {
  var lead = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date", "Name", "Phone", "Email", "Interested in", "Came from", "Bot", "Chat"]);
  }
  sheet.appendRow([new Date(lead.createdAt), lead.name, "'" + lead.phone, lead.email || "",
    lead.course || "", lead.channel, lead.botName, lead.transcript]);
  return ContentService.createTextOutput("ok");
}`;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={() => {
      navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => undefined);
    }}>{done ? "Copied!" : "Copy code"}</button>
  );
}

/** Sends a sample lead to the saved email or webhook and says what happened. */
function AlertTest({ botId, kind, dirty, disabled }: { botId: string; kind: "email" | "webhook"; dirty: boolean; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | { ok: boolean; text: string }>("idle");
  async function run() {
    setState("sending");
    try {
      const r = await api.testAlert(botId, kind);
      setState(r.ok
        ? { ok: true, text: kind === "email" ? "Sent. Check the inbox (and spam)." : `Delivered (${r.status}).` }
        : { ok: false, text: r.error ?? "It did not work." });
    } catch (e) {
      setState({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <div className="alert-test">
      <button type="button" className="btn secondary small" onClick={run} disabled={disabled || dirty || state === "sending"}
        title={dirty ? "Save changes first" : undefined}>
        {state === "sending" ? "Sending…" : "Send test"}
      </button>
      {typeof state === "object" && <span className={`small ${state.ok ? "ok-text" : "err-text"}`} role="status">{state.text}</span>}
    </div>
  );
}
