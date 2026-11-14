import { expect, Page, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const GATEWAY = process.env.BOTFORGE_GATEWAY ?? "http://localhost:5000";
const FAQ = [
  "Harbor Coffee FAQ",
  "",
  "We are open every day from 6am to 8pm.",
  "",
  "Our loyalty code is MAPLE-913 and gives a free espresso after nine coffees.",
].join("\n");

function newOwner() {
  const id = Math.random().toString(36).slice(2, 10);
  return { business: `Harbor Coffee ${id}`, email: `ui-${id}@example.com`, password: "Ui-Passw0rd!" };
}

async function register(page: Page, owner: ReturnType<typeof newOwner>) {
  await page.goto("/register");
  await page.getByLabel("Business name").fill(owner.business);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/bots$/);
}

/** Asks the widget a question and returns the text of the bot's answer bubble. */
async function askWidget(page: Page, question: string) {
  const widget = page.locator("[data-kahiye]");
  const launcher = widget.getByRole("button", { name: "Open chat" });
  if (await launcher.isVisible()) await launcher.click();
  const input = widget.getByLabel("Message");
  await input.fill(question);
  await input.press("Enter");
  const answer = widget.locator(".msg.bot").last();
  // wait until streaming finished: the send button is re-enabled
  await expect(widget.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 });
  return (await answer.textContent()) ?? "";
}

test("owner signs up, builds a bot from a document and chats with it in the live preview", async ({ page }) => {
  const owner = newOwner();
  await register(page, owner);
  await expect(page.getByText("You have no bots yet.")).toBeVisible();

  // create bot
  await page.getByRole("button", { name: "Create your first bot" }).click();
  await page.getByLabel("Name").fill("Coffee Helper");
  await page.getByLabel("Welcome message (optional)").fill("Hi! Ask me about Harbor Coffee.");
  await page.getByRole("button", { name: "Create bot" }).click();
  await expect(page).toHaveURL(/\/bots\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Coffee Helper" })).toBeVisible();

  // the preview stays disabled until a document is ready
  await expect(page.getByRole("button", { name: "Test your bot" })).toBeDisabled();

  // upload and wait for ingestion (status is polled by the page)
  await page.getByLabel("Upload documents").setInputFiles({
    name: "faq.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(FAQ),
  });
  await expect(page.locator(".source-name", { hasText: "faq.txt" })).toBeVisible();
  await expect(page.getByText(/Ready · \d+ chunks?/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("1 of 1 document ready")).toBeVisible();

  // embed snippet contains the public key and the gateway URL
  await page.getByRole("navigation", { name: "Bot sections" }).getByRole("button", { name: "Install" }).click();
  const snippet = await page.getByTestId("embed-snippet").textContent();
  expect(snippet).toMatch(new RegExp(`<script src="${GATEWAY}/widget.js" data-bot-key="bk_[0-9a-f]{32}" async></script>`));

  // live preview with the real widget
  await page.getByRole("button", { name: "Test your bot" }).click();
  const widget = page.locator("[data-kahiye]");
  await widget.getByRole("button", { name: "Open chat" }).click();
  await expect(widget.locator(".title")).toHaveText("Coffee Helper");
  await expect(widget.locator(".msg.bot").first()).toHaveText("Hi! Ask me about Harbor Coffee.");

  const answer = await askWidget(page, "What is the loyalty code?");
  expect(answer).toContain("MAPLE-913");

  // follow-up uses the conversation history
  const followUp = await askWidget(page, "And until what time are you open?");
  expect(followUp).toMatch(/8\s?(pm|p\.m\.)|20:00/i);

  // closing the preview removes the widget
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(widget).toHaveCount(0);

  // the bot shows up in the list, and survives a reload (session persisted)
  await page.reload();
  await page.getByRole("link", { name: "All bots" }).click();
  await expect(page.getByRole("link", { name: /Coffee Helper/ })).toBeVisible();
});

test("the embed snippet works on a customer's own website", async ({ page, request }) => {
  // set up a bot through the API (the dashboard flow is covered above)
  const owner = newOwner();
  const reg = await request.post(`${GATEWAY}/api/auth/register-tenant`, {
    data: { tenantName: owner.business, email: owner.email, password: owner.password },
  });
  const { token } = await reg.json();
  const auth = { Authorization: `Bearer ${token}` };
  const bot = await (await request.post(`${GATEWAY}/api/bots`, {
    headers: auth, data: { name: "Shop Assistant", welcomeMessage: "Welcome to the shop!" },
  })).json();
  const doc = await (await request.post(`${GATEWAY}/api/bots/${bot.id}/documents`, {
    headers: auth, multipart: { file: { name: "faq.txt", mimeType: "text/plain", buffer: Buffer.from(FAQ) } },
  })).json();
  await expect.poll(async () => (await (await request.get(`${GATEWAY}/api/bots/${bot.id}/documents/${doc.id}`,
    { headers: auth })).json()).status, { timeout: 90_000 }).toBe("Ready");

  // a page on a completely different origin that only contains the snippet
  // (127.0.0.1 is a different origin than localhost:5000; a real deployment serves both over https)
  const html = `<!doctype html><html><head><style>button { background: red !important; }</style></head>
     <body><h1>Customer shop</h1>
     <script src="${GATEWAY}/widget.js" data-bot-key="${bot.publicKey}" data-color="#0f766e" async></script>
     </body></html>`;
  const shop = createServer((_, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(html));
  await new Promise<void>((resolve) => shop.listen(0, "127.0.0.1", resolve));
  try {
    await runCustomerSite(page, `http://127.0.0.1:${(shop.address() as AddressInfo).port}/`);
  } finally {
    shop.close();
  }
});

async function runCustomerSite(page: Page, url: string) {
  await page.goto(url);

  const widget = page.locator("[data-kahiye]");
  await widget.getByRole("button", { name: "Open chat" }).click();
  await expect(widget.locator(".title")).toHaveText("Shop Assistant");
  await expect(widget.locator(".msg.bot").first()).toHaveText("Welcome to the shop!");

  // the host page's CSS does not leak into the widget (shadow DOM)
  const launcherBg = await widget.locator(".launcher").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(launcherBg).toBe("rgb(15, 118, 110)");

  expect(await askWidget(page, "What's the loyalty code?")).toContain("MAPLE-913");

  // the conversation survives a page navigation within the session
  await page.reload();
  await widget.getByRole("button", { name: "Open chat" }).click();
  await expect(widget.locator(".msg.user")).toHaveText(["What's the loyalty code?"]);
}

test("auth: protected pages redirect, wrong password shows an error, logout works", async ({ page }) => {
  await page.goto("/bots");
  await expect(page).toHaveURL(/\/login$/);

  const owner = newOwner();
  await register(page, owner);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".alert.error")).toHaveText("Wrong email or password.");

  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/bots$/);
});

test("bot settings, document deletion and bot deletion", async ({ page }) => {
  await register(page, newOwner());
  await page.getByRole("button", { name: "+ New bot" }).click();
  await page.getByLabel("Name").fill("Temp Bot");
  await page.getByRole("button", { name: "Create bot" }).click();
  await expect(page.getByRole("heading", { name: "Temp Bot" })).toBeVisible();

  // rejected file type is reported in the UI, nothing uploaded
  await page.getByLabel("Upload documents").setInputFiles({ name: "x.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.locator(".alert.error")).toContainText("only .pdf, .txt, .md, .docx, .xlsx, .csv files are supported");

  await page.getByLabel("Upload documents").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\nHello") });
  await expect(page.getByText(/Ready · \d+ chunks?/)).toBeVisible({ timeout: 90_000 });

  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete notes.md" }).click();
  await expect(page.locator(".source-name", { hasText: "notes.md" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Bot sections" }).getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("form", { name: "Bot settings" });
  await settings.getByLabel("Name", { exact: true }).fill("Renamed Bot");
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".alert.ok")).toHaveText("Settings saved.");
  await expect(page.getByRole("heading", { name: "Renamed Bot" })).toBeVisible();

  await page.getByRole("button", { name: "Delete bot" }).click();
  await expect(page).toHaveURL(/\/bots$/);
  await expect(page.getByText("You have no bots yet.")).toBeVisible();
});

test("the owner takes over a live chat and the visitor sees the reply on the customer's site", async ({ browser, request }) => {
  const owner = newOwner();
  const reg = await (await request.post(`${GATEWAY}/api/auth/register-tenant`, {
    data: { tenantName: owner.business, email: owner.email, password: owner.password },
  })).json();
  const auth = { Authorization: `Bearer ${reg.token}` };
  const bot = await (await request.post(`${GATEWAY}/api/bots`, { headers: auth, data: { name: "Live Bot", welcomeMessage: "Hello!" } })).json();
  const doc = await (await request.post(`${GATEWAY}/api/bots/${bot.id}/documents`, {
    headers: auth, multipart: { file: { name: "faq.txt", mimeType: "text/plain", buffer: Buffer.from(FAQ) } },
  })).json();
  await expect.poll(async () => (await (await request.get(`${GATEWAY}/api/bots/${bot.id}/documents/${doc.id}`,
    { headers: auth })).json()).status, { timeout: 90_000 }).toBe("Ready");

  // the visitor, on the customer's own website
  const html = `<!doctype html><html><body><h1>Shop</h1>
    <script src="${GATEWAY}/widget.js" data-bot-key="${bot.publicKey}" async></script></body></html>`;
  const shop = createServer((_, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(html));
  await new Promise<void>((resolve) => shop.listen(0, "127.0.0.1", resolve));
  const visitor = await browser.newPage();
  const ownerPage = await browser.newPage();
  try {
    await visitor.goto(`http://127.0.0.1:${(shop.address() as AddressInfo).port}/`);
    expect(await askWidget(visitor, "What is the loyalty code?")).toContain("MAPLE-913");

    // the owner, in the dashboard
    await ownerPage.goto("/login");
    await ownerPage.evaluate((s) => localStorage.setItem("kahiye.session", s),
      JSON.stringify({ token: reg.token, email: owner.email, tenantSlug: reg.tenantSlug, role: "Owner" }));
    await ownerPage.goto(`/bots/${bot.id}#conversations`);
    await ownerPage.locator(".convo-item", { hasText: "What is the loyalty code?" }).click();
    await ownerPage.getByRole("button", { name: "Take over" }).click();
    await expect(ownerPage.getByText("You are replying.")).toBeVisible();
    await ownerPage.getByLabel("Your reply").fill("Hi, this is Priya. Want me to call you?");
    await ownerPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(ownerPage.locator(".bubble.agent")).toContainText("Hi, this is Priya.");

    // the visitor sees the person join and the reply, without reloading
    const widget = visitor.locator("[data-kahiye]");
    await expect(widget.locator(".msg.agent")).toHaveText("Hi, this is Priya. Want me to call you?", { timeout: 30_000 });
    await expect(widget.locator(".status")).toHaveText("Chatting with a person");

    // while the owner handles it, the visitor's message goes to them and the bot stays quiet
    await widget.getByLabel("Message").fill("Yes please, after 6");
    await widget.getByLabel("Message").press("Enter");
    await expect(ownerPage.locator(".bubble.user").last()).toHaveText("Yes please, after 6", { timeout: 15_000 });
    // welcome + the first answer; the "person joined" note and the reply are not bot answers
    await expect(widget.locator(".msg.bot:not(.note):not(.agent)")).toHaveCount(2);
  } finally {
    shop.close();
    await visitor.close();
    await ownerPage.close();
  }
});
