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

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
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
  updateBot: (id: string, name: string, welcomeMessage: string) =>
    request<Bot>(`/bots/${id}`, { method: "PUT", body: JSON.stringify({ name, welcomeMessage }) }),
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
};
