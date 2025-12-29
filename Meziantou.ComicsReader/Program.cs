// Ideas:
// - compute image size and remove small ones from index (skip dummy pages)
// - Display first image in book collection + progress bar
// - Check index size and optimize it if needed (split reading list and catalog?)

using System.ComponentModel;
using Meziantou.ComicsReader.Api;
using Meziantou.ComicsReader.CatalogServices;
using Meziantou.Framework;

TypeDescriptor.AddAttributes(typeof(FullPath), new TypeConverterAttribute(typeof(FullPathTypeConverter)));

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<CatalogConfiguration>(builder.Configuration.GetSection("Catalog"));
builder.Services.AddSingleton<CatalogService>();
builder.Services.AddSingleton<CatalogIndexerService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<CatalogIndexerService>());

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();
app.UseTokenAuthentication();

// Serve static files from wwwroot
app.UseStaticFiles();

// Map API endpoints
app.MapApiEndpoints();

// Serve the React SPA for all routes (fallback after API endpoints)
app.MapFallbackToFile("/index.html");

app.Run();
