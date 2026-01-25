using Microsoft.Extensions.Logging;

namespace StarWebCNC.Agent.Focas;

/// <summary>
/// FOCAS2 데이터 읽기 서비스
/// </summary>
public class FocasDataReader
{
    private readonly ILogger<FocasDataReader> _logger;
    private readonly FocasConnection _connection;

    public FocasDataReader(
        ILogger<FocasDataReader> logger,
        FocasConnection connection)
    {
        _logger = logger;
        _connection = connection;
    }

    /// <summary>
    /// CNC 상태 정보 읽기
    /// </summary>
    public CncStatus? ReadStatus()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var statInfo = new Focas1.ODBST();
            short ret = Focas1.cnc_statinfo(_connection.Handle, statInfo);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_statinfo failed: {ErrorCode}", ret);
                return null;
            }

            return new CncStatus
            {
                Hdck = statInfo.hdck,
                Tmmode = statInfo.tmmode,
                Aut = statInfo.aut,
                Run = statInfo.run,
                Motion = statInfo.motion,
                Mstb = statInfo.mstb,
                Emergency = statInfo.emergency,
                Alarm = statInfo.alarm,
                Edit = statInfo.edit
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading CNC status");
            return null;
        }
    }

    /// <summary>
    /// 현재 프로그램 번호 읽기
    /// </summary>
    public ProgramInfo? ReadProgramInfo()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            // 현재 프로그램 번호
            var prgNum = new Focas1.ODBPRO();
            short ret = Focas1.cnc_rdprgnum(_connection.Handle, prgNum);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_rdprgnum failed: {ErrorCode}", ret);
                return null;
            }

            // 현재 시퀀스 번호
            var seqNum = new Focas1.ODBSEQ();
            Focas1.cnc_rdseqnum(_connection.Handle, seqNum);

            return new ProgramInfo
            {
                MainProgram = prgNum.mdata,
                CurrentProgram = prgNum.data,
                SequenceNumber = seqNum.data
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading program info");
            return null;
        }
    }

    /// <summary>
    /// 이송 속도 읽기
    /// </summary>
    public int? ReadFeedrate()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var actf = new Focas1.ODBACT();
            short ret = Focas1.cnc_actf(_connection.Handle, actf);
            if (ret != Focas1.EW_OK)
                return null;

            return actf.data;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading feedrate");
            return null;
        }
    }

    /// <summary>
    /// 스핀들 속도 읽기
    /// </summary>
    public int? ReadSpindleSpeed()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var acts = new Focas1.ODBACT();
            short ret = Focas1.cnc_acts(_connection.Handle, acts);
            if (ret != Focas1.EW_OK)
                return null;

            return acts.data;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading spindle speed");
            return null;
        }
    }

    /// <summary>
    /// 절대 좌표 읽기
    /// </summary>
    public AxisPosition? ReadAbsolutePosition()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var pos = new Focas1.ODBAXIS();
            short ret = Focas1.cnc_absolute(_connection.Handle, -1, 4 + Focas1.MAX_AXIS * 4, pos);
            if (ret != Focas1.EW_OK)
                return null;

            return new AxisPosition
            {
                Values = pos.data?.Take(8).ToArray() ?? Array.Empty<int>()
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading absolute position");
            return null;
        }
    }

    /// <summary>
    /// 기계 좌표 읽기
    /// </summary>
    public AxisPosition? ReadMachinePosition()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var pos = new Focas1.ODBAXIS();
            short ret = Focas1.cnc_machine(_connection.Handle, -1, 4 + Focas1.MAX_AXIS * 4, pos);
            if (ret != Focas1.EW_OK)
                return null;

            return new AxisPosition
            {
                Values = pos.data?.Take(8).ToArray() ?? Array.Empty<int>()
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading machine position");
            return null;
        }
    }

    /// <summary>
    /// 알람 읽기
    /// </summary>
    public List<AlarmInfo> ReadAlarms()
    {
        var alarms = new List<AlarmInfo>();
        if (!_connection.IsConnected)
            return alarms;

        try
        {
            // 알람 메시지 읽기 (최대 10개)
            short num = 10;
            var alarmMsg = new Focas1.ODBALMMSG2[num];
            for (int i = 0; i < num; i++)
            {
                alarmMsg[i] = new Focas1.ODBALMMSG2();
            }

            short ret = Focas1.cnc_rdalmmsg2(_connection.Handle, -1, ref num, alarmMsg);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_rdalmmsg2 failed: {ErrorCode}", ret);
                return alarms;
            }

            for (int i = 0; i < num; i++)
            {
                if (alarmMsg[i].alm_no != 0)
                {
                    alarms.Add(new AlarmInfo
                    {
                        AlarmNo = alarmMsg[i].alm_no,
                        Type = alarmMsg[i].type,
                        Axis = alarmMsg[i].axis,
                        Message = alarmMsg[i].alm_msg?.TrimEnd('\0') ?? ""
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading alarms");
        }

        return alarms;
    }

    /// <summary>
    /// PMC 데이터 읽기 (R 영역)
    /// </summary>
    public byte[]? ReadPmcR(int startAddress, int length)
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var pmcData = new Focas1.IODBPMC0();
            short ret = Focas1.pmc_rdpmcrng(
                _connection.Handle,
                5, // R 타입
                0, // 데이터 타입 (바이트)
                (ushort)startAddress,
                (ushort)(startAddress + length - 1),
                (ushort)(8 + length),
                pmcData);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("pmc_rdpmcrng failed: {ErrorCode}", ret);
                return null;
            }

            return pmcData.cdata?.Take(length).ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading PMC R data");
            return null;
        }
    }

    /// <summary>
    /// 매크로 변수 읽기
    /// </summary>
    public double? ReadMacroVariable(int variableNo)
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            var macro = new Focas1.ODBM();
            short ret = Focas1.cnc_rdmacro(_connection.Handle, (short)variableNo, 10, macro);
            if (ret != Focas1.EW_OK)
                return null;

            // FOCAS 매크로 변수는 mcr_val * 10^(-mcr_dec) 형식
            return macro.mcr_val * Math.Pow(10, -macro.mcr_dec);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading macro variable {VariableNo}", variableNo);
            return null;
        }
    }

    /// <summary>
    /// 매크로 변수 쓰기
    /// </summary>
    public bool WriteMacroVariable(int variableNo, double value)
    {
        if (!_connection.IsConnected)
            return false;

        try
        {
            // 소수점 자릿수 계산
            int decimalPlaces = 0;
            double temp = value;
            while (temp != Math.Floor(temp) && decimalPlaces < 9)
            {
                temp *= 10;
                decimalPlaces++;
            }

            int intValue = (int)(value * Math.Pow(10, decimalPlaces));

            short ret = Focas1.cnc_wrmacro(
                _connection.Handle,
                (short)variableNo,
                10,
                intValue,
                (short)decimalPlaces);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_wrmacro failed: {ErrorCode}", ret);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error writing macro variable {VariableNo}", variableNo);
            return false;
        }
    }

    /// <summary>
    /// 파츠 카운터 읽기 (설정된 매크로 변수에서)
    /// </summary>
    public int? ReadPartsCount(int macroVariableNo)
    {
        var value = ReadMacroVariable(macroVariableNo);
        return value.HasValue ? (int)value.Value : null;
    }
}

#region Data Models

public class CncStatus
{
    /// <summary>
    /// 수동 핸들 상태
    /// </summary>
    public short Hdck { get; set; }

    /// <summary>
    /// T/M 모드 선택
    /// </summary>
    public short Tmmode { get; set; }

    /// <summary>
    /// 자동 모드 (0:MDI, 1:MEM, 3:EDIT, 4:HANDLE, 5:JOG, 6:JOG HANDLE, etc.)
    /// </summary>
    public short Aut { get; set; }

    /// <summary>
    /// 실행 상태 (0:STOP, 1:HOLD, 2:STaRT, 3:MSTR, 4:ReSTaRT)
    /// </summary>
    public short Run { get; set; }

    /// <summary>
    /// 축 이동 상태 (0:Not motion, 1:Motion, 2:Dwell)
    /// </summary>
    public short Motion { get; set; }

    /// <summary>
    /// M/S/T/B 상태
    /// </summary>
    public short Mstb { get; set; }

    /// <summary>
    /// 비상 정지 상태 (0:No EMG, 1:EMG, 2:RESET)
    /// </summary>
    public short Emergency { get; set; }

    /// <summary>
    /// 알람 상태 (0:No alarm, 1:Alarm)
    /// </summary>
    public short Alarm { get; set; }

    /// <summary>
    /// 편집 상태
    /// </summary>
    public short Edit { get; set; }

    /// <summary>
    /// 가동 중 여부
    /// </summary>
    public bool IsRunning => Run == 2 || Run == 3;

    /// <summary>
    /// 비상 정지 여부
    /// </summary>
    public bool IsEmergency => Emergency == 1;

    /// <summary>
    /// 알람 활성 여부
    /// </summary>
    public bool HasAlarm => Alarm == 1;

    /// <summary>
    /// 모드 문자열
    /// </summary>
    public string ModeString => Aut switch
    {
        0 => "MDI",
        1 => "MEM",
        3 => "EDIT",
        4 => "HANDLE",
        5 => "JOG",
        6 => "JOG_HANDLE",
        7 => "REF",
        _ => $"UNKNOWN({Aut})"
    };

    /// <summary>
    /// 실행 상태 문자열
    /// </summary>
    public string RunStateString => Run switch
    {
        0 => "STOP",
        1 => "HOLD",
        2 => "START",
        3 => "MSTR",
        4 => "RESTART",
        _ => $"UNKNOWN({Run})"
    };
}

public class ProgramInfo
{
    public int MainProgram { get; set; }
    public int CurrentProgram { get; set; }
    public int SequenceNumber { get; set; }
}

public class AxisPosition
{
    public int[] Values { get; set; } = Array.Empty<int>();
}

public class AlarmInfo
{
    public int AlarmNo { get; set; }
    public short Type { get; set; }
    public short Axis { get; set; }
    public string Message { get; set; } = "";

    public string Category => Type switch
    {
        0 => "SW",      // Software
        1 => "PW",      // Power
        2 => "IO",      // I/O
        3 => "PS",      // P/S (Programmable controller)
        4 => "OT",      // Overheat
        5 => "OH",      // Overtravel
        6 => "SV",      // Servo
        7 => "SR",      // Spindle
        8 => "MC",      // Other
        9 => "SP",      // Spindle
        10 => "DS",     // Data server
        11 => "IE",     // I/O link error
        12 => "BG",     // Background
        13 => "SN",     // SN
        _ => "UNKNOWN"
    };
}

#endregion
