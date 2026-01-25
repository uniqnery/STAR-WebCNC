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

    public CommandHandler(
        ILogger<CommandHandler> logger,
        IOptions<AgentSettings> options,
        FocasConnection connection,
        FocasDataReader dataReader,
        MqttService mqttService,
        TemplateLoader templateLoader)
    {
        _logger = logger;
        _settings = options.Value;
        _connection = connection;
        _dataReader = dataReader;
        _mqttService = mqttService;
        _templateLoader = templateLoader;
    }

    /// <summary>
    /// MQTT 명령 수신 핸들러 등록
    /// </summary>
    public void RegisterHandlers()
    {
        _mqttService.OnCommandReceived += HandleCommandAsync;
        _logger.LogInformation("Command handlers registered");
    }

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
            if (IsControlCommand(command.Command))
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
                "GET_STATUS" => await ExecuteGetStatusAsync(command),
                "GET_PROGRAM" => await ExecuteGetProgramAsync(command),
                "READ_MACRO" => await ExecuteReadMacroAsync(command),
                "WRITE_MACRO" => await ExecuteWriteMacroAsync(command),
                "RELOAD_TEMPLATE" => await ExecuteReloadTemplateAsync(command),
                "PING" => ExecutePing(command),
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
            "WRITE_MACRO" => true,
            "START" => true,
            "STOP" => true,
            "RESET" => true,
            _ => false
        };
    }

    private bool CheckInterlock()
    {
        if (_templateLoader.CurrentTemplate == null)
            return false;

        // 인터락 조건 체크
        var interlockConfig = _templateLoader.CurrentTemplate.InterlockConfig.ControlAllowed;

        foreach (var condition in interlockConfig.Conditions)
        {
            var address = _templateLoader.GetPmcAddress(condition.Signal);
            if (address == null)
                continue;

            var pmcData = _dataReader.ReadPmcR(address.Address, 1);
            if (pmcData == null || pmcData.Length == 0)
                return false;

            bool signalValue = (pmcData[0] & (1 << address.Bit)) != 0;
            if (signalValue != condition.Expected)
            {
                _logger.LogWarning("Interlock condition not met: {Signal} expected {Expected}, got {Actual}",
                    condition.Signal, condition.Expected, signalValue);
                return false;
            }
        }

        return true;
    }

    #region Command Implementations

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
        if (template == null)
            return CreateFailureResult(command, "RELOAD_FAILED", "템플릿 리로드 실패");

        return new CommandResultMessage
        {
            MachineId = _settings.MachineId,
            CorrelationId = command.CorrelationId,
            Status = "success",
            Result = new { templateId = template.TemplateId, version = template.Version }
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

    #endregion

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
