using Bots.Api.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api.Data;

public class AppDbContext : DbContext
{
    private readonly ITenantContext _tenant;

    public AppDbContext(DbContextOptions<AppDbContext> options, ITenantContext tenant) : base(options)
    {
        _tenant = tenant;
    }

    // EF reads this property for the global query filters, once per query
    private Guid CurrentTenantId => _tenant.TenantId;

    public DbSet<Bot> Bots => Set<Bot>();
    public DbSet<BotDocument> Documents => Set<BotDocument>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("bots");

        b.Entity<Bot>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.WelcomeMessage).HasMaxLength(500).IsRequired();
            e.Property(x => x.PublicKey).HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.PublicKey).IsUnique();
            e.HasIndex(x => x.TenantId);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });

        b.Entity<BotDocument>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.FileName).HasMaxLength(300).IsRequired();
            e.Property(x => x.ContentType).HasMaxLength(150).IsRequired();
            e.Property(x => x.StorageKey).HasMaxLength(500).IsRequired();
            e.Property(x => x.Status).HasMaxLength(30).IsRequired();
            e.HasIndex(x => new { x.TenantId, x.BotId });
            e.HasOne<Bot>().WithMany().HasForeignKey(x => x.BotId).OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
    }
}