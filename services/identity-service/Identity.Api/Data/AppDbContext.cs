using Microsoft.EntityFrameworkCore;

namespace Identity.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("identity");

        b.Entity<Tenant>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Slug).HasMaxLength(100).IsRequired();
            e.HasIndex(x => x.Slug).IsUnique();
        });

        b.Entity<User>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Email).HasMaxLength(256).IsRequired();
            e.Property(x => x.Role).HasMaxLength(30).IsRequired();
            e.HasIndex(x => x.Email).IsUnique();
            e.HasOne(x => x.Tenant).WithMany(t => t.Users).HasForeignKey(x => x.TenantId);
        });
    }
}