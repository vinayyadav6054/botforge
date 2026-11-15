using Microsoft.EntityFrameworkCore;

namespace Bots.Api.Data;

/// <summary>
/// Once at startup: encrypts leads saved before field encryption existed, and gives them their phone fingerprint.
/// Safe to run any number of times (already encrypted rows are skipped).
/// </summary>
public class LeadEncryptionBackfill(IServiceScopeFactory scopes, ILogger<LeadEncryptionBackfill> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var total = 0;
            while (!stoppingToken.IsCancellationRequested)
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var batch = await db.Leads.IgnoreQueryFilters().Where(l => l.PhoneHash == null).Take(200).ToListAsync(stoppingToken);
                if (batch.Count == 0) break;
                foreach (var lead in batch)
                {
                    lead.PhoneHash = Pii.Lookup(lead.Phone);
                    // re-save the personal fields so the converter writes them encrypted
                    var entry = db.Entry(lead);
                    foreach (var p in new[] { nameof(Lead.Name), nameof(Lead.Phone), nameof(Lead.Email), nameof(Lead.Transcript) })
                        entry.Property(p).IsModified = true;
                }
                await db.SaveChangesAsync(stoppingToken);
                total += batch.Count;
            }
            if (total > 0) log.LogInformation("Encrypted {Count} older leads", total);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Lead encryption backfill failed: {Reason}", ex.Message);
        }
    }
}
