// Records the Kahiye intro video from the real product (a running local stack), with captions.
//   node scripts/record-intro.mjs [siteUrl]      (default http://localhost:3002)
// Output: apps/dashboard/public/media/kahiye-intro.webm (convert to MP4 for WhatsApp with any converter or ffmpeg).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(new URL("../tests/e2e-ui/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const SITE = (process.argv[2] ?? "http://localhost:3002").replace(/\/$/, "");
const OUT = new URL("../apps/dashboard/public/media/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TMP = join(OUT, "_rec");
const size = { width: 1280, height: 720 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CARD = (title, sub, extra = "") => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@500&display=swap" rel="stylesheet">
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:Inter,sans-serif;color:#0b1020;
background:radial-gradient(600px 400px at 20% 10%,#99f6e4,transparent 70%),radial-gradient(600px 400px at 90% 90%,#fde68a,transparent 70%),#f6fbfa}
.c{text-align:center;animation:in .8s cubic-bezier(.2,.8,.2,1) both}h1{font:800 72px "Plus Jakarta Sans";letter-spacing:-.04em;margin:0}
h1 span{background:linear-gradient(90deg,#0f766e,#0d9488,#d97706);-webkit-background-clip:text;color:transparent}
p{font-size:26px;color:#5b6478;margin:14px 0 0}.x{margin-top:28px;font-size:20px;font-weight:600;color:#0f766e}
@keyframes in{from{opacity:0;transform:translateY(20px)}to{opacity:1}}</style></head>
<body><div class="c"><h1>${title}</h1><p>${sub}</p>${extra ? `<div class="x">${extra}</div>` : ""}</div></body></html>`;

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("kz-cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "kz-cap";
      el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;padding:14px 26px;border-radius:999px;" +
        "background:rgba(11,16,32,.88);color:#fff;font:600 22px Inter,system-ui,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.3);transition:opacity .3s";
      document.body.appendChild(el);
    }
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = t; el.style.opacity = "1"; }, 150);
  }, text);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: TMP, size } });
await context.addInitScript(() => { try { localStorage.setItem("kahiye.notice", "1"); } catch {} });
const page = await context.newPage();
const id = Math.random().toString(36).slice(2, 7);

// 1. title
await page.setContent(CARD('Meet <span>Kahiye</span>', "The AI receptionist for your business"));
await wait(3500);

// 2. the problem, then the website
await page.setContent(CARD("10:47 PM.", "A parent asks your institute about fees. Your office closed at 7.", "Who answers?"));
await wait(3800);
await page.goto(SITE);
await caption(page, "Kahiye answers every customer, day and night");
await wait(3500);
await page.mouse.move(900, 500, { steps: 20 });
await page.evaluate(() => window.scrollTo({ top: 560, behavior: "smooth" }));
await wait(4000);

// 3. sign up and set up (about 2 minutes in real life)
await page.goto(`${SITE}/register`);
await caption(page, "Create your free account");
await page.getByLabel("Business name").pressSequentially("Sunrise Academy", { delay: 45 });
await page.getByLabel("Email").pressSequentially(`demo-${id}@sunrise.example`, { delay: 25 });
await page.getByLabel("Password").pressSequentially("Sunrise-2026!", { delay: 35 });
await wait(500);
await page.getByRole("button", { name: "Create account" }).click();
await page.getByRole("heading", { name: "Tell us about your business" }).waitFor();
await caption(page, "Tell it what kind of business you run");
await wait(1800);
await page.getByLabel("Which language should it reply in?").selectOption("auto");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("heading", { name: "Teach your assistant" }).waitFor();
await caption(page, "Upload your brochure, or let it read your website");
await wait(2200);
await page.getByRole("button", { name: /Try with a sample/ }).click();
await page.getByRole("heading", { name: "Your assistant is ready!" }).waitFor({ timeout: 120000 });
await caption(page, "Ready in about a minute");
await wait(2500);

// 4. a customer asks, in Hinglish, on the shareable demo link
await page.getByRole("link", { name: "Go to my dashboard" }).click();
await page.waitForURL(/\/bots\/[0-9a-f-]{36}/);
const botUrl = page.url().split("#")[0];
await page.getByRole("navigation", { name: "Bot sections" }).getByRole("button", { name: "Install" }).click();
const demoLink = (await page.getByTestId("demo-link").textContent()).trim();
await page.goto(demoLink);
await caption(page, "Customers ask anything, in Hindi, Hinglish or English");
const widget = page.locator("[data-kahiye]");
await widget.getByRole("button", { name: "Close chat" }).waitFor({ timeout: 15000 }).catch(() => {});
await wait(1200);
await page.getByRole("button", { name: "Aapki fees kitni hai?" }).click();
await wait(9000);
await caption(page, "Interested? They leave their number for a call back");
await widget.getByRole("button", { name: "Request a call back" }).click();
await widget.getByPlaceholder("e.g. Asha Patil").pressSequentially("Rohan Mehta", { delay: 40 });
await widget.getByPlaceholder("e.g. 98200 12345").pressSequentially("9820012345", { delay: 40 });
await wait(400);
await widget.getByRole("button", { name: /call back/i }).last().click();
await wait(2500);

// 5. the owner sees the lead
await page.goto(`${botUrl}#leads`);
await caption(page, "Every lead lands in your dashboard and your email, instantly");
await wait(4500);

// 6. step in personally
await page.getByRole("navigation", { name: "Bot sections" }).getByRole("button", { name: "Conversations" }).click();
await page.locator(".convo-item").first().click();
await caption(page, "Take over any chat and reply yourself");
await page.getByRole("button", { name: "Take over" }).click();
await page.getByLabel("Your reply").pressSequentially("Hi Rohan, this is Priya from Sunrise. Calling you in 5 minutes!", { delay: 22 });
await page.getByRole("button", { name: "Send", exact: true }).click();
await wait(3000);

// 7. end card
await page.setContent(CARD('Start free with <span>Kahiye</span>', "14 days free · No card needed · Live in 10 minutes", "Your next customer is on your website right now."));
await wait(4500);

const video = page.video();
await context.close();
await browser.close();
const recorded = await video.path();
renameSync(recorded, join(OUT, "kahiye-intro.webm"));
rmSync(TMP, { recursive: true, force: true });
console.log("saved", join(OUT, "kahiye-intro.webm"), "from", readdirSync(OUT));
