# FOCAS2 Library

FANUC Open CNC API Specification (FOCAS2) 라이브러리

## 버전 정보

- **버전**: 4.11 (2017-10-13)
- **출처**: FANUC 공식 배포
- **대상 시스템**: Windows x64

## 파일 구성

| 파일 | 설명 | 용도 |
|------|------|------|
| `Fwlib64.dll` | 핵심 64bit DLL | 기본 FOCAS 함수 |
| `fwlib30i64.dll` | 30i 시리즈 DLL | 30i/31i/32i 컨트롤러용 |
| `fwlib64.cs` | C# P/Invoke 래퍼 | .NET Agent에서 사용 |
| `Fwlib64.h` | C/C++ 헤더 파일 | 함수 시그니처 참조용 |

## 사용법 (C# .NET)

```csharp
// fwlib64.cs를 프로젝트에 포함
using Focas1;

// 연결
ushort handle;
short ret = Focas1.cnc_allclibhndl3("192.168.1.100", 8193, 10, out handle);

// 상태 읽기
Focas1.ODBST statinfo = new Focas1.ODBST();
ret = Focas1.cnc_statinfo(handle, statinfo);

// 연결 해제
Focas1.cnc_freelibhndl(handle);
```

## 주의사항

- 이 라이브러리는 FANUC 라이선스 하에 제공됩니다
- 상업적 배포 시 FANUC 라이선스 정책 확인 필요
- DLL 파일은 `.gitignore`에서 제외 권장 (라이선스 정책에 따라)

## 지원 컨트롤러

- FANUC 0i-TF / 0i-TF Plus
- FANUC 30i-B / 31i-B / 32i-B
- FANUC 30i-A / 31i-A / 32i-A
- 기타 FOCAS2 지원 컨트롤러
