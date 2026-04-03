using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Extensions.Logging;
using StarWebCNC.Agent.Mqtt;
using StarWebCNC.Agent.Template;

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
                _connection.NotifyFocasError(ret);
                return null;
            }

            // ODBST 필드명은 fwlib64.cs (비-ONO8D 기준):
            //   dummy[], aut, manual, run, edit, motion, mstb, emergency, alarm
            // tmmode / hdck 는 ONO8D 버전 전용 — 여기서는 0 처리
            return new CncStatus
            {
                Hdck     = 0,                  // non-ONO8D에는 없음
                Tmmode   = 0,                  // non-ONO8D에는 없음
                Aut      = statInfo.aut,
                Run      = statInfo.run,
                Motion   = statInfo.motion,
                Mstb     = statInfo.mstb,
                Emergency = statInfo.emergency,
                Alarm    = statInfo.alarm,
                Edit     = statInfo.edit,
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

    // cnc_absolute/cnc_machine에 axis=-1을 사용할 때 length는
    // "4 + (실제 제어축수) * 4" 여야 함. MAX_AXIS*4 를 전달하면 EW_LENGTH 반환.
    // → cnc_rddynamic(ODBDY_1) 으로 교체: 구조체 크기는 항상 올바르고
    //   absolute/machine/relative/distance + actf/acts 를 한 번에 가져옴.
    private const int DEFAULT_AXIS_COUNT = 4;

    /// <summary>
    /// 절대 좌표 읽기 — axis별 단건 읽기 (axis=-1 all-at-once는 DLL MAX_AXIS 불일치 시 EW_LENGTH)
    /// </summary>
    public AxisPosition? ReadAbsolutePosition()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            const short LEN = 8; // 4 header + 4 for one int
            var values = new int[DEFAULT_AXIS_COUNT];
            bool anyOk = false;
            for (int i = 0; i < DEFAULT_AXIS_COUNT; i++)
            {
                var pos = new Focas1.ODBAXIS();
                if (Focas1.cnc_absolute(_connection.Handle, (short)(i + 1), LEN, pos) == Focas1.EW_OK
                    && pos.data != null && pos.data.Length > 0)
                {
                    values[i] = pos.data[0];
                    anyOk = true;
                }
            }
            return anyOk ? new AxisPosition { Values = values } : null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading absolute position");
            return null;
        }
    }

    /// <summary>
    /// 기계 좌표 읽기 — axis별 단건 읽기
    /// </summary>
    public AxisPosition? ReadMachinePosition()
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            const short LEN = 8;
            var values = new int[DEFAULT_AXIS_COUNT];
            bool anyOk = false;
            for (int i = 0; i < DEFAULT_AXIS_COUNT; i++)
            {
                var pos = new Focas1.ODBAXIS();
                if (Focas1.cnc_machine(_connection.Handle, (short)(i + 1), LEN, pos) == Focas1.EW_OK
                    && pos.data != null && pos.data.Length > 0)
                {
                    values[i] = pos.data[0];
                    anyOk = true;
                }
            }
            return anyOk ? new AxisPosition { Values = values } : null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading machine position");
            return null;
        }
    }

    // ── cnc_rdexecprog 커스텀 P/Invoke ──────────────────────────────────────
    // UnmanagedType.AsAny는 .NET 8 미지원 → byte[] 직접 마샬링
    [DllImport("FWLIB64.dll", EntryPoint = "cnc_rdexecprog")]
    private static extern short CncRdExecProg(
        ushort handle,
        ref ushort length,    // in: 버퍼 크기, out: 실제 읽은 바이트 수
        out short blkNum,     // out: 블록 번호
        [Out] byte[] buffer   // out: 실행 블록 문자열 (ASCII)
    );

    // ── cnc_rdprogdir V1 커스텀 P/Invoke (raw IntPtr) ─────────────────────────
    // V2(cnc_rdprogdir2)는 일부 CNC 모델에서 TCP 응답 없이 무한 블로킹 발생.
    // V1은 ASCII 텍스트를 반환하며, IntPtr 버퍼로 직접 수신한다.
    [DllImport("FWLIB64.dll", EntryPoint = "cnc_rdprogdir")]
    private static extern short CncRdProgDirV1Raw(
        ushort handle,
        short  type,    // 0=O번호 순, 1=등록 순
        short  no_s,    // 시작 O번호 (0=처음부터)
        short  no_e,    // 종료 O번호 or 읽을 개수
        ushort length,  // 버퍼 크기(bytes)
        IntPtr buf      // OUT: ASCII text (O번호 목록)
    );

    // ── cnc_rdprogdir3 V3 커스텀 P/Invoke (raw IntPtr) ─────────────────────────
    // PRGDIR3_data (Pack=4) C 구조체 레이아웃:
    //   offset  0: int    number  (4B)
    //   offset  4: int    length  (4B) ← 프로그램 크기(bytes)
    //   offset  8: int    page    (4B)
    //   offset 12: char[52] comment (52B, ANSI null-terminated) ← 코멘트
    //   offset 64: DIR3_MDATE (6×short = 12B)
    //   offset 76: DIR3_CDATE (6×short = 12B)
    //   total: 88B/entry × 10 entries = 880B
    [DllImport("FWLIB64.dll", EntryPoint = "cnc_rdprogdir3")]
    private static extern short CncRdProgDir3Raw(
        ushort handle,
        short  type,      // 0=처음부터, 2=이어서
        ref short num,    // IN: 읽을 개수(최대 10), OUT: 실제 읽은 수
        ref short length, // IN: 버퍼 크기(bytes), OUT: 사용 안 함
        IntPtr data       // OUT: PRGDIR3 raw buffer
    );

    /// <summary>
    /// CNC 파라미터 No.1013 bit1(ISC)을 읽어 좌표 소수점 자릿수 반환
    /// ISC=0 → IS-B (0.001mm) → 3, ISC=1 → IS-C (0.0001mm) → 4
    /// </summary>
    public int ReadCoordinateDecimalPlaces()
    {
        if (!_connection.IsConnected) return 3;
        try
        {
            var param = new Focas1.IODBPSD();
            // No.1013은 축별(axis) 비트 파라미터 → axis=1(첫 번째 축)으로 읽어야 함
            // axis=0은 비축(non-axis) 전용이라 축별 파라미터엔 EW_ATTRIB 반환
            short ret = Focas1.cnc_rdparam(_connection.Handle, 1013, 1, 8, param);
            if (ret == Focas1.EW_OK)
            {
                // bit 1 = ISC: 0→IS-B(3자리), 1→IS-C(4자리)
                int isc = (param.u.cdata >> 1) & 1;
                _logger.LogInformation("Param 1013 raw byte=0x{Raw:X2}, ISC bit={Isc}", param.u.cdata, isc);
                return isc == 1 ? 4 : 3;
            }
            _logger.LogWarning("cnc_rdparam(1013) failed: ret={Ret} — defaulting to IS-B (3dp)", ret);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading coordinate decimal places (param 1013)");
        }
        return 3;
    }

    /// <summary>
    /// 경로별 상세 데이터 읽기 (프로그램 번호, 시퀀스, 절대좌표, F/S, 실행 블록 내용)
    /// 멀티-패스 CNC용: pathNo=1 → Path1(주축), pathNo=2 → Path2(부축)
    /// </summary>
    public PathData? ReadPathData(short pathNo, int coordinateDecimalPlaces = 3, int maxAxes = 0)
    {
        if (!_connection.IsConnected) return null;

        try
        {
            // 경로 전환 (Path2 이상일 때만)
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, pathNo);

            // 프로그램 번호
            var prgNum = new Focas1.ODBPRO();
            if (Focas1.cnc_rdprgnum(_connection.Handle, prgNum) != Focas1.EW_OK)
            {
                if (pathNo > 1) Focas1.cnc_setpath(_connection.Handle, 1);
                return null;
            }

            // 시퀀스 번호
            var seqNum = new Focas1.ODBSEQ();
            Focas1.cnc_rdseqnum(_connection.Handle, seqNum);

            // ── 축 이름 읽기 (실제 축수 자동 감지) ──────────────────────────
            // cnc_rdaxisname에 max=8 전달 → 반환된 axisCountShort = 실제 제어축수
            string[] axisNames = Array.Empty<string>();
            int actualAxisCount = 4; // fallback
            try
            {
                short axisNameCount = 8;
                var axisNameData = new Focas1.ODBAXISNAME();
                if (Focas1.cnc_rdaxisname(_connection.Handle, ref axisNameCount, axisNameData) == Focas1.EW_OK
                    && axisNameCount > 0)
                {
                    actualAxisCount = axisNameCount;
                    var allData = new[]
                    {
                        axisNameData.data1, axisNameData.data2,
                        axisNameData.data3, axisNameData.data4,
                        axisNameData.data5, axisNameData.data6,
                        axisNameData.data7,
                    };
                    axisNames = allData
                        .Take(actualAxisCount)
                        .Select(d =>
                        {
                            char n = (char)d.name;
                            char s = (char)d.suff;
                            return s != '\0' && s != ' ' ? $"{n}{s}" : $"{n}";
                        })
                        .Where(name => name.Trim().Length > 0 && name[0] != '\0')
                        .ToArray();
                    if (axisNames.Length > 0)
                        actualAxisCount = axisNames.Length;
                }
            }
            catch { /* 미지원 시 무시 */ }

            // MaxAxes 캡: 템플릿에서 지정된 경우 자동감지 값을 제한
            if (maxAxes > 0 && actualAxisCount > maxAxes)
            {
                actualAxisCount = maxAxes;
                if (axisNames.Length > maxAxes)
                    axisNames = axisNames.Take(maxAxes).ToArray();
            }

            // ── 좌표 읽기 (실제 축수만큼) ────────────────────────────────────
            const short SINGLE_AXIS_LEN = 8;
            var absolute = new int[actualAxisCount];
            var dtg      = new int[actualAxisCount];
            var decimalPlaces = Enumerable.Repeat(coordinateDecimalPlaces, actualAxisCount).ToArray();

            for (int i = 0; i < actualAxisCount; i++)
            {
                var axPos = new Focas1.ODBAXIS();
                if (Focas1.cnc_absolute(_connection.Handle, (short)(i + 1), SINGLE_AXIS_LEN, axPos) == Focas1.EW_OK
                    && axPos.data != null && axPos.data.Length > 0)
                    absolute[i] = axPos.data[0];

                var axDtg = new Focas1.ODBAXIS();
                if (Focas1.cnc_distance(_connection.Handle, (short)(i + 1), SINGLE_AXIS_LEN, axDtg) == Focas1.EW_OK
                    && axDtg.data != null && axDtg.data.Length > 0)
                    dtg[i] = axDtg.data[0];
            }

            // ── 실제 F/S 읽기 ────────────────────────────────────────────────
            int feedActual    = 0;
            int spindleActual = 0;
            var actf = new Focas1.ODBACT();
            if (Focas1.cnc_actf(_connection.Handle, actf) == Focas1.EW_OK)
                feedActual = actf.data;
            var acts = new Focas1.ODBACT();
            if (Focas1.cnc_acts(_connection.Handle, acts) == Focas1.EW_OK)
                spindleActual = acts.data;

            // ── G코드 모달 읽기 (그룹별 개별 읽기 → 5×4 그리드) ────────────
            // 배치 읽기(1~20)는 0i-TF T타입(14그룹)에서 EW_NUMBER 에러 발생.
            // 그룹 1~20을 개별로 읽어 지원 범위를 자동 감지.
            var gCodeGrid = new string[5][];
            for (int gi = 0; gi < 5; gi++) gCodeGrid[gi] = new[] {"","","",""};

            try
            {
                int filled = 0;
                for (short grp = 1; grp <= 20 && filled < 20; grp++)
                {
                    var gcd1 = new Focas1.ODBGCD();
                    short cnt = 1;
                    short ret = Focas1.cnc_rdgcode(_connection.Handle, grp, grp, ref cnt, gcd1);
                    if (ret != Focas1.EW_OK) continue;  // 해당 그룹 미지원 → 건너뜀
                    if (cnt == 0) continue;

                    // flag != 0: one-shot G코드(이미 실행됨) → 표시 제외
                    if (gcd1.gcd0.flag != 0) continue;

                    string code = gcd1.gcd0.code?.Trim().Trim('\0').Trim() ?? "";
                    if (string.IsNullOrEmpty(code)) continue;

                    int row = filled / 4, col = filled % 4;
                    if (row < 5) gCodeGrid[row][col] = code;
                    filled++;
                }

                if (filled > 0)
                    _logger.LogDebug("G코드 모달 path={Path}: {Filled}개", pathNo, filled);
                else
                    _logger.LogDebug("G코드 모달 path={Path}: 없음 (cnc_rdgcode 미지원 또는 미실행)", pathNo);
            }
            catch (Exception ex) { _logger.LogWarning(ex, "cnc_rdgcode read failed path={Path}", pathNo); }

            // ── 실행 중인 NC 블록 읽기 ──────────────────────────────────────
            // cnc_rdexecprog: 경로 전환(cnc_setpath) 후 해당 경로 블록 반환
            string[] programContent = Array.Empty<string>();
            try
            {
                ushort bufLen = 256;
                var buf = new byte[bufLen];
                if (CncRdExecProg(_connection.Handle, ref bufLen, out _, buf) == Focas1.EW_OK && bufLen > 0)
                {
                    var raw = Encoding.ASCII.GetString(buf, 0, bufLen).Trim('\0').Trim();
                    if (!string.IsNullOrEmpty(raw))
                    {
                        var lines = raw
                            .Split(new[] { '\n', '\r', ';' }, StringSplitOptions.RemoveEmptyEntries)
                            .Select(l => l.Trim())
                            .Where(l => !string.IsNullOrEmpty(l)
                                && l != "%"
                                && !System.Text.RegularExpressions.Regex.IsMatch(l, @"^O\d+%?$"))
                            .Take(6)
                            .ToArray();

                        if (lines.Length > 0)
                        {
                            lines[0] = ">" + lines[0];
                            programContent = lines;
                        }
                    }
                }
            }
            catch { /* cnc_rdexecprog 미지원 모델이면 무시 */ }

            // 상태 문자열
            var statInfo = new Focas1.ODBST();
            string pathStatus = "---- ---- ---- ---";
            if (Focas1.cnc_statinfo(_connection.Handle, statInfo) == Focas1.EW_OK)
                pathStatus = BuildPathStatus(statInfo);

            // 경로 복원
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, 1);

            return new PathData
            {
                ProgramNo = $"O{prgNum.data:D4}",
                BlockNo   = $"N{seqNum.data:D5}",
                ProgramContent = programContent,
                CurrentLine = 0,
                AxisNames = axisNames,
                Coordinates = new PathCoordinates
                {
                    Absolute      = absolute,
                    DistanceToGo  = dtg,
                    DecimalPlaces = decimalPlaces,
                },
                Modal = new PathModal
                {
                    GCodeGrid     = gCodeGrid,
                    FeedActual    = feedActual,
                    SpindleActual = spindleActual,
                },
                PathStatus = pathStatus,
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading path {PathNo} data", pathNo);
            try { if (pathNo > 1) Focas1.cnc_setpath(_connection.Handle, 1); } catch { }
            return null;
        }
    }

    private static string BuildPathStatus(Focas1.ODBST stat)
    {
        var mode = stat.aut switch
        {
            0 => "MDI ", 1 => "MEM ", 3 => "EDIT", 4 => "HND ", 5 => "JOG ", _ => "----"
        };
        var run = stat.run switch
        {
            3 => "STRT", 4 => "HOLD", _ => "****"
        };
        return $"{mode} {run} ---- ---";
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
            // cnc_rdalmmsg2 는 ODBALMMSG2 단일 구조체 (내부에 msg1..msg10)를 받음
            // 배열이 아님에 주의
            short num    = 10;
            var alarmMsg = new Focas1.ODBALMMSG2();

            short ret = Focas1.cnc_rdalmmsg2(_connection.Handle, -1, ref num, alarmMsg);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_rdalmmsg2 failed: {ErrorCode}", ret);
                return alarms;
            }

            // ODBALMMSG2는 msg1..msg10 으로 접근
            var msgs = new Focas1.ODBALMMSG2_data[]
            {
                alarmMsg.msg1, alarmMsg.msg2, alarmMsg.msg3, alarmMsg.msg4, alarmMsg.msg5,
                alarmMsg.msg6, alarmMsg.msg7, alarmMsg.msg8, alarmMsg.msg9, alarmMsg.msg10,
            };

            for (int i = 0; i < num && i < msgs.Length; i++)
            {
                var m = msgs[i];
                if (m.alm_no != 0)
                {
                    alarms.Add(new AlarmInfo
                    {
                        AlarmNo = m.alm_no,
                        Type    = m.type,
                        Axis    = m.axis,
                        Message = m.alm_msg?.TrimEnd('\0') ?? "",
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
    /// 오퍼레이터 메시지 읽기 (cnc_rdopmsg3)
    /// NC 프로그램(#3006), 외부 신호, PMC 매크로 등에서 발생한 메시지
    /// </summary>
    public List<OperatorMessageInfo> ReadOperatorMessages()
    {
        var result = new List<OperatorMessageInfo>();
        if (!_connection.IsConnected)
            return result;

        try
        {
            short num = 5; // OPMSG3는 msg1..msg5까지 최대 5개
            var opmsg = new Focas1.OPMSG3();

            short ret = Focas1.cnc_rdopmsg3(_connection.Handle, -1, ref num, opmsg);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogDebug("cnc_rdopmsg3 ret={Ret}", ret);
                return result;
            }
            if (num == 0)
                return result;

            var msgs = new Focas1.OPMSG3_data[] { opmsg.msg1, opmsg.msg2, opmsg.msg3, opmsg.msg4, opmsg.msg5 };
            for (int i = 0; i < num && i < msgs.Length; i++)
            {
                var m = msgs[i];
                if (m.char_num <= 0) continue;
                var text = m.data?.TrimEnd('\0', ' ') ?? "";
                if (string.IsNullOrWhiteSpace(text)) continue;
                _logger.LogInformation("OperatorMsg[{i}]: no={No} type={T} msg={Msg}", i, m.datano, m.type, text);
                result.Add(new OperatorMessageInfo
                {
                    Number  = m.datano,
                    MsgType = m.type,
                    Message = text,
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading operator messages");
        }

        return result;
    }

    /// <summary>
    /// 오퍼레이터 메시지 읽기 (cnc_rdopmsg2) — NON-BLOCKING 설계
    /// PMC 래더 외부 메시지(type=0) 및 #3006 매크로 메시지(type=1) 포함.
    /// rdopmsg3과 달리 ref 파라미터가 없어 CNC 대기 상태에서도 즉시 반환이 기대됨.
    /// ⚠ 실기기에서 blocking 여부를 직접 확인할 것 (ProbeOpMsg2 결과 참조)
    /// </summary>
    public List<OperatorMessageInfo> ReadOperatorMessages2()
    {
        var result = new List<OperatorMessageInfo>();
        if (!_connection.IsConnected)
            return result;

        try
        {
            // 먼저 cnc_rdopmsg2 (64자) 시도 — type=0(외부), type=1(매크로#3006)
            bool anyOk = false;
            foreach (short msgType in new short[] { 0, 1 })
            {
                var buf2 = new Focas1.OPMSG2();
                short ret2 = Focas1.cnc_rdopmsg2(_connection.Handle, msgType, 1, buf2);
                if (ret2 != Focas1.EW_OK) continue;
                anyOk = true;
                var m2 = buf2.msg1;
                if (m2.char_num <= 0) continue;
                var text2 = m2.data?.TrimEnd('\0', ' ') ?? "";
                if (string.IsNullOrWhiteSpace(text2)) continue;
                result.Add(new OperatorMessageInfo { Number = m2.datano, MsgType = m2.type, Message = text2 });
            }

            // cnc_rdopmsg2가 모두 EW_PARAM 등으로 실패할 경우 cnc_rdopmsg (v1, 129자)로 폴백
            // v1은 구조체에 msg1~msg5 5개 슬롯이 있어 n=5 필요 (n=1이면 EW_LENGTH)
            if (!anyOk)
            {
                foreach (short msgType in new short[] { 0, 1 })
                {
                    var buf1 = new Focas1.OPMSG();
                    short ret1 = Focas1.cnc_rdopmsg(_connection.Handle, msgType, 5, buf1);
                    if (ret1 != Focas1.EW_OK) continue;
                    foreach (var m1 in new[] { buf1.msg1, buf1.msg2, buf1.msg3, buf1.msg4, buf1.msg5 })
                    {
                        if (m1.char_num <= 0) continue;
                        var text1 = m1.data?.TrimEnd('\0', ' ') ?? "";
                        if (string.IsNullOrWhiteSpace(text1)) continue;
                        result.Add(new OperatorMessageInfo { Number = m1.datano, MsgType = m1.type, Message = text1 });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading operator messages (rdopmsg/rdopmsg2)");
        }

        return result;
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

    // FANUC FOCAS2 pmc_rdpmcrng type_no 코드
    // 0=G, 1=F, 2=Y, 3=X, 4=A, 5=R, 6=T, 7=K, 8=C, 9=D, 10=M, 11=N, 12=E, 13=Z
    private static readonly Dictionary<string, short> PmcTypeCode = new(StringComparer.OrdinalIgnoreCase)
    {
        { "G", 0 }, { "F", 1 }, { "Y", 2 }, { "X", 3 },
        { "A", 4 }, { "R", 5 }, { "T", 6 }, { "K", 7 },
        { "C", 8 }, { "D", 9 },
    };

    /// <summary>
    /// PMC 단일 비트 읽기 (TopBar 인터락 pills용)
    /// PmcAddress.Type에 따라 해당 영역 1바이트 읽고 비트 추출
    /// </summary>
    /// <returns>0 또는 1, 연결 없거나 오류 시 null</returns>
    public int? ReadPmcBit(PmcAddress addr)
    {
        if (!_connection.IsConnected)
            return null;

        if (!PmcTypeCode.TryGetValue(addr.Type, out short typeNo))
        {
            _logger.LogWarning("Unsupported PMC type: {Type}", addr.Type);
            return null;
        }

        try
        {
            var pmcData = new Focas1.IODBPMC0();
            short ret = Focas1.pmc_rdpmcrng(
                _connection.Handle,
                typeNo,
                0, // 데이터 타입 (바이트)
                (ushort)addr.Address,
                (ushort)addr.Address,
                (ushort)(8 + 1),
                pmcData);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("[DIAG] pmc_rdpmcrng({Type}{Addr}) failed: {ErrorCode}", addr.Type, addr.Address, ret);
                return null;
            }

            var b = pmcData.cdata?[0] ?? 0;
            return (b >> addr.Bit) & 1;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading PMC bit {Type}{Addr}.{Bit}", addr.Type, addr.Address, addr.Bit);
            return null;
        }
    }

    /// <summary>
    /// PMC 영역 byte/word/dword 읽기 (pcode/ddata 공구수명 변수용)
    /// areaType: "D", "R", "G", "F", "Y", "X", "A", "T", "K", "C"
    /// dataType: "byte"(1B), "word"(2B), "dword"(4B)
    /// </summary>
    public long? ReadPmcAreaValue(string areaType, int address, string dataType)
    {
        if (!_connection.IsConnected) return null;
        if (!PmcTypeCode.TryGetValue(areaType, out short typeNo)) return null;

        int byteLen = dataType switch { "word" => 2, "dword" => 4, _ => 1 };
        try
        {
            var pmcData = new Focas1.IODBPMC0();
            short ret = Focas1.pmc_rdpmcrng(
                _connection.Handle,
                typeNo,
                0, // byte 단위 읽기
                (ushort)address,
                (ushort)(address + byteLen - 1),
                (ushort)(8 + byteLen),
                pmcData);
            if (ret != Focas1.EW_OK) return null;

            var bytes = pmcData.cdata?.Take(byteLen).ToArray();
            if (bytes == null || bytes.Length < byteLen) return null;

            return byteLen switch
            {
                4 => BitConverter.ToUInt32(bytes, 0),
                2 => BitConverter.ToUInt16(bytes, 0),
                _ => bytes[0],
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ReadPmcAreaValue {Type}{Addr} failed", areaType, address);
            return null;
        }
    }

    /// <summary>
    /// PMC 영역 byte/word/dword 쓰기 (pcode/ddata 공구수명 변수용)
    /// </summary>
    public bool WritePmcAreaValue(string areaType, int address, string dataType, long value)
    {
        if (!_connection.IsConnected) return false;
        if (!PmcTypeCode.TryGetValue(areaType, out short typeNo)) return false;

        int byteLen = dataType switch { "word" => 2, "dword" => 4, _ => 1 };
        byte[] bytes = byteLen switch
        {
            4 => BitConverter.GetBytes((uint)value),
            2 => BitConverter.GetBytes((ushort)value),
            _ => new byte[] { (byte)value },
        };

        try
        {
            var pmcData = new Focas1.IODBPMC0();
            pmcData.type_a   = typeNo;
            pmcData.type_d   = 0;
            pmcData.datano_s = (short)address;
            pmcData.datano_e = (short)(address + byteLen - 1);
            pmcData.cdata    = new byte[5];
            Array.Copy(bytes, pmcData.cdata, byteLen);

            short ret = Focas1.pmc_wrpmcrng(_connection.Handle, (ushort)(8 + byteLen), pmcData);
            return ret == Focas1.EW_OK;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WritePmcAreaValue {Type}{Addr} failed", areaType, address);
            return false;
        }
    }

    /// <summary>
    /// PMC 단일 비트 쓰기
    /// pmc_rdpmcrng(읽기)가 EW_HANDLE(-8)을 반환하는 문제 회피 —
    /// 읽기 단계 없이 pmc_wrpmcrng(쓰기) 전용으로 처리.
    /// 해당 바이트의 목표 비트만 1로 세팅하여 쓰기 (나머지 비트는 0).
    /// 조작반 출력 영역(R6100-R6109)은 각 버튼 신호가 독립적이므로 안전.
    /// </summary>
    public bool WritePmcBit(PmcAddress addr, int bitValue)
    {
        // pmc_wrpmcrng 경로(WritePmcAreaValue)만 사용 — pmc_rdpmcrng 없이 직접 쓰기
        byte byteToWrite = bitValue != 0
            ? (byte)(1 << addr.Bit)
            : (byte)0;

        bool ok = WritePmcAreaValue(addr.Type, addr.Address, "byte", byteToWrite);
        if (!ok)
            _logger.LogWarning("WritePmcBit write failed: {Type}{Addr}.{Bit}={Val}", addr.Type, addr.Address, addr.Bit, bitValue);
        return ok;
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

            // FOCAS 매크로 변수: mcr_val * 10^(-dec_val)
            // ODBM 필드: mcr_val (int), dec_val (short)
            return macro.mcr_val * Math.Pow(10, -macro.dec_val);
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
    /// P-code 매크로 변수 쓰기 (cnc_wrpmacro — int varNo, #10000+ 지원)
    /// </summary>
    public bool WritePcodeMacroVariable(int variableNo, double value)
    {
        if (!_connection.IsConnected)
            return false;

        try
        {
            int decimalPlaces = 0;
            double temp = value;
            while (temp != Math.Floor(temp) && decimalPlaces < 9)
            {
                temp *= 10;
                decimalPlaces++;
            }

            int intValue = (int)(value * Math.Pow(10, decimalPlaces));

            short ret = Focas1.cnc_wrpmacro(
                _connection.Handle,
                variableNo,
                intValue,
                (short)decimalPlaces);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_wrpmacro failed: varNo={VarNo} error={ErrorCode}", variableNo, ret);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error writing P-code macro variable {VariableNo}", variableNo);
            return false;
        }
    }

    /// <summary>
    /// 파츠 카운터 읽기 (varType에 따라 macro/pcode 선택)
    /// </summary>
    public int? ReadPartsCount(int macroVariableNo, string varType = "macro")
    {
        double? value = string.Equals(varType, "pcode", StringComparison.OrdinalIgnoreCase)
            ? ReadPcodeMacroVariable(macroVariableNo)
            : ReadMacroVariable(macroVariableNo);
        return value.HasValue ? (int)value.Value : null;
    }

    /// <summary>
    /// P코드 매크로 변수 읽기 (cnc_rdpmacro) — P코드 전용 변수 영역
    /// </summary>
    public double? ReadPcodeMacroVariable(int variableNo)
    {
        if (!_connection.IsConnected) return null;
        try
        {
            var macro = new Focas1.ODBPM();
            short ret = Focas1.cnc_rdpmacro(_connection.Handle, variableNo, macro);
            if (ret != Focas1.EW_OK) return null;
            return macro.mcr_val * Math.Pow(10, -macro.dec_val);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading P-code macro variable {VariableNo}", variableNo);
            return null;
        }
    }

    /// <summary>
    /// 사이클타임 읽기 (PMC D 어드레스 — 래더 실행 주기 횟수)
    /// addrStr: "D96" 형식, multiplier: 파라미터 No.11930 설정값 (4 또는 8ms)
    /// 반환값: 밀리초 (ms). 오류 시 null.
    /// </summary>
    public double? ReadCycleTimeMs(string addrStr, int multiplier)
    {
        if (string.IsNullOrWhiteSpace(addrStr)) return null;
        // "D96" → type="D", address=96
        var upper = addrStr.Trim().ToUpper();
        if (upper.Length < 2) return null;
        string areaType = upper[0].ToString();
        if (!int.TryParse(upper[1..], out int address)) return null;

        var raw = ReadPmcAreaValue(areaType, address, "word");
        if (raw == null) return null;
        return (double)raw.Value * multiplier;
    }

    // ── NC 데이터 (Offset / Counter / Tool-Life) ───────────────

    /// <summary>
    /// 마모 오프셋 읽기 (FANUC 표준 매크로 변수 범위)
    /// X: #2001~#2064, Y: #2401~#2464, Z: #2101~#2164, R: #2201~#2264
    /// pathNo: 1=Path1, 2=Path2 (멀티-패스 시 cnc_setpath로 경로 전환)
    /// </summary>
    public List<WearOffsetEntry>? ReadWearOffsets(int pathNo, int toolCount = 64)
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, (short)pathNo);

            // FANUC 표준: 축별 독립 범위
            const int BaseX = 2001;
            const int BaseY = 2401;
            const int BaseZ = 2101;
            const int BaseR = 2201;

            var result = new List<WearOffsetEntry>(toolCount);
            for (int t = 0; t < toolCount; t++)
            {
                result.Add(new WearOffsetEntry
                {
                    No = t + 1,
                    X  = ReadMacroVariableSafe(BaseX + t),
                    Y  = ReadMacroVariableSafe(BaseY + t),
                    Z  = ReadMacroVariableSafe(BaseZ + t),
                    R  = ReadMacroVariableSafe(BaseR + t),
                });
            }

            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, 1);

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading wear offsets path={PathNo}", pathNo);
            return null;
        }
    }

    /// <summary>
    /// 마모 오프셋 쓰기 (단일 항목)
    /// axis: "X"=>#2001+t, "Y"=>#2401+t, "Z"=>#2101+t, "R"=>#2201+t
    /// </summary>
    public bool WriteWearOffset(int pathNo, int toolNo, int axisIdx, double value)
    {
        if (!_connection.IsConnected)
            return false;

        try
        {
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, (short)pathNo);

            // FANUC 표준 마모 오프셋 매크로 변수 번호
            // axisIdx: 0=X, 1=Y, 2=Z, 3=R
            int varNo = axisIdx switch
            {
                0 => 2001 + (toolNo - 1), // X
                1 => 2401 + (toolNo - 1), // Y
                2 => 2101 + (toolNo - 1), // Z
                3 => 2201 + (toolNo - 1), // R
                _ => throw new ArgumentOutOfRangeException(nameof(axisIdx)),
            };
            bool ok = WriteMacroVariable(varNo, value);

            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, 1);

            return ok;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error writing wear offset T{ToolNo} axis={Axis} path={Path}",
                toolNo, axisIdx, pathNo);
            return false;
        }
    }

    /// <summary>
    /// 매크로 변수 안전 읽기 (실패 시 0.0 반환)
    /// </summary>
    public double ReadMacroVariableSafe(int varNo)
        => ReadMacroVariable(varNo) ?? 0.0;

    /// <summary>
    /// 카운터/기타 변수 배치 읽기 (CounterConfig.fields 기반)
    /// </summary>
    public List<CounterVarResult> ReadCounterVars(IEnumerable<CounterFieldParam> fields)
    {
        var result = new List<CounterVarResult>();
        foreach (var f in fields)
        {
            double val = 0.0;
            if (f.VarType == "macro")
                val = ReadMacroVariableSafe(f.VarNo);
            // pcode: 미구현 (추후 확장)
            result.Add(new CounterVarResult { Key = f.Key, VarNo = f.VarNo, Value = val });
        }
        return result;
    }

    // ── 프로그램 선택 / 선두 복귀 ────────────────────────────────

    /// <summary>
    /// 프로그램 번호로 활성 프로그램 변경 (cnc_search)
    /// memory 모드 스케줄러 행 시작 시 호출
    /// </summary>
    public bool SearchProgram(int programNo, int pathNo = 1)
    {
        if (!_connection.IsConnected) return false;
        try
        {
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, (short)pathNo);

            short ret = Focas1.cnc_search(_connection.Handle, (short)programNo);

            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, 1);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_search O{No:D4} (path={Path}) failed: EW={Ret}", programNo, pathNo, ret);
                return false;
            }
            _logger.LogInformation("cnc_search O{No:D4} (path={Path}) OK", programNo, pathNo);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "cnc_search O{No:D4} exception", programNo);
            return false;
        }
    }

    /// <summary>
    /// 프로그램 선두 복귀 (cnc_rewind) + 시퀀스 번호 0 확인
    /// pathNo: 1=Path1(기본), 2=Path2
    /// </summary>
    public bool RewindProgram(int pathNo = 1)
    {
        if (!_connection.IsConnected) return false;
        try
        {
            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, (short)pathNo);

            short ret = Focas1.cnc_rewind(_connection.Handle);

            // Path2인 경우: cnc_statinfo는 반드시 setpath(1) 복귀 전에 읽어야 Path2 상태를 얻음
            int runVal = -1;
            int seqAfter = -1;

            var runState = new Focas1.ODBST();
            if (Focas1.cnc_statinfo(_connection.Handle, runState) == Focas1.EW_OK)
                runVal = runState.run;

            var seqNum = new Focas1.ODBSEQ();
            if (Focas1.cnc_rdseqnum(_connection.Handle, seqNum) == Focas1.EW_OK)
                seqAfter = seqNum.data;

            if (pathNo > 1)
                Focas1.cnc_setpath(_connection.Handle, 1);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_rewind path={Path} failed: EW={Ret}", pathNo, ret);
                return false;
            }

            // run 상태별 해석:
            //   run=0(STOP)  → 정지 상태: cnc_rewind가 즉시 선두 복귀. seqNo는 마지막 실행 N번호 보존(무시)
            //   run=1(HOLD)  → Feed Hold(일시정지): cnc_rewind EW_OK = 선두 복귀 예약됨.
            //                   다음 사이클 스타트 시 선두부터 실행 → 성공으로 처리
            //   run=2(START) → 실행 중: rewind 예약. seqNo=0이면 이미 선두, 아니면 미완료
            if (runVal == 0)
            {
                // STOP 상태: 즉시 선두 복귀됨 (seqNo는 마지막 실행 위치이므로 무시)
                _logger.LogInformation(
                    "cnc_rewind path={Path} OK — run=STOP, seqNo={Seq} (선두 복귀 완료)",
                    pathNo, seqAfter);
            }
            else if (runVal == 1)
            {
                // HOLD(Feed Hold) 상태: EW_OK = 선두 복귀 예약 완료. 사이클 스타트 시 선두부터 실행됨
                _logger.LogInformation(
                    "cnc_rewind path={Path} OK — run=HOLD, seqNo={Seq} (HOLD=사이클스타트 시 선두부터 실행됨)",
                    pathNo, seqAfter);
            }
            else if (seqAfter == 0)
            {
                // 실행 중이지만 seqNo=0 → 이미 선두
                _logger.LogInformation(
                    "cnc_rewind path={Path} OK — run={Run}, seqNo=0 (선두 확인됨)",
                    pathNo, runVal);
            }
            else
            {
                // 실행 중(run=2)이고 seqNo!=0 → 아직 이전 사이클 실행 중, 선두 복귀 불가
                _logger.LogWarning(
                    "cnc_rewind path={Path} EW_OK but run={Run}, seqNo={Seq} → 실행 중 선두 복귀 미완료",
                    pathNo, runVal, seqAfter);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "cnc_rewind path={Path} exception", pathNo);
            try { if (pathNo > 1) Focas1.cnc_setpath(_connection.Handle, 1); } catch { }
            return false;
        }
    }

    // ── 프로그램 파일 관리 ──────────────────────────────────────

    /// <summary>
    /// CNC 메모리 내 프로그램 목록 조회 (cnc_rdprogdir V1)
    /// V2(cnc_rdprogdir2)는 일부 CNC 모델에서 응답 없이 무한 블로킹되므로
    /// V1을 사용한다. V1은 ASCII 텍스트("O0001 O0002 ...") 형식으로 반환.
    /// </summary>
    public List<ProgramDirectoryEntry>? ListPrograms()
    {
        if (!_connection.IsConnected)
            return null;

        const int BufSize = 8192; // V1 최대 반환 크기 (여유있게)
        IntPtr buf = IntPtr.Zero;
        try
        {
            buf = Marshal.AllocHGlobal(BufSize);
            // 버퍼 클리어
            for (int z = 0; z < BufSize; z++)
                Marshal.WriteByte(buf, z, 0);

            _logger.LogInformation("cnc_rdprogdir V1 calling...");

            // type=0(O번호 순), no_s=0(처음부터), no_e=9999(O9999까지)
            short ret = CncRdProgDirV1Raw(
                _connection.Handle,
                0,        // type: 0=O번호 순
                0,        // no_s: 처음부터
                9999,     // no_e: O9999까지
                (ushort)BufSize,
                buf);

            _logger.LogInformation("cnc_rdprogdir V1 returned: EW={Ret}", ret);

            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_rdprogdir V1 failed: EW={ErrorCode}", ret);
                return null;
            }

            // ASCII 텍스트 파싱 — "O0001 O0002 ..." or "O0001\nO0002\n..."
            var rawBytes = new byte[BufSize];
            Marshal.Copy(buf, rawBytes, 0, BufSize);
            // null 종단 위치 찾기
            int termAt = Array.IndexOf(rawBytes, (byte)0);
            int textLen = termAt >= 0 ? termAt : BufSize;
            string text = Encoding.ASCII.GetString(rawBytes, 0, textLen);
            _logger.LogInformation("cnc_rdprogdir V1 raw text (first 200): [{Text}]",
                text.Length > 200 ? text[..200] : text);

            var result = new List<ProgramDirectoryEntry>();
            // O번호 + 선택적 코멘트 패턴: O뒤에 숫자, 그 뒤 공백·탭 후 괄호 코멘트 (있으면)
            // 예: "O0001(MAIN PROG)" 또는 "O0001 (MAIN PROG)" 또는 "O0001"
            var matches = System.Text.RegularExpressions.Regex.Matches(
                text, @"O(\d{1,8})[\s\t]*(?:\(([^)]*)\))?");
            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                if (!int.TryParse(m.Groups[1].Value, out int number) || number == 0)
                    continue;
                string comment = m.Groups[2].Success ? m.Groups[2].Value.Trim() : string.Empty;
                result.Add(new ProgramDirectoryEntry
                {
                    ProgramNo = $"O{number:D4}",
                    Number    = (short)number,
                    Size      = 0,
                    Comment   = comment,
                });
            }

            _logger.LogInformation("ListPrograms: found {Count} programs", result.Count);
            // cnc_rdprogdir3(V3) / cnc_rdprogdir2(V2) 모두 이 CNC에서 TCP 블로킹 발생.
            // V1 ASCII 텍스트에 코멘트가 포함된 경우 위 정규식으로 추출. 없으면 빈 문자열.
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error listing programs");
            return null;
        }
        finally
        {
            if (buf != IntPtr.Zero)
                Marshal.FreeHGlobal(buf);
        }
    }

    /// <summary>
    /// V3 API로 프로그램 목록의 사이즈 + 코멘트를 보강한다.
    /// cnc_rdprogdir3가 EW_OK를 반환하면 result를 업데이트하고, 실패하면 무시.
    /// PRGDIR3_data (Pack=4) 레이아웃:
    ///   offset  0: int    number  (4B)
    ///   offset  4: int    length  (4B) = 프로그램 크기(bytes)
    ///   offset  8: int    page    (4B)
    ///   offset 12: char[52] comment (52B, ANSI)
    ///   offset 64: DIR3_MDATE 12B + DIR3_CDATE 12B
    ///   total: 88B/entry
    /// </summary>
    private void TryEnrichWithV3(List<ProgramDirectoryEntry> result)
    {
        const int EntrySize  = 88;
        const int MaxPerPage = 10;
        const int BufSize    = EntrySize * MaxPerPage + 64; // 여유 포함
        IntPtr buf = IntPtr.Zero;
        try
        {
            buf = Marshal.AllocHGlobal(BufSize);
            // number → index 맵
            var byNumber = new Dictionary<int, int>();
            for (int i = 0; i < result.Count; i++)
                byNumber[result[i].Number] = i;

            short type = 0;
            while (true)
            {
                short readNum = MaxPerPage;
                short readLen = BufSize;
                Marshal.Copy(new byte[BufSize], 0, buf, BufSize);

                short ret = CncRdProgDir3Raw(_connection.Handle, type, ref readNum, ref readLen, buf);

                if (ret != Focas1.EW_OK)
                {
                    if (type == 0) // 첫 호출 실패 = V3 미지원 또는 블로킹 후 오류
                        _logger.LogWarning("cnc_rdprogdir3 failed (type={Type}): EW={Ret} — 코멘트 없이 계속", type, ret);
                    break;
                }
                if (readNum == 0) break;

                for (int i = 0; i < readNum && i < MaxPerPage; i++)
                {
                    int    number  = Marshal.ReadInt32(buf, i * EntrySize + 0);
                    int    length  = Marshal.ReadInt32(buf, i * EntrySize + 4);
                    var    cb      = new byte[52];
                    Marshal.Copy(buf + i * EntrySize + 12, cb, 0, 52);
                    string comment = Encoding.ASCII.GetString(cb).TrimEnd('\0', ' ');

                    if (number != 0 && byNumber.TryGetValue((short)number, out int idx))
                    {
                        result[idx].Size    = length;
                        result[idx].Comment = comment;
                    }
                }

                if (readNum < MaxPerPage) break;
                type = 2;
            }
            _logger.LogInformation("V3 enrich complete");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TryEnrichWithV3 failed — 코멘트 없이 계속");
        }
        finally
        {
            if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
        }
    }

    /// <summary>
    /// NC 프로그램 전송 (PC → CNC, FOCAS "download")
    /// content: % ~ % 형식의 NC 텍스트
    /// </summary>
    public Task<bool> UploadProgramAsync(string content) => Task.FromResult(UploadProgramSync(content));

    private bool UploadProgramSync(string content)
    {
        if (!_connection.IsConnected)
            return false;

        try
        {
            string nc = PrepareNcContent(content);

            // 다운로드 시작 (type=0: CNC 메모리)
            short ret = Focas1.cnc_dwnstart3(_connection.Handle, 0);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_dwnstart3 failed: {ErrorCode}", ret);
                return false;
            }

            // 256바이트 청크 단위 전송
            const int ChunkSize = 256;
            int offset  = 0;
            int retries = 0;
            const int MaxRetries = 200;

            while (offset < nc.Length)
            {
                int chunkLen = Math.Min(ChunkSize, nc.Length - offset);
                string chunk = nc.Substring(offset, chunkLen);
                int length   = chunkLen;

                ret = Focas1.cnc_download3(_connection.Handle, ref length, chunk);

                if (ret == Focas1.EW_OK)
                {
                    offset += length > 0 ? length : chunkLen;
                    retries = 0;
                }
                else if (ret == 10) // EW_BUFFER: CNC 버퍼 꽉 참
                {
                    if (++retries >= MaxRetries)
                    {
                        _logger.LogWarning("cnc_download3: buffer full timeout");
                        Focas1.cnc_dwnend3(_connection.Handle);
                        return false;
                    }
                    Thread.Sleep(20); // FOCAS 스레드 유지
                }
                else
                {
                    _logger.LogWarning("cnc_download3 failed: {ErrorCode}", ret);
                    Focas1.cnc_dwnend3(_connection.Handle);
                    return false;
                }
            }

            // 다운로드 종료
            ret = Focas1.cnc_dwnend3(_connection.Handle);
            if (ret != Focas1.EW_OK)
            {
                _logger.LogWarning("cnc_dwnend3 failed: {ErrorCode}", ret);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error uploading program to CNC");
            return false;
        }
    }

    /// <summary>
    /// NC 프로그램 수신 (CNC → PC, FOCAS "upload")
    /// </summary>
    public Task<string?> DownloadProgramAsync(int programNo) => Task.FromResult(DownloadProgramSync(programNo));

    /// <summary>
    /// 백업용: 예외 없이 프로그램 내용을 반환 (EDIT 모드 아닐 경우 null 반환)
    /// </summary>
    public string? TryDownloadProgram(int programNo)
    {
        try { return DownloadProgramSync(programNo); }
        catch { return null; }
    }

    private string? DownloadProgramSync(int programNo)
    {
        if (!_connection.IsConnected)
            return null;

        try
        {
            // 업로드 시작 (type=0: CNC 메모리)
            short ret = Focas1.cnc_upstart3(_connection.Handle, 0, programNo, 0);
            if (ret != Focas1.EW_OK)
            {
                string hint = ret == 5 ? " (EW_FUNC: CNC가 EDIT 모드가 아닌 경우 발생)" : "";
                _logger.LogWarning("cnc_upstart3 failed: EW={ErrorCode}{Hint} for O{ProgramNo:D4}",
                    ret, hint, programNo);
                throw new InvalidOperationException($"EW_FUNC:{ret}"); // CommandHandler에서 에러코드로 변환
            }

            var sb      = new System.Text.StringBuilder(4096);
            var buf     = new char[256];
            int retries = 0;
            const int MaxRetries = 500;

            while (true)
            {
                int length = buf.Length;
                ret = Focas1.cnc_upload3(_connection.Handle, ref length, buf);

                if (ret == Focas1.EW_OK)
                {
                    if (length > 0)
                        sb.Append(buf, 0, length);

                    retries = 0;

                    // % で始まり % で終わる NC プログラム全体を受信したか確認
                    string text     = sb.ToString();
                    int firstPct    = text.IndexOf('%');
                    int secondPct   = firstPct >= 0 ? text.IndexOf('%', firstPct + 1) : -1;
                    if (secondPct >= 0)
                        break;
                }
                else if (ret == 10) // EW_BUFFER: CNC 데이터 준비 중
                {
                    if (++retries >= MaxRetries)
                    {
                        _logger.LogWarning("cnc_upload3: timeout for O{ProgramNo:D4}", programNo);
                        break;
                    }
                    Thread.Sleep(10); // FOCAS 스레드 유지 (Task.Delay 쓰면 ThreadPool로 이탈)
                }
                else
                {
                    _logger.LogWarning("cnc_upload3 ended with: {ErrorCode}", ret);
                    break;
                }
            }

            Focas1.cnc_upend3(_connection.Handle);

            return sb.Length > 0 ? sb.ToString() : null;
        }
        catch (InvalidOperationException)
        {
            throw; // CommandHandler에서 에러코드로 변환 (예: CNC_NOT_IN_EDIT_MODE)
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error downloading program O{ProgramNo:D4}", programNo);
            return null;
        }
    }

    /// <summary>
    /// NC 프로그램 포맷 보정
    /// FANUC 포맷: % LF O번호 ... M30 LF % LF
    /// </summary>
    private static string PrepareNcContent(string content)
    {
        string nc = content.Trim();
        if (!nc.StartsWith("%"))
            nc = "%" + "\n" + nc;
        if (!nc.TrimEnd().EndsWith("%"))
            nc = nc.TrimEnd() + "\n%\n";
        return nc;
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
        9 => "DNC",
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

public class OperatorMessageInfo
{
    public int    Number  { get; set; }
    /// <summary>0=EX(외부), 1=매크로(#3006), 2=ext-매크로 등</summary>
    public short  MsgType { get; set; }
    public string Message { get; set; } = "";
}

public class ProgramDirectoryEntry
{
    public string ProgramNo { get; set; } = "";  // "O0001"
    public int    Number    { get; set; }         // 1
    public int    Size      { get; set; }         // bytes
    public string Comment   { get; set; } = "";
}

public class WearOffsetEntry
{
    public int    No { get; set; }   // 공구 번호 (1-based)
    public double X  { get; set; }
    public double Z  { get; set; }
    public double Y  { get; set; }
    public double R  { get; set; }   // 인선 R
}

public class CounterFieldParam
{
    public string Key     { get; set; } = "";
    public string VarType { get; set; } = "macro";
    public int    VarNo   { get; set; }
}

public class CounterVarResult
{
    public string Key   { get; set; } = "";
    public int    VarNo { get; set; }
    public double Value { get; set; }
}

#endregion
