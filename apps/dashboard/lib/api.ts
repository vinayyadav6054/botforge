// absolute (gateway on another host) or relative like "/api" (dashboard served through the gateway)
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

/** Origin that serves /widget.js; for a relative API_URL that is the site the dashboard runs on. */
export function gatewayOrigin(): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  return new URL(API_URL, base).origin;
}

const TOKEN_KEY = "botforge.session";

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
}

export interface BotSettings {
  name: string;
  welcomeMessage: string;
  leadCaptureEnabled: boolean;
  leadPrompt: string;
  leadAfterMessages: number;
  suggestedQuestions: string[];
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
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
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
  register: (tenantName: string, email: string, password: string) =>
    authenticate("/auth/register-tenant", { tenantName, email, password }),

  listBots: () => request<Bot[]>("/bots"),
  getBot: (id: string) => request<Bot>(`/bots/${id}`),
  createBot: (name: string, welcomeMessage: string) =>
    request<Bot>("/bots", { method: "POST", body: JSON.stringify({ name, welcomeMessage }) }),
  updateBot: (id: string, settings: BotSettings) =>
    request<Bot>(`/bots/${id}`, { method: "PUT", body: JSON.stringify(settings) }),
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

  // conversations
  listConversations: (botId: string, before?: string) =>
    request<ConversationSummary[]>(`/bots/${botId}/conversations?take=20${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  getConversation: (botId: string, id: string) => request<Conversation>(`/bots/${botId}/conversations/${id}`),
  deleteConversation: (botId: string, id: string) =>
    request<void>(`/bots/${botId}/conversations/${id}`, { method: "DELETE" }),

  // account, plan and billing
  me: () => request<Me>("/auth/me"),
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
}

export interface Conversation {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  pageUrl: string | null;
  messages: { role: "user" | "assistant"; text: string; answered: boolean; createdAt: string }[];
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
