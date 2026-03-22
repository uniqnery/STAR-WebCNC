using System.Runtime.InteropServices;
using StarWebCNC.Agent.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace StarWebCNC.Agent.Focas;

/// <summary>
/// FOCAS2 Ethernet DLL 사전 로드 및 DLL 검색 경로 설정
/// </summary>
internal static class FocasDllPreloader
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibraryW(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetDllDirectoryW(string lpPathName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetLastError();

    private static bool _loaded = false;

    public static void EnsureLoaded()
    {
        if (_loaded) return;
        var dir = AppContext.BaseDirectory.TrimEnd('\\', '/');

        // DLL 검색 경로를 publish 디렉토리로 설정
        bool dirSet = SetDllDirectoryW(dir);
        Console.Error.WriteLine($"[FocasDllPreloader] BaseDirectory: {dir}");
        Console.Error.WriteLine($"[FocasDllPreloader] SetDllDirectory: {dirSet} (err={GetLastError()})");

        // fwlibe64.dll (Ethernet TCP/IP) 사전 로드만 — 모델 DLL은 cnc_allclibhndl3이 자동 로드
        // 모델 DLL을 미리 로드하면 핸드셰이크 후 EW_HANDLE(-8) 발생하므로 절대 금지
        var ethDll = Path.Combine(dir, "fwlibe64.dll");
        if (!File.Exists(ethDll)) ethDll = Path.Combine(dir, "Fwlibe64.dll");
        if (File.Exists(ethDll))
        {
            var h2 = LoadLibraryW(ethDll);
            Console.Error.WriteLine($"[FocasDllPreloader] Load fwlibe64.dll: handle=0x{h2:X} (err={GetLastError()})");
        }
        else Console.Error.WriteLine($"[FocasDllPreloader] fwlibe64.dll NOT FOUND in {dir}");

        _loaded = true;
    }
}

/// <summary>
/// cnc_allclibhndl3 명시적 P/Invoke (UnmanagedType.AsAny 마샬링 문제 우회)
/// fwlib64.cs의 AsAny는 .NET 8에서 IP 문자열을 잘못 전달할 수 있음
/// </summary>
internal static class FocasConnect3
{
    [DllImport("FWLIB64.dll", EntryPoint = "cnc_allclibhndl3", CharSet = CharSet.Ansi, BestFitMapping = false)]
    public static extern short Connect(
        [MarshalAs(UnmanagedType.LPStr)] string ip,
        ushort port,
        int timeout,
        out ushort handle);
}

/// <summary>
/// FOCAS2 연결 관리자
/// </summary>
public class FocasConnection : IDisposable
{
    private readonly ILogger<FocasConnection> _logger;
    private readonly CncConnectionSettings _settings;
    private ushort _handle;
    private bool _isConnected;
    private readonly SemaphoreSlim _lock = new(1, 1);     // 연결/해제 보호
    private readonly SemaphoreSlim _apiLock = new(1, 1);  // FOCAS API 직렬화 (비-스레드안전)

    public bool IsConnected => _isConnected;
    public ushort Handle => _handle;

    /// <summary>
    /// FOCAS API 직렬화 락 — FocasDataReader에서 모든 Focas1.xxx() 호출 시 사용
    /// </summary>
    public SemaphoreSlim ApiLock => _apiLock;

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

            FocasDllPreloader.EnsureLoaded();

            for (int retry = 0; retry <= _settings.RetryCount; retry++)
            {
                if (cancellationToken.IsCancellationRequested)
                    return false;

                try
                {
                    _logger.LogInformation(
                        "Connecting to CNC at {IpAddress}:{Port} (attempt {Attempt}/{MaxAttempts})",
                        _settings.IpAddress, _settings.Port, retry + 1, _settings.RetryCount + 1);

                    // UnmanagedType.AsAny 마샬링 문제 우회 — 명시적 LPStr P/Invoke 사용
                    short ret = FocasConnect3.Connect(
                        _settings.IpAddress,
                        (ushort)_settings.Port,
                        _settings.TimeoutSeconds,
                        out _handle);

                    if (ret == Focas1.EW_OK)
                    {
                        // ── 핸들 안정화 대기 (Thread.Sleep — 스레드 전환 없음) ────────
                        // FOCAS2 Ethernet: cnc_allclibhndl3 이후 모델 DLL을 내부 스레드에서
                        // 비동기 로드. 로드 완료 시 핸들 리셋 발생 → EW_HANDLE(-8).
                        // await Task.Delay()는 스레드를 바꾸므로 Thread.Sleep으로 동일
                        // 스레드에서 폴링하여 핸들 안정화를 대기.
                        // ────────────────────────────────────────────────────────────────
                        // ── CNC 핸들 안정화 대기 ────────────────────────────────────
                        // 1단계: cnc_statinfo 성공 대기 (CNC 함수 준비)
                        // 2단계: pmc_rdpmcrng 성공 대기 (PMC 함수 준비)
                        // PMC 함수는 CNC 함수보다 늦게 준비되는 경우가 있음 (fwlibe64.dll 내부 초기화)
                        // ─────────────────────────────────────────────────────────────
                        bool stable = false;
                        var deadline = DateTime.UtcNow.AddSeconds(15);

                        // 1단계: CNC 준비
                        while (DateTime.UtcNow < deadline)
                        {
                            if (cancellationToken.IsCancellationRequested) break;
                            System.Threading.Thread.Sleep(300);
                            var s = new Focas1.ODBST();
                            short r = Focas1.cnc_statinfo(_handle, s);
                            if (r == Focas1.EW_OK) { stable = true; break; }
                        }

                        if (!stable)
                        {
                            _logger.LogWarning("CNC handle never stabilized after connect");
                            try { Focas1.cnc_freelibhndl(_handle); } catch { }
                            continue;
                        }

                        // 2단계: PMC 준비 (R6000 1바이트 읽기로 확인)
                        // PMC 함수는 CNC 함수보다 늦게 준비될 수 있음 — 실패해도 연결 유지
                        {
                            bool pmcReady = false;
                            deadline = DateTime.UtcNow.AddSeconds(10);
                            while (DateTime.UtcNow < deadline)
                            {
                                if (cancellationToken.IsCancellationRequested) break;
                                System.Threading.Thread.Sleep(300);
                                var pmcTest = new Focas1.IODBPMC0();
                                short rp = Focas1.pmc_rdpmcrng(_handle, 5 /*R*/, 0, 6000, 6000, (ushort)(8 + 1), pmcTest);
                                if (rp == Focas1.EW_OK) { pmcReady = true; break; }
                                _logger.LogDebug("Waiting for PMC ready: ret={Ret}", rp);
                            }
                            if (pmcReady)
                                _logger.LogInformation("CNC and PMC both ready.");
                            else
                                _logger.LogWarning("PMC not ready after 10s — proceeding without PMC confirmation.");
                        }

                        var sysinfo = new Focas1.ODBSYS();
                        Focas1.cnc_sysinfo(_handle, sysinfo);
                        _logger.LogInformation(
                            "CNC model: series={Series} version={Version} mt_type={MtType}",
                            new string(sysinfo.series).TrimEnd('\0'),
                            new string(sysinfo.version).TrimEnd('\0'),
                            new string(sysinfo.mt_type).TrimEnd('\0'));

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
    /// _isConnected 플래그를 신뢰함 — 실제 FOCAS API 오류 발생 시 NotifyFocasError()로 상태 갱신
    /// </summary>
    public async Task<bool> EnsureConnectedAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
            return true;

        return await ConnectAsync(cancellationToken);
    }

    /// <summary>
    /// FOCAS API 오류 코드를 받아 연결 끊김 여부를 판단하고 상태 업데이트
    /// </summary>
    public void NotifyFocasError(short errorCode)
    {
        if (errorCode == (short)Focas1.focas_ret.EW_SOCKET || errorCode == (short)Focas1.focas_ret.EW_HANDLE)
        {
            _logger.LogWarning("FOCAS API returned connection error {Code}. Marking disconnected.", errorCode);
            try { Focas1.cnc_freelibhndl(_handle); } catch { }
            _isConnected = false;
            _handle = 0;
        }
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
