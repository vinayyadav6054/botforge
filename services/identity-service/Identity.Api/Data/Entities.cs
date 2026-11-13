namespace Identity.Api.Data;

public class Tenant
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = default!;
    public string Slug { get; set; } = default!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<User> Users { get; set; } = new();
}

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = default!;
    public string Email { get; set; } = default!;
    public string PasswordHash { get; set; } = default!;
    public string Role { get; set; } = "Owner";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EmailVerifiedAt { get; set; }
}

/// <summary>One-time link token (email verification, password reset). Only its SHA-256 hash is stored.</summary>
public class UserToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Purpose { get; set; } = default!;
    public string TokenHash { get; set; } = default!;
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Monthly report already sent to a business for a period ("2026-10").</summary>
public class ReportLog
{
    public Guid TenantId { get; set; }
    public string Period { get; set; } = default!;
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
}