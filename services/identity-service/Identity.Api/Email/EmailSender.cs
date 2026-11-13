using System.Net;
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
    /// <summary>Sender, e.g. "BotForge &lt;hello@yourdomain.com&gt;".</summary>
    public string From { get; set; } = "BotForge <no-reply@botforge.local>";
    public SmtpOptions Smtp { get; set; } = new();
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
        <!doctype html><html><body style="margin:0;background:#f7f2ea;font-family:Segoe UI,Arial,sans-serif;color:#1c1714">
        <div style="max-width:520px;margin:0 auto;padding:28px 18px">
          <div style="font-weight:800;font-size:18px;margin-bottom:18px">Bot<span style="color:#c8461f">Forge</span></div>
          <div style="background:#fffdf9;border:1px solid #e6dccd;border-radius:14px;padding:26px">
            <h1 style="font-size:20px;margin:0 0 14px">{E(title)}</h1>
            {bodyHtml}
          </div>
          <p style="color:#6b6159;font-size:12px;margin-top:16px">You received this email because of your BotForge account.</p>
        </div></body></html>
        """;

    private static string Button(string url, string label) =>
        $"""<p style="margin:22px 0"><a href="{E(url)}" style="background:#c8461f;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">{E(label)}</a></p>""";

    public static EmailMessage Verify(string to, string url) => new(to, "Confirm your email for BotForge",
        $"Welcome to BotForge!\n\nConfirm your email address by opening this link (valid for 24 hours):\n{url}\n\nIf you did not sign up, ignore this email.",
        Layout("Confirm your email", $"""
            <p>Welcome to BotForge! Please confirm that this is your email address, so we can send you password resets and your monthly report.</p>
            {Button(url, "Confirm email")}
            <p style="color:#6b6159;font-size:13px">The link is valid for 24 hours. If you did not sign up, you can ignore this email.</p>
            """));

    public static EmailMessage Reset(string to, string url) => new(to, "Reset your BotForge password",
        $"Someone asked to reset the password of your BotForge account.\n\nChoose a new password here (valid for 1 hour):\n{url}\n\nIf it was not you, ignore this email; your password stays the same.",
        Layout("Reset your password", $"""
            <p>Someone asked to reset the password of your BotForge account.</p>
            {Button(url, "Choose a new password")}
            <p style="color:#6b6159;font-size:13px">The link is valid for 1 hour. If it was not you, ignore this email; your password stays the same.</p>
            """));

    public record ReportNumbers(string Business, string Month, string Plan, int Answers, int Conversations, int Leads, int Unanswered);

    public static EmailMessage MonthlyReport(string to, ReportNumbers n, string dashboardUrl)
    {
        var tip = n.Unanswered > 0
            ? $"{n.Unanswered} question{(n.Unanswered == 1 ? " was" : "s were")} not covered by your documents. Open Conversations in the dashboard to see them, then upload the missing information."
            : n.Conversations == 0
                ? "No visitor chatted with your assistant this month. Check that the snippet is on your website, and share your website link with customers."
                : "Every question was answered from your documents. Keep them up to date when prices or timings change.";
        var rows = string.Join("", new[] { ("Conversations", n.Conversations), ("Answers", n.Answers), ("New leads", n.Leads), ("Unanswered questions", n.Unanswered) }
            .Select(r => $"""<tr><td style="padding:8px 0;color:#6b6159">{r.Item1}</td><td style="padding:8px 0;text-align:right;font-weight:800;font-size:18px">{r.Item2}</td></tr>"""));
        return new EmailMessage(to, $"Your BotForge report for {n.Month}",
            $"BotForge report for {n.Business}, {n.Month}\n\nConversations: {n.Conversations}\nAnswers: {n.Answers}\nNew leads: {n.Leads}\nUnanswered questions: {n.Unanswered}\nPlan: {n.Plan}\n\n{tip}\n\nDashboard: {dashboardUrl}",
            Layout($"{n.Month} at {n.Business}", $"""
                <table style="width:100%;border-collapse:collapse;border-top:1px solid #e6dccd">{rows}</table>
                <p style="margin-top:16px">{E(tip)}</p>
                {Button(dashboardUrl, "Open dashboard")}
                <p style="color:#6b6159;font-size:13px">Plan: {E(n.Plan)}</p>
                """));
    }
}
