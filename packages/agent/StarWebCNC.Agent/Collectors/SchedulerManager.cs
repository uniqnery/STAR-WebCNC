using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Focas;
using StarWebCNC.Agent.Mqtt;
using StarWebCNC.Agent.Template;

namespace StarWebCNC.Agent.Collectors;

/// <summary>
/// Scheduler 상태 머신 (FOCAS 전용 스레드에서 실행)
/// SCHEDULER_DESIGN.md Section 7/8 구현
/// </summary>
public class SchedulerManager
{
    private readonly ILogger<SchedulerManager> _logger;
    private readonly AgentSettings _settings;
    private readonly FocasDataReader _dataReader;
    private readonly MqttService _mqttService;
    private readonly TemplateLoader _templateLoader;

    // ── 상태 ────────────────────────────────────────────────────
    private SchedulerRunState _state = SchedulerRunState.IDLE;
    private SchedulerRowInfo? _currentRow;
    private readonly List<SchedulerRowInfo> _rows = new();

    // ── 사이클 내부 플래그 ───────────────────────────────────────
    private bool _skipFirstM20 = false;          // 행 시작 직후 첫 M20 제외
    private bool _pauseRequested = false;        // UI/인터락 원사이클 스톱 대기
    private bool _waitingForPath2OnlyM20 = false; // Path2Only 완료 M20 대기 (카운트 미반영)

    // ── 실행 모드 설정 (START 수신 시 저장) ─────────────────────
    private string _mainMode = "memory";   // Path1 실행 모드: "memory" | "dnc"
    private string _subMode  = "memory";   // Path2 실행 모드: "memory" | "dnc"
    private DncPathsPayload? _dncPaths;    // DNC 경로 설정

    // ── 스케줄러 명령 큐 (MQTT 스레드 → FOCAS 스레드) ─────────
    private readonly Channel<SchedulerMessage> _commandChannel =
        Channel.CreateBounded<SchedulerMessage>(new BoundedChannelOptions(8)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

    public SchedulerRunState State => _state;
    public bool IsRunning => _state != SchedulerRunState.IDLE;

    public SchedulerManager(
        ILogger<SchedulerManager> logger,
        IOptions<AgentSettings> options,
        FocasDataReader dataReader,
        MqttService mqttService,
        TemplateLoader templateLoader)
    {
        _logger = logger;
        _settings = options.Value;
        _dataReader = dataReader;
        _mqttService = mqttService;
        _templateLoader = templateLoader;
    }

    /// <summary>MQTT 스레드에서 호출 — 스케줄러 명령을 큐에 추가</summary>
    public void EnqueueCommand(SchedulerMessage cmd)
    {
        _commandChannel.Writer.TryWrite(cmd);
        _logger.LogInformation("[Scheduler] Command enqueued: {Type}", cmd.Type);
    }

    /// <summary>
    /// FOCAS 전용 스레드에서 100ms마다 호출
    /// 1) 큐에 쌓인 명령 처리
    /// 2) RUNNING 중 인터락 감시
    /// </summary>
    public void Tick(CancellationToken ct)
    {
        // 명령 처리
        while (_commandChannel.Reader.TryRead(out var cmd))
            ProcessCommand(cmd, ct);

        // 인터락 감시 (RUNNING + pause 미요청 시)
        if (_state == SchedulerRunState.RUNNING && !_pauseRequested)
            CheckInterlockWhileRunning();
    }

    /// <summary>
    /// M20 엣지 감지 시 DataCollectorService에서 호출 (FOCAS 스레드)
    /// returns true if the scheduler consumed the M20 event (suppress raw M20_COMPLETE publish)
    /// </summary>
    public bool OnM20Edge(string? programNo)
    {
        if (_state != SchedulerRunState.RUNNING || _currentRow == null)
            return false;

        var cfg = _templateLoader.CurrentTemplate?.SchedulerConfig;
        if (cfg == null) return false;

        // ── 첫 번째 M20 제외 (행 시작 직후) ──
        if (_skipFirstM20)
        {
            _skipFirstM20 = false;
            _logger.LogInformation("[Scheduler] M20: 첫 번째 M20 제외 (행 시작 직후)");

            // 여전히 M20_COMPLETE를 count 없이 보고 (서버 로그용)
            var skipEvt = new EventMessage
            {
                MachineId = _settings.MachineId,
                EventType = "M20_COMPLETE",
                ProgramNo = programNo,
                RowId = _currentRow.Id,
                Count = _currentRow.Count,
            };
            _mqttService.PublishEventAsync(skipEvt).GetAwaiter().GetResult();
            return true;
        }

        // ── Path2Only 완료 M20 — 카운트 미반영, 직접 행 완료 처리 ──
        // CompleteCurrentRow() 호출 시 SubProgramNo 조건으로 ExecutePath2Only 재호출되는 무한루프 방지
        if (_waitingForPath2OnlyM20)
        {
            _waitingForPath2OnlyM20 = false;
            _logger.LogInformation("[Scheduler] M20: Path2Only 완료 M20 수신 — 카운트 미반영, 행 완료");
            var rowId = _currentRow.Id;
            _currentRow.Status = "COMPLETED";
            PublishSchedulerRowCompleted(rowId);
            ExecuteNextPendingRow(CancellationToken.None);
            return true;
        }

        // ── Count 증가 ──
        _currentRow.Count++;
        _logger.LogInformation("[Scheduler] M20: count={Count}/{Preset} rowId={RowId}",
            _currentRow.Count, _currentRow.Preset, _currentRow.Id);

        // ── CNC 변수 동기화 (count 갱신) ──
        WriteSchedulerVar(cfg.CountDisplay.CountVarType, cfg.CountDisplay.CountMacroNo, _currentRow.Count, "count");

        // ── MQTT M20_COMPLETE 보고 (rowId 포함) ──
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = "M20_COMPLETE",
            ProgramNo = programNo,
            RowId = _currentRow.Id,
            Count = _currentRow.Count,
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();

        // ── Pause 요청 완료 → PAUSED ──
        if (_pauseRequested)
        {
            _pauseRequested = false;
            _logger.LogInformation("[Scheduler] PAUSED after M20 (count={Count})", _currentRow.Count);
            SetState(SchedulerRunState.PAUSED);
            PublishSchedulerPaused(_currentRow.Id, null, null);
            return true;
        }

        // ── count == preset - 1 → 원사이클 스톱 ON (마지막 사이클 완료 후 자동 정지 보장) ──
        // M99 선두 복귀형: OCS ON → 기계가 다음 M99에서 자동 정지
        // 이후 M20(= count==preset) 수신 시 행 완료 처리
        if (_currentRow.Count == _currentRow.Preset - 1)
        {
            _logger.LogInformation("[Scheduler] count == preset-1 ({C}) → 원사이클 스톱 ON (마지막 사이클 정지 예약)",
                _currentRow.Count);
            OneCycleStopOn(cfg);
        }

        // ── 목표 수량 달성 → 행 완료 ──
        if (_currentRow.Count >= _currentRow.Preset)
        {
            CompleteCurrentRow(CancellationToken.None);
        }

        // ── count < preset: 기계가 OCS OFF 상태로 M99 후 자동으로 다음 사이클 진행 ──
        // PC는 추가 사이클 스타트를 보내지 않는다.

        return true;
    }

    // ── 명령 처리 ──────────────────────────────────────────────────────────────

    private void ProcessCommand(SchedulerMessage cmd, CancellationToken ct)
    {
        _logger.LogInformation("[Scheduler] ProcessCommand: type={Type} state={State}", cmd.Type, _state);

        switch (cmd.Type?.ToUpper())
        {
            case "START":
                if (_state == SchedulerRunState.IDLE)
                    HandleStart(cmd, ct);
                else
                    _logger.LogWarning("[Scheduler] START ignored: not IDLE (state={State})", _state);
                break;

            case "RESUME":
                if (_state == SchedulerRunState.PAUSED)
                    HandleResume(ct);
                else
                    _logger.LogWarning("[Scheduler] RESUME ignored: not PAUSED (state={State})", _state);
                break;

            case "PAUSE":
                if (_state == SchedulerRunState.RUNNING)
                    HandlePauseRequest();
                else
                    _logger.LogWarning("[Scheduler] PAUSE ignored: not RUNNING (state={State})", _state);
                break;

            case "CANCEL":
                HandleCancel();
                break;
        }
    }

    private void HandleStart(SchedulerMessage cmd, CancellationToken ct)
    {
        // DNC 실행 설정 저장 (행 시작 전 반드시 먼저)
        _mainMode  = string.IsNullOrEmpty(cmd.MainMode) ? "memory" : cmd.MainMode.ToLower();
        _subMode   = string.IsNullOrEmpty(cmd.SubMode)  ? "memory" : cmd.SubMode.ToLower();
        _dncPaths  = cmd.DncPaths;

        _logger.LogInformation("[Scheduler] START: mainMode={Main} subMode={Sub}", _mainMode, _subMode);
        PublishEvent("SCHEDULER_STARTED", null, null, "스케줄러 시작");

        _rows.Clear();
        foreach (var r in cmd.Rows ?? new List<SchedulerRowPayload>())
        {
            _rows.Add(new SchedulerRowInfo
            {
                Id            = r.Id,
                Order         = r.Order,
                MainProgramNo = r.MainProgramNo,
                SubProgramNo  = r.SubProgramNo,
                Preset        = r.Preset,
                Count         = r.Count,
                Status        = r.Status,
            });
        }

        _pauseRequested         = false;
        _waitingForPath2OnlyM20 = false;
        _skipFirstM20           = true;   // M99 선두 복귀형 구조: 선두 직후 첫 M20은 이전 사이클 신호 → 제외
        _currentRow             = null;
        SetState(SchedulerRunState.RUNNING);
        ExecuteNextPendingRow(ct);
    }

    private void HandleResume(CancellationToken ct)
    {
        if (_currentRow == null)
        {
            _logger.LogWarning("[Scheduler] RESUME: no current row in memory — cannot resume");
            return;
        }

        _pauseRequested = false;
        SetState(SchedulerRunState.RUNNING);
        ResumeRow(_currentRow, ct);
    }

    private void HandlePauseRequest()
    {
        var cfg = _templateLoader.CurrentTemplate?.SchedulerConfig;
        _pauseRequested = true;
        // OCS ON: 기계가 현재 사이클(M99) 완료 후 정지
        if (cfg != null) OneCycleStopOn(cfg);
        _logger.LogInformation("[Scheduler] PAUSE requested — 원사이클 스톱 ON, 다음 M20 이후 PAUSED 전환");
    }

    private void HandleCancel()
    {
        _logger.LogInformation("[Scheduler] CANCEL: 스케줄러 중단");
        // OCS ON: 기계가 현재 사이클(M99) 완료 후 자동 정지
        var cfg = _templateLoader.CurrentTemplate?.SchedulerConfig;
        if (_state == SchedulerRunState.RUNNING && cfg != null)
            OneCycleStopOn(cfg);

        _pauseRequested         = false;
        _waitingForPath2OnlyM20 = false;
        _currentRow             = null;
        _rows.Clear();
        // 서버가 이미 상태 처리함 — 내부 상태만 IDLE로
        _state = SchedulerRunState.IDLE;

        PublishEvent("SCHEDULER_STOPPED", null, null, "스케줄러 정지 (사용자 요청)");
    }

    // ── 행 실행 ────────────────────────────────────────────────────────────────

    private void ExecuteNextPendingRow(CancellationToken ct)
    {
        var nextRow = _rows.FirstOrDefault(r => r.Status == "PENDING");
        if (nextRow == null)
        {
            _logger.LogInformation("[Scheduler] 모든 행 완료 — 스케줄러 종료");
            _currentRow = null;
            SetState(SchedulerRunState.IDLE);
            PublishSchedulerCompleted();
            return;
        }

        _currentRow = nextRow;
        nextRow.Status = "RUNNING";
        StartRow(nextRow, ct);
    }

    /// <summary>
    /// 행 시작 시퀀스 (SCHEDULER_DESIGN.md Section 7-1)
    /// </summary>
    private void StartRow(SchedulerRowInfo row, CancellationToken ct)
    {
        var tpl = _templateLoader.CurrentTemplate;
        if (tpl == null)
        {
            ReportError(row.Id, "NO_TEMPLATE", "템플릿이 없습니다.");
            return;
        }

        var cfg = tpl.SchedulerConfig;

        _logger.LogInformation("[Scheduler] StartRow: {ProgramNo} preset={Preset} count={Count} rowId={RowId}",
            row.MainProgramNo, row.Preset, row.Count, row.Id);

        // [1] 인터락 확인 — 불만족 시 CONTROL DENIED (ERROR 전환 없음, IDLE 유지)
        if (!CheckInterlock(tpl))
        {
            ReportControlDenied("CONTROL_DENIED", "인터락 조건이 충족되지 않았습니다. 도어 닫힘 / 비상정지 해제 확인 후 재시도하세요.");
            return;
        }

        // [2] count >= preset 검사 — 이미 완료된 행은 PAUSE 없이 자동 스킵 (이전 실행 잔여 행)
        // PAUSE 후 RESUME 명령이 Tick에서 처리될 때 ExecutePath2Only 재호출되는 무한루프 방지
        if (row.Count >= row.Preset)
        {
            _logger.LogWarning("[Scheduler] count >= preset ({C}/{P}): 이미 완료된 행 — 자동 스킵",
                row.Count, row.Preset);
            row.Status = "COMPLETED";
            PublishSchedulerRowCompleted(row.Id);
            ExecuteNextPendingRow(ct);
            return;
        }

        // [4~5] 실행 모드 분기 (Path별 독립)
        _logger.LogInformation("[Scheduler] StartRow: mainMode={Main} subMode={Sub}", _mainMode, _subMode);

        if (!StartRowExec(row, cfg)) return;

        // [6] HEAD1 / HEAD2 / 원사이클 스톱 동시 확인
        // 목표 상태: HEAD1=ON(R6004.0=1), HEAD2=ON(R6004.1=1), OCS=OFF(R6006.0=0)
        // 동시 읽기 → 필요 명령 출력 → 동시 폴링 (최대 5초)
        // 타임아웃 시 PAUSED — 운영자 조치 후 RESUME
        if (!EnsureHeadsAndOCSReady(cfg))
        {
            PauseWithWarning(row.Id, "HEAD_OCS_TIMEOUT",
                "HEAD1/HEAD2 ON 또는 원사이클 스톱 OFF 상태 확인 실패. 키를 확인 후 재개하세요.");
            return;
        }

        // [7] skipFirstM20 초기화 (M99 선두 복귀형: 선두 직후 첫 M20 제외)
        _skipFirstM20 = true;

        // [8] CNC 변수 초기 동기화 (count + preset)
        SyncCountVarsToCnc(cfg, row);

        // [9] 사이클 스타트
        CycleStart(tpl);
    }

    /// <summary>
    /// PAUSED 행 재개 시퀀스 (인터락 재확인 → 원사이클 스톱 OFF → 사이클 스타트)
    /// </summary>
    private void ResumeRow(SchedulerRowInfo row, CancellationToken ct)
    {
        var tpl = _templateLoader.CurrentTemplate;
        if (tpl == null)
        {
            ReportError(row.Id, "NO_TEMPLATE", "템플릿이 없습니다.");
            return;
        }

        var cfg = tpl.SchedulerConfig;

        // count >= preset → 즉시 완료 처리 (재개 전 완료 확인)
        if (row.Count >= row.Preset)
        {
            CompleteCurrentRow(ct);
            return;
        }

        // 인터락 재확인
        if (!CheckInterlock(tpl))
        {
            ReportError(row.Id, "INTERLOCK_FAIL", "인터락 조건이 충족되지 않았습니다.");
            return;
        }

        // HEAD1/HEAD2/원사이클 스톱 동시 확인 (RESUME도 동일 조건)
        if (!EnsureHeadsAndOCSReady(cfg))
        {
            PauseWithWarning(row.Id, "HEAD_OCS_TIMEOUT",
                "HEAD1/HEAD2 ON 또는 원사이클 스톱 OFF 상태 확인 실패. 키를 확인 후 재개하세요.");
            return;
        }

        // RESUME 시에는 skipFirstM20 = false (이전 사이클 이어서 카운트)
        _skipFirstM20 = false;

        // 사이클 스타트
        CycleStart(tpl);
    }

    // ── Path별 실행 모드 통합 행 시작 (Step 4~5) ──────────────────────────────

    /// <summary>
    /// Path1/Path2 실행 모드를 독립적으로 처리합니다.
    /// mainMode: "memory" → cnc_search + 선두 복귀 / "dnc" → DNC 파일 확인 (선두 복귀 불필요)
    /// subMode:  "memory" → cnc_search(path=2) / "dnc" → DNC 파일 확인
    ///           subProgramNo 있을 때만 Path2 처리. 모드 무관 cnc_rewind(path=2) 수행.
    /// </summary>
    private bool StartRowExec(SchedulerRowInfo row, SchedulerConfig cfg)
    {
        // ── [4] Path1 프로그램 설정 ──────────────────────────────
        if (_mainMode == "dnc")
        {
            if (_dncPaths == null)
            {
                ReportError(row.Id, "DNC_NO_PATHS", "DNC 경로 설정이 없습니다 (START 시 미전달).");
                return false;
            }
            string path1File = ResolveDncFilePath(_dncPaths.Path1, row.MainProgramNo);
            _logger.LogInformation("[Scheduler][DNC] Path1 파일 경로: {Path}", path1File);
            if (!string.IsNullOrEmpty(path1File) && !System.IO.File.Exists(path1File))
            {
                ReportError(row.Id, "DNC_FILE_NOT_FOUND", $"Path1 DNC 파일 없음: {path1File}");
                return false;
            }
            // DNC는 파일 선두부터 스트리밍 → 선두 복귀 불필요
        }
        else // memory
        {
            int progNo = ParseProgramNo(row.MainProgramNo);
            if (progNo > 0 && !_dataReader.SearchProgram(progNo, 1))
            {
                ReportError(row.Id, "SEARCH_FAILED", $"프로그램 검색 실패: {row.MainProgramNo}");
                return false;
            }
        }

        // ── [4] Path2 프로그램 설정 (subProgramNo 있을 때만) ─────
        if (!string.IsNullOrEmpty(row.SubProgramNo))
        {
            if (_subMode == "dnc")
            {
                if (_dncPaths == null)
                {
                    ReportError(row.Id, "DNC_NO_PATHS", "DNC 경로 설정이 없습니다.");
                    return false;
                }
                string path2File = ResolveDncFilePath(_dncPaths.Path2, row.SubProgramNo);
                _logger.LogInformation("[Scheduler][DNC] Path2 파일 경로: {Path}", path2File);
                if (!string.IsNullOrEmpty(path2File) && !System.IO.File.Exists(path2File))
                {
                    ReportError(row.Id, "DNC_FILE_NOT_FOUND", $"Path2 DNC 파일 없음: {path2File}");
                    return false;
                }
            }
            else // memory
            {
                int subProgNo = ParseProgramNo(row.SubProgramNo);
                if (subProgNo > 0 && !_dataReader.SearchProgram(subProgNo, 2))
                {
                    ReportError(row.Id, "SEARCH_FAILED", $"서브 프로그램 검색 실패: {row.SubProgramNo}");
                    return false;
                }
            }

            // [5] Path2 선두 복귀 — 모드 무관 필수 (동기 코드 불일치 알람 방지)
            _logger.LogInformation("[Scheduler] Path2 선두 복귀: cnc_rewind(path=2) subMode={Sub}", _subMode);
            if (!_dataReader.RewindProgram(2))
            {
                ReportError(row.Id, "PATH2_REWIND_FAILED",
                    "Path2 선두 복귀 실패. Path1과 동기 코드 위치가 어긋나 실행 불가.");
                return false;
            }
        }

        // ── [5] Path1 선두 복귀 (memory 모드만) ─────────────────
        // DNC는 파일을 선두부터 스트리밍하므로 불필요
        if (_mainMode == "memory")
        {
            int progNo = ParseProgramNo(row.MainProgramNo);
            if (!RewindProgram(progNo, cfg.ResetAddr))
            {
                ReportError(row.Id, "REWIND_FAILED", "프로그램 선두 복귀 실패");
                return false;
            }
        }

        return true;
    }

    // ── Memory 모드 행 시작 (Step 4~5) ────────────────────────────────────────

    /// <summary>
    /// Memory 모드: cnc_search로 프로그램 번호 변경 + 선두 복귀
    /// returns false if error occurred (ReportError already called)
    /// </summary>
    private bool StartRowMemory(SchedulerRowInfo row, SchedulerConfig cfg)
    {
        int progNo = ParseProgramNo(row.MainProgramNo);
        if (progNo > 0)
        {
            if (!_dataReader.SearchProgram(progNo, 1))
            {
                ReportError(row.Id, "SEARCH_FAILED", $"프로그램 검색 실패: {row.MainProgramNo}");
                return false;
            }
        }

        if (!string.IsNullOrEmpty(row.SubProgramNo))
        {
            int subProgNo = ParseProgramNo(row.SubProgramNo);
            if (subProgNo > 0 && !_dataReader.SearchProgram(subProgNo, 2))
            {
                ReportError(row.Id, "SEARCH_FAILED", $"서브 프로그램 검색 실패: {row.SubProgramNo}");
                return false;
            }
        }

        // [5] 프로그램 선두 복귀 (3단계 fallback)
        if (!RewindProgram(progNo, cfg.ResetAddr))
        {
            ReportError(row.Id, "REWIND_FAILED", "프로그램 선두 복귀 실패");
            return false;
        }

        return true;
    }

    // ── DNC 모드 행 시작 (Step 4~5) ───────────────────────────────────────────

    /// <summary>
    /// DNC 모드: 파일 존재 확인 + CNC DNC 상태 확인 + Path2 선두 복귀
    /// returns false if error occurred (ReportError already called)
    /// DESIGN: Path2 선두 복귀 방법은 실기 테스트 후 확정 (현재 RESET 신호 사용)
    /// </summary>
    private bool StartRowDnc(SchedulerRowInfo row, SchedulerConfig cfg)
    {
        if (_dncPaths == null)
        {
            ReportError(row.Id, "EXECUTION_MODE_UNKNOWN", "DNC 경로 설정이 전달되지 않았습니다.");
            return false;
        }

        // [4-DNC] Path1 파일 존재 확인
        string path1File = ResolveDncFilePath(_dncPaths.Path1, row.MainProgramNo);
        _logger.LogInformation("[Scheduler][DNC] Path1 파일 경로: {Path}", path1File);

        if (!string.IsNullOrEmpty(path1File) && !System.IO.File.Exists(path1File))
        {
            ReportError(row.Id, "DNC_FILE_NOT_FOUND", $"Path1 DNC 파일 없음: {path1File}");
            return false;
        }

        // [4-DNC] Path2 파일 존재 확인 (subProgramNo 있는 경우)
        if (!string.IsNullOrEmpty(row.SubProgramNo))
        {
            string path2File = ResolveDncFilePath(_dncPaths.Path2, row.SubProgramNo);
            _logger.LogInformation("[Scheduler][DNC] Path2 파일 경로: {Path}", path2File);

            if (!string.IsNullOrEmpty(path2File) && !System.IO.File.Exists(path2File))
            {
                ReportError(row.Id, "DNC_FILE_NOT_FOUND", $"Path2 DNC 파일 없음: {path2File}");
                return false;
            }
        }

        // [4-DNC] CNC DNC 모드 확인 (aut=9)
        var status = _dataReader.ReadStatus();
        if (status != null && status.Aut != 9)
        {
            _logger.LogWarning("[Scheduler][DNC] CNC가 DNC 모드가 아님: aut={Aut}", status.Aut);
            ReportError(row.Id, "DNC_MODE_INVALID", $"CNC가 DNC 모드가 아닙니다. (현재 aut={status.Aut}, DNC=9)");
            return false;
        }

        // [5-DNC] Path1은 새 파일 호출 시 항상 선두에서 시작 — 선두 복귀 불필요
        // [5-DNC] Path2 선두 복귀: cnc_rewind(path=2) — 실기 테스트 확인 완료 (2026-03-22)
        // ※ 실패 시 반드시 중단: Path1=선두, Path2=M20 위치 불일치 → waiting M코드 알람 발생
        if (!string.IsNullOrEmpty(row.SubProgramNo))
        {
            _logger.LogInformation("[Scheduler][DNC] Path2 선두 복귀: cnc_rewind(path=2)");
            if (!_dataReader.RewindProgram(2))
            {
                ReportError(row.Id, "PATH2_REWIND_FAILED",
                    "Path2 선두 복귀 실패. Path1과 동기 코드 위치가 어긋나 실행 불가.");
                return false;
            }
            _logger.LogInformation("[Scheduler][DNC] Path2 선두 복귀 완료");
        }

        return true;
    }

    /// <summary>
    /// DNC 폴더 경로 + 프로그램 파일명으로 전체 파일 경로 생성
    /// 파일명 후보: "O1234", "O1234.nc", "O1234.cnc", "O1234.prg"
    /// </summary>
    private string ResolveDncFilePath(string folderPath, string? programNo)
    {
        if (string.IsNullOrEmpty(folderPath) || string.IsNullOrEmpty(programNo))
            return "";

        // 확장자 후보 (우선순위 순)
        string[] extensions = { "", ".nc", ".cnc", ".prg", ".txt" };
        string baseName = programNo.TrimStart('O', 'o');

        foreach (var ext in extensions)
        {
            // "O0001" 형식 시도
            string path1 = System.IO.Path.Combine(folderPath, $"O{baseName}{ext}");
            if (System.IO.File.Exists(path1)) return path1;

            // 숫자만 형식 시도 ("0001")
            string path2 = System.IO.Path.Combine(folderPath, $"{baseName}{ext}");
            if (System.IO.File.Exists(path2)) return path2;
        }

        // 존재하지 않으면 기본 경로 반환 (호출자가 File.Exists로 판단)
        return System.IO.Path.Combine(folderPath, $"O{baseName}.nc");
    }

    private void CompleteCurrentRow(CancellationToken ct)
    {
        if (_currentRow == null) return;
        var rowId = _currentRow.Id;
        _currentRow.Status = "COMPLETED";
        _logger.LogInformation("[Scheduler] 행 완료: {ProgramNo} count={Count}", _currentRow.MainProgramNo, _currentRow.Count);

        // path2 only 시퀀스: subProgramNo 있고 path2OnlyConfirmAddr 있으면 실행
        // (현재는 단순 완료로 처리 — 추후 Path2Only() 메서드로 확장 예정)
        if (!string.IsNullOrEmpty(_currentRow.SubProgramNo))
        {
            var cfg = _templateLoader.CurrentTemplate?.SchedulerConfig;
            if (cfg != null && !string.IsNullOrEmpty(cfg.Path2OnlyConfirmAddr))
            {
                ExecutePath2Only(_currentRow, cfg, ct);
                return; // path2 only 완료 후 행 COMPLETED + 다음 행으로
            }
        }

        PublishSchedulerRowCompleted(rowId);
        ExecuteNextPendingRow(ct);
    }

    // ── Path2 Only 시퀀스 (Section 7-3) ───────────────────────────────────────

    private void ExecutePath2Only(SchedulerRowInfo row, SchedulerConfig cfg, CancellationToken ct)
    {
        var tpl = _templateLoader.CurrentTemplate!;
        _logger.LogInformation("[Scheduler] Path2Only 시작: {ConfirmAddr} timeout={Timeout}ms",
            cfg.Path2OnlyConfirmAddr, cfg.Path2OnlyTimeoutMs);

        // [1] HEAD1 OFF — Path2 단독 실행을 위해 HEAD1(주축) 해제
        // HEAD1은 토글 방식: R6004.0=1(켜짐) 상태에서 R6104.0=1 펄스 → R6004.0=0
        if (!string.IsNullOrEmpty(cfg.MainHeadAddr) && !string.IsNullOrEmpty(cfg.MainHeadStatusAddr))
        {
            var head1CmdAddr    = PmcAddress.ParseString(cfg.MainHeadAddr);
            var head1StatusAddr = PmcAddress.ParseString(cfg.MainHeadStatusAddr);
            if (head1CmdAddr != null && head1StatusAddr != null)
            {
                int? head1State = _dataReader.ReadPmcBit(head1StatusAddr);
                if (head1State == 1)
                {
                    _logger.LogInformation("[Scheduler][Path2Only] HEAD1 OFF 펄스 출력 ({Addr})", cfg.MainHeadAddr);
                    _dataReader.WritePmcBit(head1CmdAddr, 1);
                    Thread.Sleep(300);
                    _dataReader.WritePmcBit(head1CmdAddr, 0);

                    // HEAD1 OFF 확인 (최대 5초)
                    var h1Deadline = DateTime.UtcNow.AddMilliseconds(5000);
                    bool head1Off = false;
                    while (DateTime.UtcNow < h1Deadline)
                    {
                        if (_dataReader.ReadPmcBit(head1StatusAddr) == 0) { head1Off = true; break; }
                        Thread.Sleep(100);
                    }
                    if (!head1Off)
                    {
                        ReportError(row.Id, "HEAD1_OFF_TIMEOUT", "Path2Only: HEAD1 OFF 확인 실패 (5초 timeout)");
                        return;
                    }
                    _logger.LogInformation("[Scheduler][Path2Only] HEAD1 OFF 확인 완료");
                }
                else
                {
                    _logger.LogInformation("[Scheduler][Path2Only] HEAD1 이미 OFF — 스킵");
                }
            }
        }

        // [2] 사이클 스타트 2회 (3초 간격) — Path1 응답 + Path2 단독 실행
        CycleStart(tpl);

        // [3] Path2Only 완료 M20 대기 플래그 세팅
        // 다음 M20(서브 단독 실행 완료) 수신 시 OnM20Edge에서 카운트 없이 행 완료 처리
        // HEAD1 복귀는 다음 행의 EnsureHeadsAndOCSReady에서 자동으로 ON 됨
        _waitingForPath2OnlyM20 = true;
        _logger.LogInformation("[Scheduler][Path2Only] Path2 단독 실행 중 — 완료 M20 대기");
    }

    // ── FOCAS 헬퍼 ────────────────────────────────────────────────────────────

    /// <summary>3단계 fallback 프로그램 선두 복귀</summary>
    private bool RewindProgram(int programNo, string? resetAddr)
    {
        // [1차] cnc_rewind
        if (_dataReader.RewindProgram())
        {
            _logger.LogInformation("[Scheduler] Rewind 1차: cnc_rewind OK");
            return true;
        }

        // [2차] RESET 신호
        if (!string.IsNullOrEmpty(resetAddr))
        {
            var addr = PmcAddress.ParseString(resetAddr);
            if (addr != null)
            {
                _logger.LogInformation("[Scheduler] Rewind 2차: RESET 신호");
                _dataReader.WritePmcBit(addr, 1);
                Thread.Sleep(300);
                _dataReader.WritePmcBit(addr, 0);
                Thread.Sleep(200);
                return true;
            }
        }

        // [3차] cnc_search 재실행
        if (programNo > 0)
        {
            _logger.LogInformation("[Scheduler] Rewind 3차: cnc_search 재실행");
            if (_dataReader.SearchProgram(programNo, 1))
                return true;
        }

        _logger.LogError("[Scheduler] Rewind: 모든 fallback 실패");
        return false;
    }

    private bool CheckInterlock(MachineTemplate tpl)
    {
        var page = tpl.TopBarInterlock.Scheduler;
        return page.Evaluate(addr =>
        {
            var data = _dataReader.ReadPmcR(addr.Address, 1);
            if (data == null || data.Length == 0) return null;
            return (data[0] & (1 << addr.Bit)) != 0;
        });
    }

    private void CheckInterlockWhileRunning()
    {
        var tpl = _templateLoader.CurrentTemplate;
        if (tpl == null) return;
        if (!CheckInterlock(tpl))
        {
            _logger.LogWarning("[Scheduler] 인터락 불만족 감지 (RUNNING 중) → 원사이클 스톱 ON");
            PublishEvent("INTERLOCK_FAIL", null, null, "인터락 불만족 감지 — 원사이클 스톱 ON");
            HandlePauseRequest();
        }
    }

    private void OneCycleStopOn(SchedulerConfig cfg)
    {
        if (string.IsNullOrEmpty(cfg.OneCycleStopAddr)) return;

        // 이미 ON 상태이면 불필요한 쓰기 스킵
        if (!string.IsNullOrEmpty(cfg.OneCycleStopStatusAddr))
        {
            var statusAddr = PmcAddress.ParseString(cfg.OneCycleStopStatusAddr);
            if (statusAddr != null && _dataReader.ReadPmcBit(statusAddr) == 1)
            {
                _logger.LogDebug("[Scheduler] 원사이클 스톱 이미 ON — 쓰기 스킵");
                return;
            }
        }

        var addr = PmcAddress.ParseString(cfg.OneCycleStopAddr);
        if (addr != null)
        {
            // 토글 ON: R6106.0=1 펄스 → R6006.0=1 확인(최대 1초) → R6106.0=0 복귀
            _dataReader.WritePmcBit(addr, 1);
            _logger.LogInformation("[Scheduler] 원사이클 스톱 ON 펄스 출력 ({Addr})", cfg.OneCycleStopAddr);
            Thread.Sleep(200);
            _dataReader.WritePmcBit(addr, 0);
            _logger.LogInformation("[Scheduler] 원사이클 스톱 ON ({Addr})", cfg.OneCycleStopAddr);
            PublishEvent("ONE_CYCLE_STOP_ON", null, null, "원사이클 스톱 ON");
        }
    }

    private void OneCycleStopOff(SchedulerConfig cfg)
    {
        if (string.IsNullOrEmpty(cfg.OneCycleStopAddr)) return;

        // 이미 OFF 상태이면 불필요한 쓰기 스킵
        if (!string.IsNullOrEmpty(cfg.OneCycleStopStatusAddr))
        {
            var statusAddr = PmcAddress.ParseString(cfg.OneCycleStopStatusAddr);
            if (statusAddr != null && _dataReader.ReadPmcBit(statusAddr) == 0)
            {
                _logger.LogDebug("[Scheduler] 원사이클 스톱 이미 OFF — 쓰기 스킵");
                return;
            }
        }

        var addr = PmcAddress.ParseString(cfg.OneCycleStopAddr);
        if (addr != null)
        {
            _dataReader.WritePmcBit(addr, 0);
            _logger.LogInformation("[Scheduler] 원사이클 스톱 OFF ({Addr})", cfg.OneCycleStopAddr);
        }
    }

    private void CycleStart(MachineTemplate tpl)
    {
        var cycleStartAddr = tpl.PmcMap.Control.CycleStart;
        if (cycleStartAddr == null)
        {
            _logger.LogWarning("[Scheduler] CycleStart PMC 주소 없음 — 사이클 스타트 스킵");
            return;
        }
        for (int i = 0; i < 2; i++)
        {
            _dataReader.WritePmcBit(cycleStartAddr, 1);
            Thread.Sleep(200); // longPress 200ms
            _dataReader.WritePmcBit(cycleStartAddr, 0);
            _logger.LogInformation("[Scheduler] 사이클 스타트 펄스 {N}/2", i + 1);
            if (i < 1) Thread.Sleep(3000); // 다음 펄스까지 3초 대기
        }
        _logger.LogInformation("[Scheduler] 사이클 스타트 완료 (2회)");
    }

    /// <summary>
    /// varType에 따라 매크로 또는 P코드 변수에 값을 씁니다.
    /// "macro" → #varNo (커스텀 매크로 변수), "pcode" → P varNo (공통 변수, 동일 함수 사용)
    /// </summary>
    private void WriteSchedulerVar(string varType, int varNo, long value, string label)
    {
        _logger.LogInformation("[Scheduler] WriteVar({Label}): type={Type} no={No} value={Val}", label, varType, varNo, value);

        bool ok = string.Equals(varType, "pcode", StringComparison.OrdinalIgnoreCase)
            ? _dataReader.WritePcodeMacroVariable(varNo, value)
            : _dataReader.WriteMacroVariable(varNo, value);

        if (!ok)
            _logger.LogWarning("[Scheduler] WriteVar 실패: {Label} type={Type} no={No}", label, varType, varNo);
    }

    /// <summary>
    /// 행 시작 시 CNC에 count + preset 초기값을 동기화합니다.
    /// </summary>
    private void SyncCountVarsToCnc(SchedulerConfig cfg, SchedulerRowInfo row)
    {
        WriteSchedulerVar(cfg.CountDisplay.CountVarType,  cfg.CountDisplay.CountMacroNo,  row.Count,  "count-init");
        WriteSchedulerVar(cfg.CountDisplay.PresetVarType, cfg.CountDisplay.PresetMacroNo, row.Preset, "preset-init");
    }

    private void WritePmcAddrBit(string? addrStr, int value)
    {
        if (string.IsNullOrEmpty(addrStr)) return;
        var addr = PmcAddress.ParseString(addrStr);
        if (addr != null) _dataReader.WritePmcBit(addr, value);
    }

    /// <summary>
    /// PMC 비트가 expectedValue가 될 때까지 폴링 대기합니다.
    /// 주소 파싱 실패 시 검증 불가 → true 반환 (무조건 통과).
    /// </summary>
    private bool WaitForPmcBit(string addrStr, int expectedValue, int timeoutMs, string label)
    {
        var addr = PmcAddress.ParseString(addrStr);
        if (addr == null) return true;

        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var val = _dataReader.ReadPmcBit(addr);
            if (val == expectedValue) return true;
            Thread.Sleep(100);
        }
        _logger.LogError("[Scheduler] WaitForPmcBit 타임아웃: {Label} addr={Addr} expected={Exp}", label, addrStr, expectedValue);
        return false;
    }

    /// <summary>
    /// PMC 비트를 목표값으로 설정하고, 상태 주소가 있으면 확인이 될 때까지 대기합니다.
    /// 이미 목표값이면 쓰기/대기를 스킵합니다.
    /// 상태 주소가 없으면 쓰기만 하고 true를 반환합니다.
    /// </summary>
    private bool EnsurePmcBitState(string? writeAddrStr, string? statusAddrStr, int targetValue, string label, int timeoutMs = 3000)
    {
        if (string.IsNullOrEmpty(writeAddrStr)) return true; // 주소 없으면 해당 HEAD 미사용 → 통과

        // 현재 상태 확인 — 이미 목표값이면 스킵
        if (!string.IsNullOrEmpty(statusAddrStr))
        {
            var statusAddr = PmcAddress.ParseString(statusAddrStr);
            if (statusAddr != null && _dataReader.ReadPmcBit(statusAddr) == targetValue)
            {
                _logger.LogInformation("[Scheduler] {Label} 이미 {Val} 상태 확인 — 쓰기 스킵 ({Addr})", label, targetValue, statusAddrStr);
                return true;
            }
        }

        // 신호 출력 (모멘터리 펄스: 300ms 후 0으로 복귀 — 리모트패널과 동일한 방식)
        var writeAddr = PmcAddress.ParseString(writeAddrStr);
        if (writeAddr != null)
        {
            _dataReader.WritePmcBit(writeAddr, targetValue);
            _logger.LogInformation("[Scheduler] {Label} = {Val} 출력 ({Addr})", label, targetValue, writeAddrStr);
            Thread.Sleep(300);
            _dataReader.WritePmcBit(writeAddr, 0);
            _logger.LogInformation("[Scheduler] {Label} 펄스 복귀 → 0 ({Addr})", label, writeAddrStr);
        }

        // 상태 주소 없으면 검증 없이 성공 반환
        if (string.IsNullOrEmpty(statusAddrStr)) return true;

        // 상태 확인 대기
        bool ok = WaitForPmcBit(statusAddrStr, targetValue, timeoutMs, label);
        if (ok)
            _logger.LogInformation("[Scheduler] {Label} 상태 확인 완료 ({Val})", label, targetValue);
        return ok;
    }

    /// <summary>
    /// HEAD1 / HEAD2 / 원사이클 스톱(OFF) 동시 확인 시퀀스 (설계 문서 Section 8-2)
    ///
    /// 1단계: 현재 상태 동시 읽기
    ///   R6004.0 (HEAD1), R6004.1 (HEAD2), R6006.0 (OCS 상태)
    /// 2단계: 필요한 명령 동시 출력
    ///   HEAD1 OFF → R6104.0 펄스 (1 → 300ms → 0)
    ///   HEAD2 OFF → R6104.1 펄스 (1 → 300ms → 0)
    ///   OCS ON   → R6106.0 = 0  (OFF 명령)
    /// 3단계: 동시 폴링 (최대 timeoutMs)
    ///   HEAD1=1, HEAD2=1, OCS=0 모두 충족 시 성공
    ///
    /// 주소가 비어있는 항목은 해당 신호 미사용으로 간주 → 자동 통과
    /// </summary>
    private bool EnsureHeadsAndOCSReady(SchedulerConfig cfg, int timeoutMs = 5000)
    {
        bool head1Skip = string.IsNullOrEmpty(cfg.MainHeadAddr);
        bool head2Skip = string.IsNullOrEmpty(cfg.SubHeadAddr);
        bool ocsSkip   = string.IsNullOrEmpty(cfg.OneCycleStopAddr);

        // ── 1단계: 현재 상태 동시 읽기 ──────────────────────────────
        bool head1OK = head1Skip;
        bool head2OK = head2Skip;
        bool ocsOK   = ocsSkip;

        if (!head1OK && !string.IsNullOrEmpty(cfg.MainHeadStatusAddr))
        {
            var a = PmcAddress.ParseString(cfg.MainHeadStatusAddr);
            head1OK = a != null && _dataReader.ReadPmcBit(a) == 1;
        }
        else if (!head1OK) head1OK = false; // 상태 주소 없으면 명령 출력 후 진행

        if (!head2OK && !string.IsNullOrEmpty(cfg.SubHeadStatusAddr))
        {
            var a = PmcAddress.ParseString(cfg.SubHeadStatusAddr);
            head2OK = a != null && _dataReader.ReadPmcBit(a) == 1;
        }
        else if (!head2OK) head2OK = false;

        if (!ocsOK && !string.IsNullOrEmpty(cfg.OneCycleStopStatusAddr))
        {
            var a = PmcAddress.ParseString(cfg.OneCycleStopStatusAddr);
            ocsOK = a != null && _dataReader.ReadPmcBit(a) == 0; // 목표: OFF = 0
        }
        else if (!ocsOK) ocsOK = false; // 상태 주소 없으면 명령 후 즉시 통과

        _logger.LogInformation(
            "[Scheduler] [동시확인] 현재 상태 — HEAD1={H1} HEAD2={H2} OCS(OFF목표)={OCS}",
            head1OK ? "OK" : "→ON필요", head2OK ? "OK" : "→ON필요", ocsOK ? "OK(OFF)" : "→OFF필요");

        if (head1OK && head2OK && ocsOK)
        {
            _logger.LogInformation("[Scheduler] [동시확인] 모두 목표 상태 확인 — 명령 출력 불필요");
            return true;
        }

        // ── 2단계: 필요한 명령 동시 출력 ────────────────────────────
        var head1Addr = !head1Skip ? PmcAddress.ParseString(cfg.MainHeadAddr) : null;
        var head2Addr = !head2Skip ? PmcAddress.ParseString(cfg.SubHeadAddr)  : null;
        var ocsAddr   = !ocsSkip  ? PmcAddress.ParseString(cfg.OneCycleStopAddr) : null;

        // HEAD 동시 ON 출력 (펄스 시작 — 두 신호 동시 출력 후 300ms 후 복귀)
        if (!head1OK && head1Addr != null)
        {
            _dataReader.WritePmcBit(head1Addr, 1);
            _logger.LogInformation("[Scheduler] HEAD1 ON 명령 출력 ({Addr})", cfg.MainHeadAddr);
        }
        if (!head2OK && head2Addr != null)
        {
            _dataReader.WritePmcBit(head2Addr, 1);
            _logger.LogInformation("[Scheduler] HEAD2 ON 명령 출력 ({Addr})", cfg.SubHeadAddr);
        }

        // OCS OFF: R6006.0=1 확인됨 → R6106.0=1 펄스로 토글 OFF
        // OCS는 토글 방식: R6106.0=1 신호를 줄 때마다 ON/OFF 전환
        // 시퀀스: R6006.0=1 확인 → R6106.0=1 출력 → R6006.0=0 확인 → R6106.0=0 복귀
        if (!ocsOK && ocsAddr != null)
        {
            _dataReader.WritePmcBit(ocsAddr, 1);
            _logger.LogInformation("[Scheduler] 원사이클 스톱 토글 OFF 펄스 출력 ({Addr})", cfg.OneCycleStopAddr);
        }
        else if (!ocsOK)
        {
            ocsOK = true; // 주소 없으면 즉시 통과
        }

        // HEAD 펄스 복귀 (300ms 후 0으로) + OCS 상태 확인 대기 겸용
        Thread.Sleep(300);
        if (!head1OK && head1Addr != null) _dataReader.WritePmcBit(head1Addr, 0);
        if (!head2OK && head2Addr != null) _dataReader.WritePmcBit(head2Addr, 0);
        // OCS 펄스 복귀
        if (!ocsOK && ocsAddr != null) _dataReader.WritePmcBit(ocsAddr, 0);

        if (head1OK && head2OK && ocsOK)
        {
            _logger.LogInformation("[Scheduler] [동시확인] 명령 출력 완료 — 상태 확인 생략 (주소 없음)");
            return true;
        }

        // ── 3단계: 동시 폴링 (최대 timeoutMs) ────────────────────────
        _logger.LogInformation("[Scheduler] [동시확인] 상태 폴링 시작 (최대 {Timeout}ms)", timeoutMs);
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (!head1OK && !string.IsNullOrEmpty(cfg.MainHeadStatusAddr))
            {
                var a = PmcAddress.ParseString(cfg.MainHeadStatusAddr);
                if (a != null && _dataReader.ReadPmcBit(a) == 1) head1OK = true;
            }
            if (!head2OK && !string.IsNullOrEmpty(cfg.SubHeadStatusAddr))
            {
                var a = PmcAddress.ParseString(cfg.SubHeadStatusAddr);
                if (a != null && _dataReader.ReadPmcBit(a) == 1) head2OK = true;
            }
            if (!ocsOK && !string.IsNullOrEmpty(cfg.OneCycleStopStatusAddr))
            {
                var a = PmcAddress.ParseString(cfg.OneCycleStopStatusAddr);
                if (a != null && _dataReader.ReadPmcBit(a) == 0) ocsOK = true;
            }

            if (head1OK && head2OK && ocsOK)
            {
                _logger.LogInformation("[Scheduler] [동시확인] HEAD1/HEAD2 ON, 원사이클 스톱 OFF 확인 완료");
                PublishEvent("HEADS_AND_OCS_READY", null, null, "HEAD1/HEAD2 ON, 원사이클 스톱 OFF 확인 완료");
                return true;
            }
            Thread.Sleep(100);
        }

        _logger.LogError(
            "[Scheduler] [동시확인] 타임아웃 ({Timeout}ms) — HEAD1={H1} HEAD2={H2} OCS(OFF)={OCS}",
            timeoutMs, head1OK, head2OK, ocsOK);
        return false;
    }

    /// <summary>
    /// 상태 주소를 읽어 이미 목표값과 같으면 쓰기 스킵 (HEAD ON/OFF 중복 신호 방지)
    /// </summary>
    private void WritePmcBitIfNotActive(string? writeAddrStr, string? statusAddrStr, int targetValue, string label)
    {
        if (string.IsNullOrEmpty(writeAddrStr)) return;

        // 상태 주소가 있으면 현재 상태 확인
        if (!string.IsNullOrEmpty(statusAddrStr))
        {
            var statusAddr = PmcAddress.ParseString(statusAddrStr);
            if (statusAddr != null)
            {
                var current = _dataReader.ReadPmcBit(statusAddr);
                if (current == targetValue)
                {
                    _logger.LogDebug("[Scheduler] {Label} 이미 {Val} 상태 — 쓰기 스킵", label, targetValue);
                    return;
                }
            }
        }

        var addr = PmcAddress.ParseString(writeAddrStr);
        if (addr != null)
        {
            _dataReader.WritePmcBit(addr, targetValue);
            _logger.LogInformation("[Scheduler] {Label} = {Val} 출력 ({Addr})", label, targetValue, writeAddrStr);
        }
    }

    private static int ParseProgramNo(string? programNo)
    {
        if (string.IsNullOrEmpty(programNo)) return 0;
        var raw = programNo.TrimStart('O', 'o', ' ');
        return int.TryParse(raw, out int no) ? no : 0;
    }

    // ── 상태 전이 ──────────────────────────────────────────────────────────────

    private void SetState(SchedulerRunState newState)
    {
        if (_state == newState) return;
        _logger.LogInformation("[Scheduler] State: {From} → {To}", _state, newState);
        _state = newState;
    }

    // ── MQTT 이벤트 발행 ───────────────────────────────────────────────────────

    private void PublishSchedulerRowCompleted(string rowId)
    {
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = "SCHEDULER_ROW_COMPLETED",
            RowId     = rowId,
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();
    }

    private void PublishSchedulerCompleted()
    {
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = "SCHEDULER_COMPLETED",
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();
    }

    private void PublishSchedulerPaused(string? rowId, string? code, string? message)
    {
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = "SCHEDULER_PAUSED",
            RowId     = rowId,
            Code      = code,
            Message   = message,
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();
    }

    private void PublishSchedulerError(string? rowId, string code, string message)
    {
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = "SCHEDULER_ERROR",
            RowId     = rowId,
            Code      = code,
            Message   = message,
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();
    }

    /// <summary>상태 변경 / 이벤트를 MQTT event 토픽으로 퍼블리시 (이벤트 로그 기록용)</summary>
    private void PublishEvent(string eventType, string? rowId, string? code, string? message)
    {
        var evt = new EventMessage
        {
            MachineId = _settings.MachineId,
            EventType = eventType,
            RowId     = rowId,
            Code      = code,
            Message   = message,
        };
        _mqttService.PublishEventAsync(evt).GetAwaiter().GetResult();
    }

    private void ReportError(string? rowId, string code, string message)
    {
        _logger.LogError("[Scheduler] ERROR: {Code} — {Msg} rowId={RowId}", code, message, rowId);
        // ERROR 상태로 전환 후 즉시 IDLE 복귀 — 행은 PENDING으로 리셋되므로 재시작 가능
        // 에러 내용은 이벤트 로그에 남음
        _pauseRequested         = false;
        _waitingForPath2OnlyM20 = false;
        _currentRow             = null;
        SetState(SchedulerRunState.IDLE);
        PublishSchedulerError(rowId, code, message);
    }

    /// <summary>
    /// 인터락 불만족 → 제어 거부 (CONTROL DENIED).
    /// ERROR가 아닌 IDLE 유지. 행 lastError 미기록. 운영자 조치 후 다시 START 가능.
    /// </summary>
    private void ReportControlDenied(string code, string message)
    {
        _logger.LogWarning("[Scheduler] CONTROL DENIED: {Code} — {Msg}", code, message);
        _pauseRequested = false;
        _currentRow = null;
        SetState(SchedulerRunState.IDLE);
        PublishEvent("SCHEDULER_CONTROL_DENIED", null, code, message);
    }

    /// <summary>
    /// 복구 가능한 오류 (HEAD/ONE CYCLE STOP 타임아웃 등) — ERROR가 아닌 PAUSED로 전환.
    /// 운영자가 원인 해소 후 RESUME으로 재시작 가능.
    /// </summary>
    private void PauseWithWarning(string? rowId, string code, string message)
    {
        _logger.LogWarning("[Scheduler] PAUSED(warning): {Code} — {Msg} rowId={RowId}", code, message, rowId);
        _pauseRequested = false;
        SetState(SchedulerRunState.PAUSED);
        PublishSchedulerPaused(rowId, code, message);
    }
}

public enum SchedulerRunState { IDLE, RUNNING, PAUSED, ERROR }

public class SchedulerRowInfo
{
    public string  Id            { get; set; } = "";
    public int     Order         { get; set; }
    public string  MainProgramNo { get; set; } = "";
    public string? SubProgramNo  { get; set; }
    public int     Preset        { get; set; }
    public int     Count         { get; set; }
    public string  Status        { get; set; } = "PENDING";
}
