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
    public DbSet<Lead> Leads => Set<Lead>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<UsageCounter> Usage => Set<UsageCounter>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMessage> ConversationMessages => Set<ConversationMessage>();

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
            e.Property(x => x.LeadPrompt).HasMaxLength(300).IsRequired();
            e.Property(x => x.SuggestedQuestions).IsRequired();
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
            e.Property(x => x.Error).HasMaxLength(500);
        });

        b.Entity<Lead>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(20).IsRequired();
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.Course).HasMaxLength(150);
            e.Property(x => x.PageUrl).HasMaxLength(500);
            e.Property(x => x.Transcript).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.HasIndex(x => new { x.TenantId, x.BotId, x.CreatedAt });
            e.HasIndex(x => new { x.BotId, x.Phone, x.CreatedAt });   // duplicate check
            e.HasOne<Bot>().WithMany().HasForeignKey(x => x.BotId).OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });

        // subscriptions and usage are always looked up by an explicit tenant id (also from internal calls)
        b.Entity<Subscription>(e =>
        {
            e.HasKey(x => x.TenantId);
            e.Property(x => x.Plan).HasMaxLength(20).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.Provider).HasMaxLength(20);
            e.Property(x => x.ProviderSubscriptionId).HasMaxLength(100);
            e.HasIndex(x => x.ProviderSubscriptionId);
        });

        b.Entity<UsageCounter>(e =>
        {
            e.ToTable("usage_counters");
            e.HasKey(x => new { x.TenantId, x.Period });
            e.Property(x => x.Period).HasMaxLength(7);
        });

        b.Entity<Conversation>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.PageUrl).HasMaxLength(500);
            e.HasIndex(x => new { x.TenantId, x.BotId, x.LastMessageAt });
            e.HasIndex(x => x.LastMessageAt);
            e.HasOne<Bot>().WithMany().HasForeignKey(x => x.BotId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Messages).WithOne().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });

        b.Entity<ConversationMessage>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Role).HasMaxLength(20).IsRequired();
            e.Property(x => x.Text).IsRequired();
            e.HasIndex(x => new { x.ConversationId, x.CreatedAt });
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
    }
}