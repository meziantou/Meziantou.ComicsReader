using Meziantou.ComicsReader.CatalogServices;
using Microsoft.Extensions.Options;

namespace Meziantou.ComicsReader.Api;

internal sealed class TokenAuthenticationMiddleware(RequestDelegate next, IOptions<CatalogConfiguration> configuration)
{
    private readonly string? _requiredToken = configuration.Value.AuthToken;

    public async Task InvokeAsync(HttpContext context)
    {
        // If no token is configured, skip authentication
        if (string.IsNullOrEmpty(_requiredToken))
        {
            await next(context);
            return;
        }

        // Check if the request is for the API
        if (context.Request.Path.StartsWithSegments("/api", StringComparison.Ordinal))
        {
            // Extract token from Authorization header
            var authHeader = context.Request.Headers.Authorization.FirstOrDefault();
            
            if (authHeader is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Missing Authorization header");
                return;
            }

            // Support both "Bearer <token>" and just "<token>"
            var token = authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                ? authHeader["Bearer ".Length..].Trim()
                : authHeader;

            if (token != _requiredToken)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Invalid token");
                return;
            }
        }

        await next(context);
    }
}
