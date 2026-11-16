using System.Net;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Text.Encodings.Web;
using Microsoft.Extensions.Options;

namespace Identity.Api.Email;

public record EmailMessage(string To, string Subject, string Text, string Html);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public class EmailOptions
{
    /// <summary>Sender, e.g. "Kahiye &lt;hello@yourdomain.com&gt;".</summary>
    public string From { get; set; } = "Kahiye <no-reply@kahiye.local>";
    public SmtpOptions Smtp { get; set; } = new();
    public BrevoOptions Brevo { get; set; } = new();
}

public class BrevoOptions
{
    /// <summary>Brevo API key (free plan: 300 emails a day). Sends over HTTPS, for hosts that block SMTP ports (Render free).</summary>
    public string? ApiKey { get; set; }
    public string BaseUrl { get; set; } = "https://api.brevo.com";
}

public class SmtpOptions
{
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? User { get; set; }
    public string? Password { get; set; }
    /// <summary>STARTTLS on 587 (Gmail, Brevo, Resend, Zoho). Only disable for a local test server.</summary>
    public bool EnableSsl { get; set; } = true;
}

/// <summary>Sends through any SMTP account (Gmail app password, Brevo, Resend, Zoho...).</summary>
public class SmtpEmailSender(IOptions<EmailOptions> options) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        using var mail = new MailMessage { From = new MailAddress(o.From), Subject = message.Subject, Body = message.Text };
        mail.To.Add(message.To);
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.Html, null, "text/html"));
        using var client = new SmtpClient(o.Smtp.Host, o.Smtp.Port)
        {
            EnableSsl = o.Smtp.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Credentials = string.IsNullOrEmpty(o.Smtp.User) ? null : new NetworkCredential(o.Smtp.User, o.Smtp.Password),
            Timeout = 20_000
        };
        await client.SendMailAsync(mail, ct);
    }
}

/// <summary>Sends through Brevo's HTTPS API. The From address must be a sender verified in Brevo.</summary>
public class BrevoEmailSender(HttpClient http, IOptions<EmailOptions> options) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        var from = new MailAddress(o.From);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{o.Brevo.BaseUrl.TrimEnd('/')}/v3/smtp/email")
        {
            Content = JsonContent.Create(new
            {
                sender = new { name = string.IsNullOrWhiteSpace(from.DisplayName) ? "Kahiye" : from.DisplayName, email = from.Address },
                to = new[] { new { email = message.To } },
                subject = message.Subject,
                htmlContent = message.Html,
                textContent = message.Text
            })
        };
        request.Headers.Add("api-key", o.Brevo.ApiKey);
        request.Headers.Add("Accept", "application/json");
        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Brevo refused the email ({(int)response.StatusCode}): {body[..Math.Min(body.Length, 300)]}");
        }
    }
}

/// <summary>Used when no SMTP server is configured: the email (with its link) goes to the log instead.</summary>
public class LogEmailSender(ILogger<LogEmailSender> log) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        log.LogWarning("Email not sent (no SMTP configured). To: {To} | Subject: {Subject}\n{Text}", message.To, message.Subject, message.Text);
        return Task.CompletedTask;
    }
}

/// <summary>Plain, mobile-friendly emails with a text version.</summary>
public static class EmailTemplates
{
    private static string E(string s) => HtmlEncoder.Default.Encode(s);

    private static string Layout(string title, string bodyHtml) => $"""
        <!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0b1020">
        <div style="max-width:520px;margin:0 auto;padding:28px 18px">
          <div style="font-weight:800;font-size:19px;margin-bottom:18px;letter-spacing:-.02em">Kah<span style="color:#0d9488">iye</span></div>
          <div style="background:#ffffff;border:1px solid #e3e6f0;border-radius:14px;padding:26px">
            <h1 style="font-size:20px;margin:0 0 14px">{E(title)}</h1>
            {bodyHtml}
          </div>
          <p style="color:#5b6478;font-size:12px;margin-top:16px">You received this email because of your Kahiye account.</p>
        </div></body></html>
        """;

    private static string Button(string url, string label) =>
        $"""<p style="margin:22px 0"><a href="{E(url)}" style="background:#0d9488;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">{E(label)}</a></p>""";

    public static EmailMessage Verify(string to, string url) => new(to, "Confirm your email for Kahiye",
        $"Welcome to Kahiye!\n\nConfirm your email address by opening this link (valid for 24 hours):\n{url}\n\nIf you did not sign up, ignore this email.",
        Layout("Confirm your email", $"""
            <p>Welcome to Kahiye! Please confirm that this is your email address, so we can send you password resets and your monthly report.</p>
            {Button(url, "Confirm email")}
            <p style="color:#5b6478;font-size:13px">The link is valid for 24 hours. If you did not sign up, you can ignore this email.</p>
            """));

    public static EmailMessage Reset(string to, string url) => new(to, "Reset your Kahiye password",
        $"Someone asked to reset the password of your Kahiye account.\n\nChoose a new password here (valid for 1 hour):\n{url}\n\nIf it was not you, ignore this email; your password stays the same.",
        Layout("Reset your password", $"""
            <p>Someone asked to reset the password of your Kahiye account.</p>
            {Button(url, "Choose a new password")}
            <p style="color:#5b6478;font-size:13px">The link is valid for 1 hour. If it was not you, ignore this email; your password stays the same.</p>
            """));

    private static readonly Dictionary<string, string> ChannelNames = new()
    {
        ["web"] = "your website", ["whatsapp"] = "WhatsApp", ["instagram"] = "Instagram",
        ["messenger"] = "Messenger", ["telegram"] = "Telegram",
    };

    /// <summary>"New lead" alert for the owner, with one-tap call and WhatsApp links and the chat that led to it.</summary>
    public static EmailMessage LeadAlert(string to, Identity.Api.Auth.LeadAlertRequest l, string leadsUrl)
    {
        var digits = new string(l.Phone.Where(char.IsDigit).ToArray());
        // WhatsApp links need the country code: a 10-digit number without one is an Indian mobile
        var whatsapp = !l.Phone.TrimStart().StartsWith('+') && digits.Length == 10 ? "91" + digits : digits;
        var tel = (l.Phone.TrimStart().StartsWith('+') ? "+" : "") + digits;   // only digits and +: safe in a link as is
        var source = ChannelNames.GetValueOrDefault(l.Channel, l.Channel);
        var details = new List<(string Label, string Value)> { ("Name", l.Name), ("Phone", l.Phone) };
        if (!string.IsNullOrWhiteSpace(l.Email)) details.Add(("Email", l.Email!));
        if (!string.IsNullOrWhiteSpace(l.Course)) details.Add(("Interested in", l.Course!));
        details.Add(("Came from", source));
        if (!string.IsNullOrWhiteSpace(l.PageUrl)) details.Add(("Page", l.PageUrl!));
        var turns = (l.Transcript ?? []).TakeLast(8).ToList();

        var text = $"New enquiry for {l.BotName}\n\n" + string.Join("\n", details.Select(d => $"{d.Label}: {d.Value}")) +
                   (turns.Count > 0 ? "\n\nThe chat:\n" + string.Join("\n", turns.Select(t => $"{(t.Role == "user" ? "Visitor" : "Bot")}: {t.Text}")) : "") +
                   $"\n\nCall back soon: people who get a call within an hour are far more likely to join.\nAll leads: {leadsUrl}";

        var rows = string.Join("", details.Select(d =>
            $"""<tr><td style="padding:6px 0;color:#5b6478;width:120px;vertical-align:top">{E(d.Label)}</td><td style="padding:6px 0;font-weight:700">{E(d.Value)}</td></tr>"""));
        var chat = turns.Count == 0 ? "" : $"""
            <div style="margin-top:18px;border-top:1px solid #e3e6f0;padding-top:14px">
              <div style="color:#5b6478;font-size:13px;margin-bottom:8px">The chat</div>
              {string.Join("", turns.Select(t => t.Role == "user"
                  ? $"""<p style="margin:6px 0 6px 40px;background:#d5f5f0;border-radius:12px;padding:8px 12px;font-size:14px">{E(t.Text)}</p>"""
                  : $"""<p style="margin:6px 40px 6px 0;background:#eef0f7;border-radius:12px;padding:8px 12px;font-size:14px">{E(t.Text)}</p>"""))}
            </div>
            """;
        var actions = $"""
            <p style="margin:20px 0 6px">
              <a href="tel:{tel}" style="background:#0d9488;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px;display:inline-block;margin:0 6px 8px 0">Call {E(l.Name)}</a>
              <a href="https://wa.me/{whatsapp}" style="background:#1e7a3c;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px;display:inline-block;margin:0 6px 8px 0">WhatsApp</a>
              <a href="{E(leadsUrl)}" style="color:#0d9488;font-weight:700;padding:11px 4px;display:inline-block">All leads →</a>
            </p>
            """;
        return new EmailMessage(to, $"New lead: {l.Name} · {l.Phone} ({l.BotName})", text,
            Layout($"New enquiry for {l.BotName}", $"""
                <table style="width:100%;border-collapse:collapse">{rows}</table>
                {actions}
                <p style="color:#5b6478;font-size:13px">Call back soon: people who get a call within an hour are far more likely to join.</p>
                {chat}
                """));
    }

    public record ReportNumbers(string Business, string Month, string Plan, int Answers, int Conversations, int Leads, int Unanswered);

    public static EmailMessage MonthlyReport(string to, ReportNumbers n, string dashboardUrl)
    {
        var tip = n.Unanswered > 0
            ? $"{n.Unanswered} question{(n.Unanswered == 1 ? " was" : "s were")} not covered by your documents. Open Conversations in the dashboard to see them, then upload the missing information."
            : n.Conversations == 0
                ? "No visitor chatted with your assistant this month. Check that the snippet is on your website, and share your website link with customers."
                : "Every question was answered from your documents. Keep them up to date when prices or timings change.";
        var rows = string.Join("", new[] { ("Conversations", n.Conversations), ("Answers", n.Answers), ("New leads", n.Leads), ("Unanswered questions", n.Unanswered) }
            .Select(r => $"""<tr><td style="padding:8px 0;color:#5b6478">{r.Item1}</td><td style="padding:8px 0;text-align:right;font-weight:800;font-size:18px">{r.Item2}</td></tr>"""));
        return new EmailMessage(to, $"Your Kahiye report for {n.Month}",
            $"Kahiye report for {n.Business}, {n.Month}\n\nConversations: {n.Conversations}\nAnswers: {n.Answers}\nNew leads: {n.Leads}\nUnanswered questions: {n.Unanswered}\nPlan: {n.Plan}\n\n{tip}\n\nDashboard: {dashboardUrl}",
            Layout($"{n.Month} at {n.Business}", $"""
                <table style="width:100%;border-collapse:collapse;border-top:1px solid #e3e6f0">{rows}</table>
                <p style="margin-top:16px">{E(tip)}</p>
                {Button(dashboardUrl, "Open dashboard")}
                <p style="color:#5b6478;font-size:13px">Plan: {E(n.Plan)}</p>
                """));
    }
}
