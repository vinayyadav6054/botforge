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
}