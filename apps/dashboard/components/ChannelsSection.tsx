"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, Channel, ChannelKind } from "@/lib/api";
import Icon, { type IconName } from "@/components/Icon";

interface Field {
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

const APPS: { kind: ChannelKind; label: string; icon: IconName; steps: string[]; fields: Field[] }[] = [
  {
    kind: "whatsapp", label: "WhatsApp", icon: "message",
    steps: [
      "Go to developers.facebook.com → My Apps → Create app → type Business, and add the WhatsApp product.",
      "In WhatsApp → API Setup, add your business phone number (it must not be used in the normal WhatsApp app). Copy its Phone number ID.",
      "Create a permanent access token: business.facebook.com → Settings → System users → Generate token with whatsapp_business_messaging permission.",
      "Copy the App secret from App settings → Basic.",
      "After connecting, paste the Callback URL and Verify token below into WhatsApp → Configuration → Webhook, and subscribe to “messages”.",
    ],
    fields: [
      { name: "phoneNumberId", label: "Phone number ID", placeholder: "e.g. 109876543210987" },
      { name: "accessToken", label: "Permanent access token", placeholder: "EAAG…", secret: true },
      { name: "appSecret", label: "App secret", placeholder: "32 characters", secret: true },
    ],
  },
  {
    kind: "instagram", label: "Instagram", icon: "camera",
    steps: [
      "Your Instagram account must be a Professional account linked to a Facebook Page (Meta Business Suite → Settings → Instagram).",
      "In your Meta app add the Messenger product, then Instagram settings; generate a Page access token for the linked Page.",
      "In Instagram → Settings → Messages and replies → Message controls, allow access to messages for connected tools.",
      "After connecting, paste the Callback URL and Verify token into the app's Webhooks (object: Instagram, field: messages).",
    ],
    fields: [
      { name: "pageToken", label: "Page access token", placeholder: "EAAP…", secret: true },
      { name: "appSecret", label: "App secret", placeholder: "32 characters", secret: true },
    ],
  },
  {
    kind: "messenger", label: "Messenger", icon: "chat",
    steps: [
      "In your Meta app add the Messenger product and generate a Page access token for your Facebook Page.",
      "Copy the App secret from App settings → Basic.",
      "After connecting, paste the Callback URL and Verify token into Messenger → Webhooks (object: Page, field: messages).",
    ],
    fields: [
      { name: "pageToken", label: "Page access token", placeholder: "EAAP…", secret: true },
      { name: "appSecret", label: "App secret", placeholder: "32 characters", secret: true },
    ],
  },
  {
    kind: "telegram", label: "Telegram", icon: "send",
    steps: [
      "Open Telegram, search for @BotFather and send /newbot. Choose a name and a username ending in “bot”.",
      "BotFather replies with a token like 123456789:AA… — paste it here. That's all: Kahiye connects the rest.",
    ],
    fields: [{ name: "token", label: "Bot token", placeholder: "123456789:AA…", secret: true }],
  },
];

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-row">
      <span className="small strong-label">{label}</span>
      <code>{value}</code>
      <button type="button" className="btn secondary small" onClick={() => {
        void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
      }}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** WhatsApp, Instagram, Messenger and Telegram: the bot answers there from the same knowledge. */
export default function ChannelsSection({ botId }: { botId: string }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [kind, setKind] = useState<ChannelKind | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChannels(await api.listChannels(botId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.addChannel(botId, { kind, ...values });
      setKind(null);
      setValues({});
      setJustAdded(c.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Channel) {
    if (!confirm(`Disconnect ${c.displayName}? The bot stops answering there.`)) return;
    await api.deleteChannel(botId, c.id).catch((e: Error) => setError(e.message));
    await load();
  }

  const app = APPS.find((a) => a.kind === kind);

  return (
    <section className="card" id="apps" aria-label="Messaging apps">
      <div className="card-head">
        <div className="section-title"><span className="section-icon" aria-hidden><Icon name="apps" /></span><h2>Messaging apps</h2></div>
      </div>
      <p className="small muted">
        Answer customers on WhatsApp, Instagram, Messenger and Telegram with the same knowledge, including voice notes.
        Conversations appear below; every new WhatsApp chat becomes a lead with the customer&apos;s number.
      </p>
      {error && <div className="alert error" role="alert">{error}</div>}

      {channels?.map((c) => {
        const meta = APPS.find((a) => a.kind === c.kind)!;
        return (
          <div key={c.id} className={`channel-row${justAdded === c.id ? " fresh" : ""}`}>
            <div className="channel-top">
              <span className="channel-icon" aria-hidden><Icon name={meta.icon} size={20} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{meta.label}</strong> <span className="muted">· {c.displayName}</span>
                <div className="small muted">
                  {c.lastError ? <span style={{ color: "var(--danger)" }}>Problem: {c.lastError}</span>
                    : c.lastMessageAt ? `Last message ${new Date(c.lastMessageAt).toLocaleString()}` : "Waiting for the first message"}
                </div>
              </div>
              <button className="btn danger small" onClick={() => void remove(c)}>Disconnect</button>
            </div>
            {c.verifyToken && (
              <details open={justAdded === c.id} className="webhook-details">
                <summary className="small">Webhook details for Meta</summary>
                <Copy label="Callback URL" value={c.webhookUrl} />
                <Copy label="Verify token" value={c.verifyToken} />
              </details>
            )}
          </div>
        );
      })}

      {!kind ? (
        <div className="row" style={{ marginTop: 12 }}>
          {APPS.map((a) => (
            <button key={a.kind} className="btn secondary small" onClick={() => { setKind(a.kind); setError(null); }}>
              <Icon name={a.icon} size={15} /> Connect {a.label}
            </button>
          ))}
        </div>
      ) : (
        <form className="qa-form" onSubmit={connect} aria-label={`Connect ${app!.label}`} style={{ marginTop: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><Icon name={app!.icon} /> Connect {app!.label}</h3>
          <ol className="setup-steps small">{app!.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {app!.fields.map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`ch-${f.name}`}>{f.label}</label>
              <input id={`ch-${f.name}`} type={f.secret ? "password" : "text"} autoComplete="off" required placeholder={f.placeholder}
                value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
            </div>
          ))}
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Connect"}</button>
            <button className="btn secondary" type="button" onClick={() => { setKind(null); setValues({}); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
