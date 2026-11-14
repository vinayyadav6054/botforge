"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { api, Bot } from "@/lib/api";
import Icon from "@/components/Icon";

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
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => setS((x) => ({ ...x, [key]: value }));

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
      });
      setS({ ...b, suggestedQuestions: padQuestions(b.suggestedQuestions) });
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
          <div className="lp-head" style={{ background: color }}>
            <span className="lp-avatar">{s.avatarDataUrl ? <img src={s.avatarDataUrl} alt="" /> : s.name.slice(0, 2).toUpperCase()}</span>
            <strong>{s.name}</strong>
          </div>
          <div className="lp-body"><span className="lp-msg">{s.welcomeMessage || "Hi! How can I help you today?"}</span></div>
          <span className="lp-launcher" style={{ background: color, [s.widgetPosition === "left" ? "left" : "right"]: 10 }}>💬</span>
        </div>
      </div>

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

      <div style={{ marginTop: 18 }}>
        <button className="btn" type="submit" disabled={saving || !s.name.trim()}>{saving ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}
