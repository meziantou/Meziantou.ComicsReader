namespace Meziantou.ComicsReader.Api;

internal static class TokenAuthenticationMiddlewareExtensions
{
    public static IApplicationBuilder UseTokenAuthentication(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<TokenAuthenticationMiddleware>();
    }
}
