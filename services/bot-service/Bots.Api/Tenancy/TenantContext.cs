namespace Bots.Api.Tenancy;

public interface ITenantContext
{
    Guid TenantId { get; }
}

public class TenantContext(IHttpContextAccessor accessor) : ITenantContext
{
    public Guid TenantId =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirst("tenant_id")?.Value, out var id)
            ? id
            : Guid.Empty;
}