using System.IO.Compression;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Focas;
using StarWebCNC.Agent.Mqtt;
using StarWebCNC.Agent.Template;

namespace StarWebCNC.Agent.Commands;

/// <summary>
/// 서버로부터 수신된 명령 처리
/// </summary>
public class CommandHandler
{
    private readonly ILogger<CommandHandler> _logger;
    private readonly AgentSettings _settings;
    private readonly FocasConnection _connection;
    private readonly FocasDataReader _dataReader;
    private readonly MqttService _mqttService;
    private readonly TemplateLoader _templateLoader;
    private readonly StarWebCNC.Agent.Collectors.CounterJournal _counterJournal;

    public CommandHandler(
        ILogger<CommandHandler> logger,
        IOptions<AgentSettings> options,
        FocasConnection connection,
        FocasDataReader dataReader,
        MqttService mqttService,
        TemplateLoader templateLoader, StarWebCNC.Agent.Collectors.CounterJournal counterJournal)
    {
        _logger = logger;
        _settings = options.Value;
        _connection = connection;
        _dataReader = dataReader;
        _mqttService = mqttService;
        _templateLoader = templateLoader;
        _counterJournal = counterJournal;
    }

    /// <summary>
    /// MQTT 명령 수신 핸들러 등록 (DataCollectorService에서 Channel 경유로 대체)
    /// </summary>
    public void RegisterHandlers()
    {
        // 명령은 DataCollectorService의 Channel을 통해 FOCAS 전용 스레드에서 처리됨
        // (FOCAS2 thread-affinity 보장)
        _logger.LogInformation("Command handlers registered");
    }

    /// <summary>
    /// FOCAS 전용 스레드에서 직접 호출되는 명령 처리 진입점
    /// </summary>
    public Task ExecuteOnFocasThread(CommandMessage command) => HandleCommandAsync(command);

    /// <summary>
    /// 명령 처리
    /// </summary>
    private async Task HandleCommandAsync(CommandMessage command)
    {
        _logger.LogInformation("Received command: {Command} (correlationId: {CorrelationId})",
            command.Command, command.CorrelationId);

        CommandResultMessage result;

        try
        {
            // 인터락 체크 (제어 명령의 경우)
            // NC 데이터 쓰기(오프셋/카운터/공구수명)는 PMC 인터락 면제 — 제어권만으로 허용
            if (IsControlCommand(command.Command) && !IsNcDataWriteCommand(command.Command) && !IsPanelSafetyAction(command))
            {
                if (!CheckInterlock())
                {
                    result = CreateFailureResult(command, "INTERLOCK_FAILED", "인터락 조건이 충족되지 않았습니다.");
                    await _mqttService.PublishCommandResultAsync(result);
                    return;
                }
            }

            result = command.Command?.ToUpper() switch
            {
                "GET_STATUS"             => await ExecuteGetStatusAsync(command),
                "GET_PROGRAM"            => await ExecuteGetProgramAsync(command),
                "READ_MACRO"             => await ExecuteReadMacroAsync(command),
                "WRITE_MACRO"            => await ExecuteWriteMacroAsync(command),
                "RELOAD_TEMPLATE"        => await ExecuteReloadTemplateAsync(command),
                "LIST_PROGRAMS"          => await ExecuteListProgramsAsync(command),
                "GET_PROGRAM_PROTECTION" => ExecuteGetProgramProtection(command),
                "UPLOAD_PROGRAM"         => await ExecuteUploadProgramAsync(command),
                "DOWNLOAD_PROGRAM"       => await ExecuteDownloadProgramAsync(command),
                // ── NC 데이터 (Offset / Counter / Tool-Life) ──
                "READ_OFFSETS"           => await ExecuteReadOffsetsAsync(command),
                "WRITE_OFFSET"           => await ExecuteWriteOffsetAsync(command),
                "READ_COUNT"             => await ExecuteReadCountAsync(command),
                "WRITE_COUNT"            => await ExecuteWriteCountAsync(command),
                "READ_TOOL_LIFE"         => await ExecuteReadToolLifeAsync(command),
                "WRITE_TOOL_LIFE_PRESET" => await ExecuteWriteToolLifePresetAsync(command),
                "PMC_WRITE"              => await ExecutePmcWriteAsync(command),
                "WRITE_MDI"              => ExecuteWriteMdi(command),
                "SEARCH_PROGRAM"         => ExecuteSearchProgram(command),
                "REWIND_PROGRAM"         => ExecuteRewind(command),
                "REWIND"                 => ExecuteRewind(command),
                "CREATE_BACKUP"          => await ExecuteCreateBackupAsync(command),
                "PING"                   => ExecutePing(command),
                _ => CreateFailureResult(command, "UNKNOWN_COMMAND", $"알 수 없는 명령: {command.Command}")
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing command: {Command}", command.Command);
            result = CreateFailureResult(command, "EXECUTION_ERROR", ex.Message);
        }

        await _mqttService.PublishCommandResultAsync(result);
    }

    private bool IsControlCommand(string? command)
    {
        return command?.ToUpper() switch
        {
            "PMC_WRITE"              => true,
            "SEARCH_PROGRAM"         => true,
            "REWIND"                 => true,
            "REWIND_PROGRAM"         => true,
            "WRITE_MACRO"            => true,
            "START"                  => true,
            "STOP"                   => true,
            "RESET"                  => true,
            "WRITE_OFFSET"           => true,
            "WRITE_COUNT"            => true,
            "WRITE_TOOL_LIFE_PRESET" => true,
            _ => false
        };
    }

    /// <summary>
    /// NC 데이터 쓰기 명령 (오프셋/카운터/공구수명)은 PMC 인터락 없이 제어권만 확인
    /// 오프셋은 EDIT 모드에서 도어 상태와 무관하게 변경 가능
    /// </summary>
    private bool IsNcDataWriteCommand(string? command)
    {
        return command?.ToUpper() switch
        {
            "WRITE_OFFSET"           => true,
            "WRITE_COUNT"            => true,
            "WRITE_TOOL_LIFE_PRESET" => true,
            "WRITE_MDI"              => true,  // MDI 버퍼 기록: PMC 인터락 불필요, 제어권만 확인
            _ => false
        };
    }

    private bool CheckInterlock()
    {
        if (_templateLoader.CurrentTemplate == null || _templateLoader.CurrentTemplate.TemplateId == "FALLBACK_TEMPLATE")
            return false;

        // 인터락 조건 체크 (탑바 인터락 통합 — Remote 페이지 기준)
        var page = _templateLoader.CurrentTemplate.TopBarInterlock.Remote;

        return page.Evaluate(addr =>
        {
            // ReadPmcR는 R영역만 읽으므로 X/Y/G 등 다른 타입 주소에서 항상 틀린 값을 읽는다.
            // 탑바 인터락 pill과 동일하게 타입별 영역을 구분하는 ReadPmcBit를 사용한다.
            var bit = _dataReader.ReadPmcBit(addr);
            if (bit == null) return null;
            return bit == 1;
        });
    }

    #region Command Implementations

    private bool IsPanelSafetyAction(CommandMessage command)
    {
        if (command.Command?.ToUpperInvariant() != "PMC_WRITE" || command.Params == null) return false;
        var address = command.Params.GetValueOrDefault("address")?.ToString();
        if (!int.TryParse(command.Params.GetValueOrDefault("value")?.ToString(), out var value)) return false;
        var matches = _templateLoader.CurrentTemplate?.PanelLayout.SelectMany(g => g.Keys).Where(k =>
            string.Equals(k.ReqAddr, address, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(address)).ToList();
        return matches?.Count == 1 && (value == 0 || (value == 1 && new[] { "STOP", "FEED_HOLD", "CYCLE_STOP" }.Contains(matches[0].Id)));
    }

    private Task<CommandResultMessage> ExecuteGetStatusAsync(CommandMessage command)
    {
        var status = _dataReader.ReadStatus();
        if (status == null)
            return Task.FromResult(CreateFailureResult(command, "CNC_NOT_CONNECTED", "CNC에 연결되어 있지 않습니다."));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = status
        });
    }

    private Task<CommandResultMessage> ExecuteGetProgramAsync(CommandMessage command)
    {
        var program = _dataReader.ReadProgramInfo();
        if (program == null)
            return Task.FromResult(CreateFailureResult(command, "CNC_NOT_CONNECTED", "CNC에 연결되어 있지 않습니다."));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = program
        });
    }

    private Task<CommandResultMessage> ExecuteReadMacroAsync(CommandMessage command)
    {
        if (command.Params == null || !command.Params.TryGetValue("variableNo", out var varNoObj))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "variableNo 파라미터가 필요합니다."));

        if (!int.TryParse(varNoObj.ToString(), out int variableNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "variableNo는 정수여야 합니다."));

        var value = _dataReader.ReadMacroVariable(variableNo);
        if (value == null)
            return Task.FromResult(CreateFailureResult(command, "READ_FAILED", "매크로 변수 읽기 실패"));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new { variableNo, value }
        });
    }

    private Task<CommandResultMessage> ExecuteWriteMacroAsync(CommandMessage command)
    {
        if (command.Params == null)
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "파라미터가 필요합니다."));

        if (!command.Params.TryGetValue("variableNo", out var varNoObj) ||
            !int.TryParse(varNoObj.ToString(), out int variableNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "variableNo는 정수여야 합니다."));

        if (!command.Params.TryGetValue("value", out var valueObj) ||
            !double.TryParse(valueObj.ToString(), out double value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "value는 숫자여야 합니다."));

        bool success = _dataReader.WriteMacroVariable(variableNo, value);
        if (!success)
            return Task.FromResult(CreateFailureResult(command, "WRITE_FAILED", "매크로 변수 쓰기 실패"));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new { variableNo, value, written = true }
        });
    }

    private async Task<CommandResultMessage> ExecuteReloadTemplateAsync(CommandMessage command)
    {
        var template = await _templateLoader.ReloadTemplateAsync();
        if (template == null || template.TemplateId == "FALLBACK_TEMPLATE")
            return CreateFailureResult(command, "RELOAD_FAILED", "템플릿 리로드 실패");

        return new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new { templateId = template.TemplateId, version = template.Version }
        };
    }

    // ── 프로그램 파일 명령 ──────────────────────────────────────

    /// <summary>
    /// LIST_PROGRAMS: CNC 메모리 프로그램 목록 조회
    /// </summary>
    private Task<CommandResultMessage> ExecuteListProgramsAsync(CommandMessage command)
    {
        int pathNo = 1;
        if (command.Params?.TryGetValue("path", out var pObj) == true &&
            int.TryParse(pObj?.ToString(), out int parsedPath) && parsedPath >= 1)
            pathNo = parsedPath;

        var protection = _dataReader.ReadProgram9000Protection();
        var programs = _dataReader.ListPrograms(pathNo);
        if (programs == null)
            return Task.FromResult(CreateFailureResult(command, "CNC_NOT_CONNECTED", "CNC에 연결되어 있지 않습니다."));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new
            {
                programs = programs.Select(p => new
                {
                    name        = p.ProgramNo,           // "O0001"
                    isDirectory = false,
                    size        = p.Size,
                    modifiedAt  = DateTime.UtcNow.ToString("o"),
                    programNo   = p.ProgramNo,
                    comment     = p.Comment,
                    isProtected = IsProtectedProgram(p.Number, protection),
                }).ToList(),
                count = programs.Count,
                program9000Protection = ProtectionStateName(protection),
            },
        });
    }

    private CommandResultMessage ExecuteGetProgramProtection(CommandMessage command)
    {
        var protection = _dataReader.ReadProgram9000Protection();
        return new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new
            {
                program9000Protection = ProtectionStateName(protection),
                protected9000 = protection != Program9000ProtectionState.Unprotected,
            },
        };
    }

    /// <summary>
    /// UPLOAD_PROGRAM: PC → CNC 프로그램 전송
    /// params: { fileName: string, content: string, forceOverwrite?: bool }
    /// forceOverwrite=true 시 content의 O번호를 파싱하여 cnc_delete 후 업로드
    /// </summary>
    private async Task<CommandResultMessage> ExecuteUploadProgramAsync(CommandMessage command)
    {
        if (command.Params == null)
            return CreateFailureResult(command, "INVALID_PARAMS", "params가 필요합니다.");

        if (!command.Params.TryGetValue("content", out var contentObj) || contentObj is not string content)
            return CreateFailureResult(command, "INVALID_PARAMS", "content 파라미터가 필요합니다.");

        command.Params.TryGetValue("fileName", out var fileNameObj);
        string fileName = fileNameObj?.ToString() ?? "unknown.nc";
        int targetProgramNo = ExtractProgramNoFromContent(content);
        CommandResultMessage? protectionFailure = ValidateProtectedProgramOperation(command, targetProgramNo);
        if (protectionFailure != null)
            return protectionFailure;

        bool forceOverwrite = false;
        if (command.Params.TryGetValue("forceOverwrite", out var foObj))
            bool.TryParse(foObj?.ToString(), out forceOverwrite);

        _logger.LogInformation("UPLOAD_PROGRAM: {FileName} ({Bytes} bytes) forceOverwrite={FO}",
            fileName, content.Length, forceOverwrite);

        if (forceOverwrite)
        {
            int targetNo = targetProgramNo;
            if (targetNo > 0)
            {
                _logger.LogInformation("UPLOAD_PROGRAM: forceOverwrite → deleting O{No:D4} first", targetNo);
                bool deleted = await _dataReader.DeleteProgramAsync(targetNo);
                if (!deleted)
                    return CreateFailureResult(command, "DELETE_FAILED",
                        $"기존 O{targetNo:D4} 삭제 실패 — CNC가 EDIT 모드인지 확인하세요.");
            }
        }

        bool success = await _dataReader.UploadProgramAsync(content);
        if (!success)
            return CreateFailureResult(command, "UPLOAD_FAILED", "CNC에 프로그램 전송이 실패했습니다.");

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { fileName, size = content.Length, uploaded = true },
        };
    }

    private static int ExtractProgramNoFromContent(string content)
    {
        var match = System.Text.RegularExpressions.Regex.Match(content, @"^O(\d+)", System.Text.RegularExpressions.RegexOptions.Multiline);
        return match.Success && int.TryParse(match.Groups[1].Value, out int no) ? no : 0;
    }

    /// <summary>
    /// DOWNLOAD_PROGRAM: CNC → PC 프로그램 수신
    /// params: { fileName: string, path?: 1|2|3 }
    /// </summary>
    private async Task<CommandResultMessage> ExecuteDownloadProgramAsync(CommandMessage command)
    {
        if (command.Params == null)
            return CreateFailureResult(command, "INVALID_PARAMS", "params가 필요합니다.");

        if (!command.Params.TryGetValue("fileName", out var fileNameObj) || fileNameObj is not string fileName)
            return CreateFailureResult(command, "INVALID_PARAMS", "fileName 파라미터가 필요합니다.");

        // O번호 파싱 (O0001, O0001.nc, 0001, 1 → 1)
        string raw = System.IO.Path.GetFileNameWithoutExtension(fileName)
                                   .TrimStart('O', 'o');
        if (!int.TryParse(raw, out int programNo))
            return CreateFailureResult(command, "INVALID_PARAMS", $"O번호를 파싱할 수 없습니다: {fileName}");

        CommandResultMessage? protectionFailure = ValidateProtectedProgramOperation(command, programNo);
        if (protectionFailure != null)
            return protectionFailure;

        int pathNo = 1;
        if (command.Params.TryGetValue("path", out var pObj) &&
            int.TryParse(pObj?.ToString(), out int parsedPath) && parsedPath >= 1)
            pathNo = parsedPath;

        _logger.LogInformation("DOWNLOAD_PROGRAM: O{ProgramNo:D4} (path={Path})", programNo, pathNo);

        string? content;
        try
        {
            content = await _dataReader.DownloadProgramAsync(programNo, pathNo);
        }
        catch (InvalidOperationException ioe)
        {
            return ioe.Message switch
            {
                "EW_DATA"   => CreateFailureResult(command, "PROGRAM_NOT_FOUND",
                                   $"O{programNo:D4} 프로그램을 찾을 수 없습니다 (PATH{pathNo} 확인)."),
                "EW_MODE"   => CreateFailureResult(command, "CNC_NOT_IN_EDIT_MODE",
                                   "CNC를 EDIT 모드로 전환한 후 다시 시도하세요."),
                "EW_REJECT" => CreateFailureResult(command, "CNC_BUSY",
                                   "CNC가 자동운전 중이거나 백그라운드 편집 중입니다."),
                _           => CreateFailureResult(command, "DOWNLOAD_FAILED", ioe.Message),
            };
        }
        catch (Exception ex)
        {
            return CreateFailureResult(command, "DOWNLOAD_FAILED", ex.Message);
        }

        if (content == null)
            return CreateFailureResult(command, "DOWNLOAD_FAILED", $"O{programNo:D4} 수신 실패 (내용 없음)");

        // PC 저장 파일명 (서버가 share/에 저장할 때 사용)
        string pcFileName = $"O{programNo:D4}.nc";

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new
            {
                fileName  = pcFileName,
                content,
                size      = content.Length,
                pathNo,
            },
        };
    }

    // ── NC 데이터 명령 구현 ─────────────────────────────────────

    /// <summary>
    /// READ_OFFSETS: 마모 오프셋 읽기 (FANUC #2001 기준)
    /// params: { path?: 1|2, count?: 1-64 }
    /// </summary>
    private Task<CommandResultMessage> ExecuteReadOffsetsAsync(CommandMessage command)
    {
        int pathNo = 1;
        int count  = _templateLoader.CurrentTemplate?.OffsetConfig.ToolCount ?? 64;

        if (command.Params != null)
        {
            if (command.Params.TryGetValue("path",  out var pObj) && int.TryParse(pObj?.ToString(), out int p)) pathNo = p;
            if (command.Params.TryGetValue("count", out var cObj) && int.TryParse(cObj?.ToString(), out int c)) count  = Math.Clamp(c, 1, 64);
        }

        var offsets = _dataReader.ReadWearOffsets(pathNo, count);
        if (offsets == null)
            return Task.FromResult(CreateFailureResult(command, "CNC_NOT_CONNECTED", "CNC에 연결되어 있지 않습니다."));

        return Task.FromResult(new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { path = pathNo, count = offsets.Count, tools = offsets },
        });
    }

    /// <summary>
    /// WRITE_OFFSET: 마모 오프셋 쓰기 (단일 항목)
    /// params: { path, toolNo, axisIdx, value }
    /// axisIdx: 0=X, 1=Y, 2=Z, 3=R
    /// </summary>
    private Task<CommandResultMessage> ExecuteWriteOffsetAsync(CommandMessage command)
    {
        if (command.Params == null)
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "params가 필요합니다."));

        if (!command.Params.TryGetValue("path",    out var pObj)  || !int.TryParse(pObj?.ToString(),    out int pathNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "path(int) 필요"));
        if (!command.Params.TryGetValue("toolNo",  out var tObj)  || !int.TryParse(tObj?.ToString(),    out int toolNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "toolNo(int) 필요"));
        if (!command.Params.TryGetValue("axisIdx", out var aObj)  || !int.TryParse(aObj?.ToString(),    out int axisIdx))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "axisIdx(int) 필요"));
        if (!command.Params.TryGetValue("value",   out var vObj)  || !double.TryParse(vObj?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "value(double) 필요"));

        if (pathNo < 1 || pathNo > 2 || toolNo < 1 || toolNo > 64 || axisIdx < 0 || axisIdx > 3)
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "Path/공구/축 범위를 확인하세요."));
        double? delta = null;
        if (command.Params.TryGetValue("additiveDelta", out var deltaObj) && deltaObj != null)
        {
            if (!double.TryParse(deltaObj.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
                return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "증감값이 올바르지 않습니다."));
            delta = d;
        }
        var outcome = VerifiedDataWrite.Execute(() => _dataReader.ReadWearOffsetValue(pathNo, toolNo, axisIdx),
            target => _dataReader.WriteWearOffset(pathNo, toolNo, axisIdx, target), value, delta);
        return Task.FromResult(VerifiedResult(command, outcome, new() { ["path"] = pathNo, ["toolNo"] = toolNo, ["axisIdx"] = axisIdx }));
    }

    /// <summary>
    /// READ_COUNT: PRESET/COUNT는 모니터와 같은 설정을 사용한다.
    /// </summary>
    private Task<CommandResultMessage> ExecuteReadCountAsync(CommandMessage command)
    {
        var fields = GetCounterFields();
        if (fields.Count == 0)
        {
            return Task.FromResult(new CommandResultMessage
            {
                MachineId     = _settings.MachineId,
                CorrelationId = command.CorrelationId,
                Status        = "success",
                Result        = new { fields = Array.Empty<object>() },
            });
        }

        var fieldParams = fields.Select(f => new CounterFieldParam { Key = f.Key, VarType = f.VarType, VarNo = f.VarNo });
        var results     = _dataReader.ReadCounterVars(fieldParams);

        var output = results.Select(r =>
        {
            var f = fields.First(x => x.Key == r.Key);
            return new { key = r.Key, label = f.Label, value = r.Value, unit = f.Unit, varNo = r.VarNo, varType = f.VarType.ToLowerInvariant(), @readonly = f.Readonly };
        }).ToList();

        var display = _templateLoader.CurrentTemplate!.SchedulerConfig.CountDisplay;
        bool hms = !string.IsNullOrWhiteSpace(display.CycleTimeHmsStartAddr);
        double? cycleMs = _dataReader.ReadCycleTimeMs(hms ? display.CycleTimeHmsStartAddr! : display.CycleTimeAddr, display.CycleTimeMultiplier, hms);
        return Task.FromResult(new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { fields = output, cycleTimeSeconds = cycleMs / 1000.0, runState = _dataReader.ReadStatus()?.Run, presetMinGap = 2 },
        });
    }

    private List<CounterField> GetCounterFields()
    {
        var template = _templateLoader.CurrentTemplate;
        if (template == null) return new();

        var display = template.SchedulerConfig.CountDisplay;
        var fields = template.CounterConfig?.Fields.ToList() ?? new List<CounterField>();
        SetDisplayField("preset", "PRESET", display.PresetMacroNo, display.PresetVarType);
        SetDisplayField("count", "COUNT", display.CountMacroNo, display.CountVarType);
        return fields;

        void SetDisplayField(string key, string label, int varNo, string varType)
        {
            int index = fields.FindIndex(f => string.Equals(f.Key, key, StringComparison.OrdinalIgnoreCase));
            var previous = index >= 0 ? fields[index] : null;
            var field = new CounterField
            {
                Key = key, Label = previous?.Label ?? label, VarNo = varNo, VarType = varType,
                Readonly = previous?.Readonly ?? false, Unit = previous?.Unit,
            };
            if (index >= 0) fields[index] = field;
            else fields.Add(field);
        }
    }

    /// <summary>
    /// WRITE_COUNT: 템플릿에 설정된 카운터 변수 쓰기
    /// params: { varNo, value, key?, varType? }
    /// </summary>
    private Task<CommandResultMessage> ExecuteWriteCountAsync(CommandMessage command)
    {
        if (command.Params == null)
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "params가 필요합니다."));

        if (!command.Params.TryGetValue("varNo", out var vNoObj) || !int.TryParse(vNoObj?.ToString(), out int varNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "varNo(int) 필요"));
        if (!command.Params.TryGetValue("value", out var vObj)  || !double.TryParse(vObj?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "value(double) 필요"));

        if (!double.IsFinite(value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "유효한 카운터 값이 필요합니다."));
        var key = command.Params.GetValueOrDefault("key")?.ToString();
        var varType = command.Params.GetValueOrDefault("varType")?.ToString();
        var candidates = GetCounterFields().Where(f => f.VarNo == varNo &&
            (key == null ? string.Equals(f.VarType, "macro", StringComparison.OrdinalIgnoreCase)
                : f.Key == key && string.Equals(f.VarType, varType, StringComparison.OrdinalIgnoreCase))).ToList();
        if (candidates.Count != 1 || candidates[0].Readonly)
            return Task.FromResult(CreateFailureResult(command, "COUNTER_FIELD_CHANGED", "수정 가능한 카운터 변수를 다시 조회하세요."));

        bool quantityField = candidates[0].Key is "preset" or "count" or "total";
        if (quantityField && !CounterWriteRules.IsQuantity(value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_COUNTER_VALUE", "수량은 허용 범위의 0 이상 정수로 입력하세요."));

        var type = candidates[0].VarType.ToLowerInvariant();
        var display = _templateLoader.CurrentTemplate!.SchedulerConfig.CountDisplay;
        string? trackedField = varNo == display.CountMacroNo && string.Equals(type, display.CountVarType, StringComparison.OrdinalIgnoreCase) ? "count"
            : varNo == display.PresetMacroNo && string.Equals(type, display.PresetVarType, StringComparison.OrdinalIgnoreCase) ? "preset" : null;
        bool firstRead = true;
        CounterWriteRules.PresetResult? presetCheck = null;
        bool Write(double target) => type == "pcode" ? _dataReader.WritePcodeMacroVariable(varNo, target) : _dataReader.WriteMacroVariable(varNo, target);
        var outcome = VerifiedDataWrite.Execute(
            () => {
                var read = type == "pcode" ? _dataReader.ReadPcodeMacroVariable(varNo) : _dataReader.ReadMacroVariable(varNo);
                // Persist intent BEFORE writing. If interrupted, the next observation
                // is still classified as a manual adjustment, not production.
                if (firstRead && trackedField != null && read.HasValue) _counterJournal.BeginAdjustment(trackedField, read.Value, command.CorrelationId ?? Guid.NewGuid().ToString());
                firstRead = false; return read;
            },
            target => {
                if (candidates[0].Key != "preset") return Write(target);
                presetCheck = CounterWriteRules.WritePreset(target,
                    () => string.Equals(display.CountVarType, "pcode", StringComparison.OrdinalIgnoreCase) ? _dataReader.ReadPcodeMacroVariable(display.CountMacroNo) : _dataReader.ReadMacroVariable(display.CountMacroNo), Write);
                return presetCheck.Written;
            }, value);
        try { if (trackedField != null) _counterJournal.CompleteAdjustment(trackedField, outcome.Value); }
        catch (Exception ex) { _logger.LogError(ex, "Counter adjustment final journal pending; persisted intent retained"); }
        if (presetCheck?.ErrorCode != null) outcome = outcome with { ErrorCode = presetCheck.ErrorCode };
        var result = VerifiedResult(command, outcome, new() { ["varNo"] = varNo, ["varType"] = type, ["key"] = key, ["checkedCount"] = presetCheck?.Count, ["minimumPreset"] = presetCheck?.Count + 2 });
        if (presetCheck?.ErrorCode != null) result.ErrorMessage = presetCheck.ErrorCode == "COUNT_READ_FAILED"
            ? "현재 CNC 카운트를 확인하지 못해 저장하지 않았습니다. 다시 조회하세요."
            : $"프리셋은 현재 CNC 카운트({presetCheck.Count})보다 최소 2 이상 커야 합니다. 저장하지 않았습니다.";
        return Task.FromResult(result);
    }

    /// <summary>
    /// READ_TOOL_LIFE: 공구 수명 데이터 읽기 (템플릿 ToolLifeConfig 기반)
    /// params: { path?: 1|2 }
    /// </summary>
    private Task<CommandResultMessage> ExecuteReadToolLifeAsync(CommandMessage command)
    {
        int pathNo = 1;
        if (command.Params?.TryGetValue("path", out var pObj) == true && int.TryParse(pObj?.ToString(), out int p))
            pathNo = p;

        var cfg     = _templateLoader.CurrentTemplate?.ToolLifeConfig;
        var pathCfg = cfg?.Paths.FirstOrDefault(x => x.PathNo == pathNo);

        if (pathCfg == null)
        {
            return Task.FromResult(new CommandResultMessage
            {
                MachineId     = _settings.MachineId,
                CorrelationId = command.CorrelationId,
                Status        = "success",
                Result        = new { path = pathNo, tools = Array.Empty<object>() },
            });
        }

        // 컬럼 타입 맵 (key → column 메타)
        var colMap = pathCfg.Columns.ToDictionary(c => c.Key);

        var toolData = InToolLifePath(pathNo, () => pathCfg.Entries
            .Where(e => !e.IsSeparator)
            .Select(entry =>
            {
                var colValues = new Dictionary<string, object>();
                foreach (var (colKey, varNo) in entry.VarNos)
                {
                    if (!colMap.TryGetValue(colKey, out var col)) continue;
                    colValues[colKey] = ReadToolLifeVariable(col.VarType, varNo, col.DataType ?? "word")!;
                }
                return new { toolNo = entry.ToolNo, values = colValues };
            }).ToList());

        return Task.FromResult(new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { path = pathNo, tools = toolData },
        });
    }

    /// <summary>
    /// WRITE_TOOL_LIFE_PRESET: 공구 수명 변수 쓰기
    /// params: { varNo, value, varType?: "macro"|"pcode"|"ddata", dataType?: "byte"|"word"|"dword" }
    /// </summary>
    private Task<CommandResultMessage> ExecuteWriteToolLifePresetAsync(CommandMessage command)
    {
        if (command.Params == null)
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "params가 필요합니다."));

        if (!command.Params.TryGetValue("varNo", out var vNoObj) || !int.TryParse(vNoObj?.ToString(), out int varNo))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "varNo(int) 필요"));
        if (!command.Params.TryGetValue("value", out var vObj) || !double.TryParse(vObj?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double value))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "value(double) 필요"));

        string varType  = command.Params.TryGetValue("varType",  out var vtObj)  ? vtObj?.ToString() ?? "macro" : "macro";
        string dataType = command.Params.TryGetValue("dataType", out var dtObj)  ? dtObj?.ToString() ?? "word"  : "word";
        int pathNo = command.Params.TryGetValue("path", out var pathObj) && int.TryParse(pathObj?.ToString(), out var requestedPath) ? requestedPath : 1;

        var allowed = _templateLoader.CurrentTemplate?.ToolLifeConfig.Paths.Any(path => path.PathNo == pathNo && path.Columns.Any(col =>
            !col.Readonly && col.VarType == varType && (varType != "ddata" || (col.DataType ?? "word") == dataType) &&
            path.Entries.Any(entry => !entry.IsSeparator && entry.VarNos.GetValueOrDefault(col.Key, -1) == varNo))) == true;
        if (!allowed || !double.IsFinite(value) || (varType == "ddata" &&
            (!new[] { "byte", "word", "dword" }.Contains(dataType) || value < 0 || value != Math.Truncate(value) ||
            value > (dataType == "byte" ? byte.MaxValue : dataType == "word" ? ushort.MaxValue : uint.MaxValue))))
            return Task.FromResult(CreateFailureResult(command, "INVALID_PARAMS", "수정 가능한 공구수명 항목과 값 범위를 확인하세요."));
        var outcome = InToolLifePath(pathNo, () => VerifiedDataWrite.Execute(
            () => ReadToolLifeVariable(varType, varNo, dataType),
            target => ToolLifeVariables.Write(varType,
                () => _dataReader.WriteMacroVariable(varNo, target),
                () => _dataReader.WritePcodeMacroVariable(varNo, target),
                () => _dataReader.WritePmcAreaValue("D", varNo, dataType, (long)target)), value));
        return Task.FromResult(VerifiedResult(command, outcome, new() { ["path"] = pathNo, ["varNo"] = varNo, ["varType"] = varType, ["dataType"] = dataType }));
    }

    private double? ReadToolLifeVariable(string type, int varNo, string dataType)
        => ToolLifeVariables.Read(type,
            () => _dataReader.ReadMacroVariable(varNo),
            () => _dataReader.ReadPcodeMacroVariable(varNo),
            () => _dataReader.ReadPmcAreaValue("D", varNo, dataType));

    private T InToolLifePath<T>(int pathNo, Func<T> action)
    {
        try
        {
            if (pathNo < 1 || pathNo > 2 || Focas1.cnc_setpath(_connection.Handle, (short)pathNo) != Focas1.EW_OK)
                throw new InvalidOperationException("공구수명 CNC 경로를 선택하지 못했습니다.");
            return action();
        }
        finally { Focas1.cnc_setpath(_connection.Handle, 1); }
    }

    private CommandResultMessage VerifiedResult(CommandMessage command, VerifiedDataWrite.Outcome outcome, Dictionary<string, object?> fields)
    {
        fields["beforeValue"] = outcome.BeforeValue;
        fields["value"] = outcome.Value;
        fields["requestedValue"] = outcome.RequestedValue;
        fields["additiveDelta"] = outcome.AdditiveDelta;
        fields["written"] = outcome.Written;
        fields["completedAt"] = DateTime.UtcNow.ToString("o");
        return new CommandResultMessage { MachineId = _settings.MachineId, CorrelationId = command.CorrelationId,
            Status = outcome.ErrorCode == null ? "success" : "failure", Result = fields, ErrorCode = outcome.ErrorCode,
            ErrorMessage = outcome.ErrorCode == null ? null : "수정 결과를 확정할 수 없습니다. 실제 값을 재조회하세요. 자동 재전송하지 마세요." };
    }

    /// <summary>
    /// CREATE_BACKUP: CNC 프로그램을 ZIP으로 묶어 서버에 업로드
    /// params: { type: PROGRAM|FULL, backupId, fileName }
    /// - EDIT 모드: 실제 프로그램 내용 포함
    /// - AUTO 모드: 프로그램 번호 목록만 포함
    /// </summary>
    private async Task<CommandResultMessage> ExecuteCreateBackupAsync(CommandMessage command)
    {
        string backupId  = command.CorrelationId ?? $"backup-{DateTime.UtcNow:yyyyMMddHHmmss}";
        string backupType = "FULL";
        string fileName   = $"{_settings.MachineId}_FULL_{DateTime.UtcNow:yyyy-MM-ddTHH-mm-ss}Z.zip";

        if (command.Params != null)
        {
            if (command.Params.TryGetValue("type",     out var tObj) && tObj != null) backupType = tObj.ToString()!.ToUpper();
            if (command.Params.TryGetValue("fileName", out var fObj) && fObj != null) fileName   = fObj.ToString()!;
        }

        _logger.LogInformation("CREATE_BACKUP start: type={Type} id={Id}", backupType, backupId);

        // 1. 프로그램 목록
        var backupProtection = _dataReader.ReadProgram9000Protection();
        var programs = (_dataReader.ListPrograms() ?? new List<ProgramDirectoryEntry>())
            .Where(program => !IsProtectedProgram(program.Number, backupProtection))
            .ToList();

        // 2. EDIT 모드 여부 확인
        var status   = _dataReader.ReadStatus();
        bool editMode = status?.Edit == 1;
        _logger.LogInformation("CREATE_BACKUP: {Count} programs, editMode={Edit}", programs.Count, editMode);

        // 3. ZIP 생성 (FOCAS 스레드에서 동기 처리)
        byte[] zipBytes;
        using (var ms = new MemoryStream())
        {
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                // manifest.json
                var manifest = zip.CreateEntry("manifest.json");
                using (var w = new StreamWriter(manifest.Open()))
                {
                    w.Write(System.Text.Json.JsonSerializer.Serialize(new
                    {
                        backupId,
                        backupType,
                        machineId   = _settings.MachineId,
                        createdAt   = DateTime.UtcNow.ToString("o"),
                        editMode,
                        programCount = programs.Count,
                    }));
                }

                // program_list.txt
                var listEntry = zip.CreateEntry("program_list.txt");
                using (var w = new StreamWriter(listEntry.Open()))
                {
                    w.WriteLine($"# CNC Program List");
                    w.WriteLine($"# Machine  : {_settings.MachineId}");
                    w.WriteLine($"# Created  : {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
                    w.WriteLine($"# EditMode : {editMode}");
                    w.WriteLine();
                    foreach (var p in programs)
                        w.WriteLine(string.IsNullOrEmpty(p.Comment) ? p.ProgramNo : $"{p.ProgramNo}\t({p.Comment})");
                }

                // 프로그램 내용 (EDIT 모드 또는 PROGRAM/FULL 백업 유형)
                if (backupType is "PROGRAM" or "FULL")
                {
                    int saved = 0;
                    foreach (var prog in programs)
                    {
                        string? content = _dataReader.TryDownloadProgram(prog.Number);
                        if (content == null) continue;
                        var entry = zip.CreateEntry($"programs/{prog.ProgramNo}.nc");
                        using var w = new StreamWriter(entry.Open());
                        w.Write(content);
                        saved++;
                    }
                    _logger.LogInformation("CREATE_BACKUP: saved {N}/{Total} programs", saved, programs.Count);
                }
            }
            zipBytes = ms.ToArray();
        }

        // 4. 서버 HTTP 업로드 (FOCAS 스레드와 무관 — await OK)
        string serverUrl = _settings.Server?.BaseUrl ?? "http://localhost:3000";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            using var form = new MultipartFormDataContent();
            form.Add(new ByteArrayContent(zipBytes), "file", fileName);
            var resp = await http.PostAsync($"{serverUrl}/api/backup/{backupId}/upload", form);
            resp.EnsureSuccessStatusCode();
            _logger.LogInformation("CREATE_BACKUP: uploaded {Bytes} bytes to server", zipBytes.Length);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CREATE_BACKUP: upload failed");
            return CreateFailureResult(command, "UPLOAD_FAILED", $"서버 업로드 실패: {ex.Message}");
        }

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new
            {
                backupId,
                fileName,
                fileSize     = zipBytes.Length,
                programCount = programs.Count,
                editMode,
            },
        };
    }

    private CommandResultMessage ExecutePing(CommandMessage command)
    {
        return new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new { pong = true, timestamp = DateTime.UtcNow.ToString("o") }
        };
    }

    /// <summary>
    /// PMC 비트 쓰기 (조작반 패널 키 → CNC 출력)
    /// payload: { address: "R6105.4", value: 1, holdMs: 200 }
    /// holdMs > 0 이면 holdMs 후 자동으로 0으로 복귀 (모멘터리 동작)
    /// </summary>
    private Task<CommandResultMessage> ExecutePmcWriteAsync(CommandMessage command)
    {
        return Task.FromResult(ExecutePmcWriteSync(command));
    }

    /// <summary>
    /// FOCAS 스레드 친화성 보장: async/await 없이 동기 실행.
    /// await Task.Delay()는 스레드 풀 스레드로 continuation을 옮겨
    /// FOCAS2 EW_HANDLE(-8)을 유발 — Thread.Sleep으로 대체.
    /// </summary>
    private CommandResultMessage ExecutePmcWriteSync(CommandMessage command)
    {
        var p = command.Params;
        if (p == null)
            return CreateFailureResult(command, "INVALID_PARAMS", "params 없음");

        string? addrStr = p.TryGetValue("address", out var aObj) ? aObj?.ToString() : null;
        if (string.IsNullOrWhiteSpace(addrStr))
            return CreateFailureResult(command, "INVALID_PARAMS", "address 필드 없음");

        var addr = PmcAddress.ParseString(addrStr);
        if (addr == null)
            return CreateFailureResult(command, "INVALID_PARAMS", $"address 파싱 실패: {addrStr}");

        int bitValue = 1;
        if (p.TryGetValue("value", out var vObj) && vObj != null)
            int.TryParse(vObj.ToString(), out bitValue);

        int holdMs = 0;
        if (p.TryGetValue("holdMs", out var hObj) && hObj != null)
            int.TryParse(hObj.ToString(), out holdMs);

        _logger.LogInformation("PMC_WRITE {Addr} = {Val} (holdMs={Hold})", addrStr, bitValue, holdMs);

        if ((bitValue != 0 && bitValue != 1) || holdMs < 0 || holdMs > 5000)
            return CreateFailureResult(command, "INVALID_PARAMS", "PMC 값 또는 출력 시간을 확인하세요.");
        if (!IsPanelSafetyAction(command) && !CheckInterlock())
            return CreateFailureResult(command, "INTERLOCK_FAILED", "출력 직전 인터록 조건 불만족");

        bool ok = _dataReader.WritePmcBit(addr, bitValue);
        if (!ok)
            return CreateFailureResult(command, "PMC_WRITE_FAILED", $"pmc_wrpmcrng 실패: {addrStr}");

        // 모멘터리: holdMs 후 0으로 복귀 (Thread.Sleep — 스레드 전환 없음)
        if (holdMs > 0)
        {
            System.Threading.Thread.Sleep(holdMs);
            if (!_dataReader.WritePmcBit(addr, 0))
                return CreateFailureResult(command, "PMC_RELEASE_FAILED", "PMC 출력 해제 실패");
            _logger.LogInformation("PMC_WRITE auto-release {Addr} = 0", addrStr);
        }

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { address = addrStr, value = bitValue, holdMs }
        };
    }

    /// <summary>
    /// WRITE_MDI: MDI 버퍼에 프로그램 기록 (cnc_wrmdiprog)
    /// params: { program: string }  — ';' EOB 포함 가능
    /// </summary>
    private CommandResultMessage ExecuteWriteMdi(CommandMessage command)
    {
        if (command.Params == null ||
            !command.Params.TryGetValue("program", out var progObj) ||
            progObj is not string program ||
            string.IsNullOrWhiteSpace(program))
            return CreateFailureResult(command, "INVALID_PARAMS", "program 파라미터가 필요합니다.");

        int pathNo = 1;
        if ((command.Params.TryGetValue("path", out var pathObj) || command.Params.TryGetValue("pathNo", out pathObj)) &&
            int.TryParse(pathObj?.ToString(), out int parsedPath))
        {
            pathNo = parsedPath;
        }

        bool ok = _dataReader.WriteMdiProgram(program, pathNo);
        if (!ok)
            return CreateFailureResult(command, "WRITE_MDI_FAILED", "MDI buffer write failed. Check MDI mode and selected path.");

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { written = true, path = pathNo },
        };
    }

    /// <summary>
    /// SEARCH_PROGRAM: 프로그램 번호 선택 (cnc_search)
    /// params: { programNo: int, path?: 1|2 }
    /// </summary>
    private CommandResultMessage ExecuteSearchProgram(CommandMessage command)
    {
        if (command.Params == null ||
            !command.Params.TryGetValue("programNo", out var pNoObj) ||
            !int.TryParse(pNoObj?.ToString(), out int programNo))
        {
            return CreateFailureResult(command, "INVALID_PARAMS", "programNo 파라미터가 필요합니다.");
        }

        int pathNo = 1;
        if (command.Params.TryGetValue("path", out var pathObj) &&
            int.TryParse(pathObj?.ToString(), out int parsedPath))
        {
            pathNo = parsedPath;
        }

        CommandResultMessage? protectionFailure = ValidateProtectedProgramOperation(command, programNo);
        if (protectionFailure != null)
            return protectionFailure;

        bool ok = _dataReader.SearchProgram(programNo, pathNo);
        if (!ok)
            return CreateFailureResult(command, "SEARCH_FAILED",
                $"cnc_search O{programNo:D4} (path={pathNo}) 실패");

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = new { programNo, path = pathNo },
        };
    }

    /// <summary>
    /// REWIND: 프로그램 선두 복귀 테스트 명령
    /// params: { path?: 1|2|"both" }
    ///   path=1    → Path1만
    ///   path=2    → Path2만
    ///   path=both → Path1 + Path2 순서대로 (기본값)
    /// </summary>
    private CommandResultMessage ExecuteRewind(CommandMessage command)
    {
        string pathParam = "both";
        if (command.Params?.TryGetValue("path", out var pObj) == true && pObj != null)
            pathParam = pObj.ToString()!.ToLower();

        var results = new System.Collections.Generic.Dictionary<string, object>();

        if (pathParam == "1" || pathParam == "both")
        {
            bool ok = _dataReader.RewindProgram(1);
            results["path1"] = ok ? "OK" : "FAILED";
            _logger.LogInformation("[REWIND] Path1 → {R}", results["path1"]);
        }

        if (pathParam == "2" || pathParam == "both")
        {
            bool ok = _dataReader.RewindProgram(2);
            results["path2"] = ok ? "OK" : "FAILED";
            _logger.LogInformation("[REWIND] Path2 → {R}", results["path2"]);
        }

        bool allOk = results.Values.All(v => v.ToString() == "OK");
        if (!allOk)
            return CreateFailureResult(command, "REWIND_FAILED",
                $"선두 복귀 실패: {string.Join(", ", results.Select(kv => $"{kv.Key}={kv.Value}"))}");

        return new CommandResultMessage
        {
            MachineId     = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status        = "success",
            Result        = results,
        };
    }

    private static string? ReadCommandString(CommandMessage command, string key)
    {
        return command.Params?.TryGetValue(key, out var value) == true
            ? value?.ToString()
            : null;
    }

    #endregion

    private CommandResultMessage? ValidateProtectedProgramOperation(CommandMessage command, int programNo)
    {
        if (programNo < 9000 || programNo > 9999)
            return null;

        Program9000ProtectionState protection = _dataReader.ReadProgram9000Protection();
        return protection switch
        {
            Program9000ProtectionState.Unprotected => null,
            Program9000ProtectionState.Protected => CreateFailureResult(command, "PROGRAM_9000_PROTECTED", $"O{programNo:D4}은 파라미터 3202#4(NE9)로 보호되어 있습니다."),
            _ => CreateFailureResult(command, "PROGRAM_PROTECTION_UNKNOWN", $"O{programNo:D4} 보호 상태를 확인할 수 없어 작업을 차단했습니다."),
        };
    }

    private static bool IsProtectedProgram(int programNo, Program9000ProtectionState protection) =>
        programNo >= 9000 && programNo <= 9999 && protection != Program9000ProtectionState.Unprotected;

    private static string ProtectionStateName(Program9000ProtectionState protection) => protection switch
    {
        Program9000ProtectionState.Protected => "protected",
        Program9000ProtectionState.Unprotected => "unprotected",
        _ => "unknown",
    };

    private CommandResultMessage CreateFailureResult(CommandMessage command, string errorCode, string errorMessage)
    {
        return new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "failure",
            ErrorCode = errorCode,
            ErrorMessage = errorMessage
        };
    }
}
