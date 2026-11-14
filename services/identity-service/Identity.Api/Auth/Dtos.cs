namespace Identity.Api.Auth;

public record RegisterTenantRequest(string? TenantName, string? Email, string? Password);
public record LoginRequest(string? Email, string? Password);
public record AuthResponse(string Token, Guid TenantId, string TenantSlug, string Email, string Role);
public record TokenRequest(string? Token);
public record ForgotPasswordRequest(string? Email);
public record ResetPasswordRequest(string? Token, string? Password);
public record DeleteAccountRequest(string? Password);

/// <summary>From the bot service: a visitor left their details (POST /internal/tenants/{id}/lead-alert).</summary>
public record LeadAlertRequest(string? To, Guid BotId, string BotName, string Name, string Phone, string? Email, string? Course,
    string Channel, string? PageUrl, List<LeadAlertTurn>? Transcript);
public record LeadAlertTurn(string Role, string Text);
