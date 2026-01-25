using System.Runtime.InteropServices;
using StarWebCNC.Agent.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace StarWebCNC.Agent.Focas;

/// <summary>
/// FOCAS2 연결 관리자
/// </summary>
public class FocasConnection : IDisposable
{
    private readonly ILogger<FocasConnection> _logger;
    private readonly CncConnectionSettings _settings;
    private ushort _handle;
    private bool _isConnected;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public bool IsConnected => _isConnected;
    public ushort Handle => _handle;

    public FocasConnection(
        ILogger<FocasConnection> logger,
        IOptions<AgentSettings> options)
    {
        _logger = logger;
        _settings = options.Value.Cnc;
    }

    /// <summary>
    /// CNC에 연결
    /// </summary>
    public async Task<bool> ConnectAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_isConnected)
            {
                _logger.LogDebug("Already connected to CNC");
                return true;
            }

            for (int retry = 0; retry <= _settings.RetryCount; retry++)
            {
                if (cancellationToken.IsCancellationRequested)
                    return false;

                try
                {
                    _logger.LogInformation(
                        "Connecting to CNC at {IpAddress}:{Port} (attempt {Attempt}/{MaxAttempts})",
                        _settings.IpAddress, _settings.Port, retry + 1, _settings.RetryCount + 1);

                    short ret = Focas1.cnc_allclibhndl3(
                        _settings.IpAddress,
                        (ushort)_settings.Port,
                        _settings.TimeoutSeconds,
                        out _handle);

                    if (ret == Focas1.EW_OK)
                    {
                        _isConnected = true;
                        _logger.LogInformation("Connected to CNC successfully. Handle: {Handle}", _handle);
                        return true;
                    }

                    _logger.LogWarning("Failed to connect to CNC. Error code: {ErrorCode}", ret);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Exception while connecting to CNC");
                }

                if (retry < _settings.RetryCount)
                {
                    _logger.LogInformation("Waiting {Delay} seconds before retry...", _settings.RetryDelaySeconds);
                    await Task.Delay(TimeSpan.FromSeconds(_settings.RetryDelaySeconds), cancellationToken);
                }
            }

            _logger.LogError("Failed to connect to CNC after {MaxAttempts} attempts", _settings.RetryCount + 1);
            return false;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// CNC 연결 해제
    /// </summary>
    public void Disconnect()
    {
        _lock.Wait();
        try
        {
            if (!_isConnected)
                return;

            try
            {
                Focas1.cnc_freelibhndl(_handle);
                _logger.LogInformation("Disconnected from CNC. Handle: {Handle}", _handle);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception while disconnecting from CNC");
            }
            finally
            {
                _isConnected = false;
                _handle = 0;
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// 연결 상태 확인 및 재연결
    /// </summary>
    public async Task<bool> EnsureConnectedAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
        {
            // 연결 상태 확인 (간단한 API 호출로 체크)
            try
            {
                var statInfo = new Focas1.ODBST();
                short ret = Focas1.cnc_statinfo(_handle, statInfo);
                if (ret == Focas1.EW_OK)
                    return true;
            }
            catch
            {
                // 연결 끊김
            }

            _isConnected = false;
            _logger.LogWarning("CNC connection lost. Attempting to reconnect...");
        }

        return await ConnectAsync(cancellationToken);
    }

    /// <summary>
    /// FOCAS API 호출 래퍼 (에러 핸들링 포함)
    /// </summary>
    public T? Execute<T>(Func<ushort, T> action, string operationName) where T : class
    {
        if (!_isConnected)
        {
            _logger.LogWarning("Cannot execute {Operation}: Not connected to CNC", operationName);
            return null;
        }

        try
        {
            return action(_handle);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing {Operation}", operationName);
            return null;
        }
    }

    /// <summary>
    /// FOCAS API 호출 래퍼 (반환값 없음)
    /// </summary>
    public bool Execute(Func<ushort, short> action, string operationName)
    {
        if (!_isConnected)
        {
            _logger.LogWarning("Cannot execute {Operation}: Not connected to CNC", operationName);
            return false;
        }

        try
        {
            short ret = action(_handle);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("{Operation} failed with error code: {ErrorCode}", operationName, ret);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing {Operation}", operationName);
            return false;
        }
    }

    public void Dispose()
    {
        Disconnect();
        _lock.Dispose();
    }
}
