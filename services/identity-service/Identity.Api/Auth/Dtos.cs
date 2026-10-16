namespace Identity.Api.Auth;

public record RegisterTenantRequest(string? TenantName, string? Email, string? Password);
public record LoginRequest(string? Email, string? Password);
public record AuthResponse(string Token, Guid TenantId, string TenantSlug, string Email, string Role);