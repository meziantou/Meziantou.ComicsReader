using System.Runtime.ExceptionServices;

namespace Meziantou.ComicsReader.CatalogServices;

internal static class RetryHelper
{
    public static void Execute(Action action, int retryCount, Func<int, TimeSpan>? delayProvider = null)
    {
        ArgumentNullException.ThrowIfNull(action);

        ExceptionDispatchInfo? exception = null;
        for (var retryAttempt = 0; retryAttempt <= retryCount; retryAttempt++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception ex) when (retryAttempt < retryCount)
            {
                exception = ExceptionDispatchInfo.Capture(ex);

                var delay = delayProvider?.Invoke(retryAttempt + 1) ?? TimeSpan.Zero;
                if (delay > TimeSpan.Zero)
                {
                    Thread.Sleep(delay);
                }
            }
        }

        exception?.Throw();
        throw new InvalidOperationException("Retry execution failed without an exception");
    }

    public static async Task<T> ExecuteAsync<T>(Func<Task<T>> action, int retryCount, Func<int, TimeSpan>? delayProvider = null)
    {
        ArgumentNullException.ThrowIfNull(action);

        ExceptionDispatchInfo? exception = null;
        for (var retryAttempt = 0; retryAttempt <= retryCount; retryAttempt++)
        {
            try
            {
                return await action();
            }
            catch (Exception ex) when (retryAttempt < retryCount)
            {
                exception = ExceptionDispatchInfo.Capture(ex);

                var delay = delayProvider?.Invoke(retryAttempt + 1) ?? TimeSpan.Zero;
                if (delay > TimeSpan.Zero)
                {
                    await Task.Delay(delay);
                }
            }
        }

        exception?.Throw();
        throw new InvalidOperationException("Retry execution failed without an exception");
    }
}
