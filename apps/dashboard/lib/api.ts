// absolute (gateway on another host) or relative like "/api" (dashboard served through the gateway)
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

/** Origin that serves /widget.js; for a relative API_URL that is the site the dashboard runs on. */
export function gatewayOrigin(): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  return new URL(API_URL, base).origin;
}

const TOKEN_KEY = "kahiye.session";
/** The session key before the rename to Kahiye: still read, so nobody is logged out. */
const OLD_TOKEN_KEY = "botforge.session";

export interface Session {
  token: string;
  email: string;
  tenantSlug: string;
  role: string;
}

export interface Bot {
  id: string;
  name: string;
  welcomeMessage: string;
  publicKey: string;
  createdAt: string;
  leadCaptureEnabled: boolean;
  leadPrompt: string;
  leadAfterMessages: number;
  suggestedQuestions: string[];
  leadAskEmail: boolean;
  leadAskCourse: boolean;
  leadCourseLabel: string;
  leadTiming: "after" | "start" | "button";
  tone: "friendly" | "professional" | "casual" | "enthusiastic";
  answerLength: "short" | "medium" | "detailed";
  topicsToAvoid: string;
  customInstructions: string;
  showSources: boolean;
  noAnswerMessage: string;
  widgetColor: string | null;
  widgetPosition: "right" | "left";
  avatarDataUrl: string | null;
  hoursEnabled: boolean;
  hoursStart: string;
  hoursEnd: string;
  hoursDays: number[];
  timeZone: string;
  offlineMessage: string;
  replyLanguage: string;
  voiceEnabled: boolean;
  alertEmailEnabled: boolean;
  /** null = the owner's own address */
  alertEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  bookingUrl: string | null;
  bookingLabel: string;
  paymentUrl: string | null;
  upiId: string | null;
  paymentLabel: string;
}

export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "telegram";

export interface Channel {
  id: string;
  kind: ChannelKind;
  displayName: string;
  webhookUrl: string;
  verifyToken: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastError: string | null;
}

type Clearable = "widgetColor" | "avatarDataUrl" | "alertEmail" | "webhookUrl" | "bookingUrl" | "paymentUrl" | "upiId";

/** PUT /bots/{id}: any subset; "" clears the optional texts and links. */
export type BotSettings = Partial<Omit<Bot, "id" | "publicKey" | "createdAt" | "webhookSecret" | Clearable>> & {
  name: string;
} & Partial<Record<Clearable, string>>;

export interface AlertTestResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export type SourceKind = "website" | "google" | "notion" | "youtube";

export interface QaEntry {
  id: string;
  question: string;
  answer: string;
  updatedAt: string;
}

export interface Unanswered {
  question: string;
  count: number;
  lastAskedAt: string;
}

export interface SourceRef {
  name: string;
  location?: string | null;
  url?: string | null;
}

export type LeadStatus = "New" | "Contacted" | "Converted" | "Junk";
export const LEAD_STATUSES: LeadStatus[] = ["New", "Contacted", "Converted", "Junk"];

export interface Lead {
  id: string;
  botId: string;
  name: string;
  phone: string;
  email: string | null;
  course: string | null;
  pageUrl: string | null;
  transcript: string; // JSON array of {role, text}
  status: LeadStatus | string;
  createdAt: string;
  channel: "web" | ChannelKind;
}

export interface BotDocument {
  id: string;
  botId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: "Uploaded" | "UploadedUnqueued" | "Ready" | "Failed" | string;
  chunkCount: number | null;
  error: string | null;
  createdAt: string;
  kind: "file" | SourceKind;
  sourceUrl: string | null;
  syncIntervalDays: number;
  lastSyncedAt: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(OLD_TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return isExpired(s.token) ? (clearSession(), null) : s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(OLD_TOKEN_KEY);
}

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now() + 10_000;
  } catch {
    return true;
  }
}

async function send(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth) {
    const s = getSession();
    if (!s) throw new ApiError(401, "Please log in again.");
    headers.set("Authorization", `Bearer ${s.token}`);
  }
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the gateway running?");
  }

  if (res.status === 401 && auth) {
    clearSession();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "Your session expired. Please log in again.");
  }
  if (!res.ok) {
    let message = res.status === 429 ? "Too many attempts. Please wait a minute." : `Request failed (${res.status}).`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const res = await send(path, init, auth);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface AuthResponse {
  token: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  role: string;
}

async function authenticate(path: string, body: object): Promise<Session> {
  const r = await request<AuthResponse>(path, { method: "POST", body: JSON.stringify(body) }, false);
  const session = { token: r.token, email: r.email, tenantSlug: r.tenantSlug, role: r.role };
  saveSession(session);
  return session;
}

export const api = {
  login: (email: string, password: string) => authenticate("/auth/login", { email, password }),
  /** "Continue with Google": isNew is true when this created the account (then onboarding continues). */
  google: async (credential: string, tenantName?: string) => {
    const r = await request<AuthResponse & { isNew: boolean }>("/auth/google",
      { method: "POST", body: JSON.stringify({ credential, tenantName }) }, false);
    saveSession({ token: r.token, email: r.email, tenantSlug: r.tenantSlug, role: r.role });
    return r.isNew;
  },
  register: (tenantName: string, email: string, password: string) =>
    authenticate("/auth/register-tenant", { tenantName, email, password }),

  listBots: () => request<Bot[]>("/bots"),
  getBot: (id: string) => request<Bot>(`/bots/${id}`),
  createBot: (name: string, welcomeMessage: string) =>
    request<Bot>("/bots", { method: "POST", body: JSON.stringify({ name, welcomeMessage }) }),
  updateBot: (id: string, settings: BotSettings) =>
    request<Bot>(`/bots/${id}`, { method: "PUT", body: JSON.stringify(settings) }),
  testAlert: (botId: string, kind: "email" | "webhook") =>
    request<AlertTestResult>(`/bots/${botId}/alerts/test`, { method: "POST", body: JSON.stringify({ kind }) }),
  deleteBot: (id: string) => request<void>(`/bots/${id}`, { method: "DELETE" }),

  listDocuments: (botId: string) => request<BotDocument[]>(`/bots/${botId}/documents`),
  uploadDocument: (botId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<BotDocument>(`/bots/${botId}/documents`, { method: "POST", body: form });
  },
  reprocessDocument: (botId: string, docId: string) =>
    request<BotDocument>(`/bots/${botId}/documents/${docId}/reprocess`, { method: "POST" }),
  deleteDocument: (botId: string, docId: string) =>
    request<void>(`/bots/${botId}/documents/${docId}`, { method: "DELETE" }),

  listLeads: (botId: string) => request<Lead[]>(`/bots/${botId}/leads`),
  updateLeadStatus: (botId: string, leadId: string, status: LeadStatus) =>
    request<Lead>(`/bots/${botId}/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteLead: (botId: string, leadId: string) =>
    request<void>(`/bots/${botId}/leads/${leadId}`, { method: "DELETE" }),
  exportLeads: async (botId: string) => (await send(`/bots/${botId}/leads/export`)).blob(),

  // online sources, owner answers, unanswered questions
  addSource: (botId: string, body: { kind: SourceKind; url: string; token?: string; syncIntervalDays?: number }) =>
    request<BotDocument>(`/bots/${botId}/sources`, { method: "POST", body: JSON.stringify(body) }),
  setSyncInterval: (botId: string, docId: string, syncIntervalDays: number) =>
    request<BotDocument>(`/bots/${botId}/sources/${docId}`, { method: "PATCH", body: JSON.stringify({ syncIntervalDays }) }),
  listQa: (botId: string) => request<QaEntry[]>(`/bots/${botId}/qa`),
  createQa: (botId: string, question: string, answer: string, fromQuestion?: string) =>
    request<QaEntry>(`/bots/${botId}/qa`, { method: "POST", body: JSON.stringify({ question, answer, fromQuestion }) }),
  updateQa: (botId: string, id: string, question: string, answer: string) =>
    request<QaEntry>(`/bots/${botId}/qa/${id}`, { method: "PUT", body: JSON.stringify({ question, answer }) }),
  deleteQa: (botId: string, id: string) => request<void>(`/bots/${botId}/qa/${id}`, { method: "DELETE" }),
  listUnanswered: (botId: string) => request<Unanswered[]>(`/bots/${botId}/unanswered`),
  dismissUnanswered: (botId: string, question: string) =>
    request<object>(`/bots/${botId}/unanswered/dismiss`, { method: "POST", body: JSON.stringify({ question }) }),

  // messaging apps
  listChannels: (botId: string) => request<Channel[]>(`/bots/${botId}/channels`),
  addChannel: (botId: string, body: Record<string, string>) =>
    request<Channel>(`/bots/${botId}/channels`, { method: "POST", body: JSON.stringify(body) }),
  deleteChannel: (botId: string, id: string) => request<void>(`/bots/${botId}/channels/${id}`, { method: "DELETE" }),

  // conversations
  listConversations: (botId: string, before?: string) =>
    request<ConversationSummary[]>(`/bots/${botId}/conversations?take=20${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  getConversation: (botId: string, id: string) => request<Conversation>(`/bots/${botId}/conversations/${id}`),
  takeOver: (botId: string, id: string) =>
    request<{ human: boolean; humanUntil: string | null }>(`/bots/${botId}/conversations/${id}/takeover`, { method: "POST" }),
  handBack: (botId: string, id: string) =>
    request<{ human: boolean }>(`/bots/${botId}/conversations/${id}/release`, { method: "POST" }),
  reply: (botId: string, id: string, text: string) =>
    request<ConversationMessage>(`/bots/${botId}/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  deleteConversation: (botId: string, id: string) =>
    request<void>(`/bots/${botId}/conversations/${id}`, { method: "DELETE" }),

  // account, plan and billing
  me: () => request<Me>("/auth/me"),
  support: (topic: string, message: string) =>
    request<{ sent: boolean }>("/support", { method: "POST", body: JSON.stringify({ topic, message }) }),
  account: () => request<Account>("/account"),
  checkout: (plan: string) => request<{ url: string }>("/account/checkout", { method: "POST", body: JSON.stringify({ plan }) }),
  cancelSubscription: () => request<void>("/account/cancel", { method: "POST" }),
  /** Everything stored about the business: bot data from /account/export plus the account itself. */
  exportAll: async () => {
    const [account, data] = await Promise.all([request<object>("/auth/export"), request<object>("/account/export")]);
    return new Blob([JSON.stringify({ account, ...data }, null, 2)], { type: "application/json" });
  },
  deleteAccount: (password: string) =>
    request<void>("/auth/delete-account", { method: "POST", body: JSON.stringify({ password }) }),
  resendVerification: () => request<{ sent: boolean; emailVerified: boolean }>("/auth/resend-verification", { method: "POST" }),

  // signed-out flows
  verifyEmail: (token: string) =>
    request<{ email: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }, false),
  forgotPassword: (email: string) =>
    request<void>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }, false),
  resetPassword: (token: string, password: string) => authenticate("/auth/reset-password", { token, password }),

  // platform admin (X-Admin-Key, not a login)
  adminTenants: (key: string) => request<AdminTenant[]>("/admin/tenants", { headers: { "X-Admin-Key": key } }, false),
  adminSubscriptions: (key: string) =>
    request<AdminSubscription[]>("/admin/subscriptions", { headers: { "X-Admin-Key": key } }, false),
  adminSetPlan: (key: string, tenantId: string, body: { plan?: string; months?: number; trialDays?: number }) =>
    request<object>(`/admin/subscriptions/${tenantId}`, { method: "PUT", headers: { "X-Admin-Key": key }, body: JSON.stringify(body) }, false),
};

export interface ConversationSummary {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  unansweredCount: number;
  firstQuestion: string | null;
  pageUrl: string | null;
  channel: "web" | ChannelKind;
  contactName: string | null;
  contactId: string | null;
  /** a person from the business is replying; the bot is paused */
  human: boolean;
}

export interface ConversationMessage {
  /** agent = a person from the business */
  role: "user" | "assistant" | "agent";
  text: string;
  answered: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  pageUrl: string | null;
  messages: ConversationMessage[];
  channel: "web" | ChannelKind;
  contactName: string | null;
  human: boolean;
  humanUntil: string | null;
}

export interface Me {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  tenantName: string;
  emailVerified: boolean;
}

export interface Plan {
  id: string;
  name: string;
  bots: number;
  documents: number;
  answersPerMonth: number;
  removeBranding: boolean;
  priceInr: number;
  websitePages: number;
  messagingApps: boolean;
}

export interface Account {
  plan: Plan;
  subscription: {
    plan: string;
    status: "trialing" | "active" | "halted" | "cancelled";
    trialEndsAt: string;
    currentPeriodEnd: string | null;
    provider: string | null;
  };
  usage: { period: string; answers: number; bots: number; documents: number };
  plans: Plan[];
  /** plan ids that can be paid online right now (Razorpay configured) */
  onlinePayment: string[];
}

export interface AdminTenant {
  tenantId: string;
  name: string;
  slug: string;
  createdAt: string;
  owner: { email: string; emailVerified: boolean } | null;
}

export interface AdminSubscription {
  tenantId: string;
  plan: string;
  status: string;
  effectivePlan: string;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  provider: string | null;
  answersThisMonth: number;
  bots: number;
}


export interface PlaygroundHandlers {
  onToken: (text: string) => void;
  onSources: (items: SourceRef[]) => void;
  onMeta: (meta: { sources: number }) => void;
}

/** The dashboard's test chat: the real public chat API in playground mode (answers count, nothing is stored). */
export async function playgroundAsk(publicKey: string, message: string, history: { role: string; text: string }[],
  handlers: PlaygroundHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/chat/${publicKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, playground: true }),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server.");
  }
  if (!res.ok || !res.body) throw new ApiError(res.status, res.status === 429 ? "Too many messages. Wait a moment." : "The chat failed.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? "\n\n" : decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || !raw) continue;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(raw); } catch { /* ignore */ }
      if (event === "token" && typeof data.text === "string") handlers.onToken(data.text);
      else if (event === "sources" && Array.isArray(data.items)) handlers.onSources(data.items as SourceRef[]);
      else if (event === "meta") handlers.onMeta({ sources: Number(data.sources) || 0 });
      else if (event === "error") throw new ApiError(500, typeof data.message === "string" ? data.message : "The chat failed.");
      else if (event === "done") return;
    }
    if (done) return;
  }
}
