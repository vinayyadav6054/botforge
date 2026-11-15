/** @type {import('next').NextConfig} */

// where the API (and the chat widget script) lives: allowed to load scripts and receive requests
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : "";
const dev = process.env.NODE_ENV === "development";

// Content Security Policy: only our own code, the API, Google sign-in and Google Fonts; nobody may frame the app
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://accounts.google.com ${apiOrigin}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${apiOrigin} https://accounts.google.com`,
  "frame-src https://accounts.google.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // the widget preview may use the microphone on our own pages; nothing else is needed
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // self-contained server for the Docker image (NEXT_OUTPUT=standalone); plain `next start` otherwise
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
