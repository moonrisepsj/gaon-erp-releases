# GAON ERP · Windows 다운로드

가온 ERP의 Windows용 클라이언트와 간단한 사용 매뉴얼을 배포하는 공개 저장소입니다.
업무 데이터, 서버 소스, 직원 정보, API 키, 기존 개발 저장소의 기록은 포함하지 않습니다.

## 다운로드

- **[Windows 64비트 설치 파일](https://github.com/moonrisepsj/gaon-erp-releases/releases/download/v0.2.0-preview.1/GAON-ERP-Setup-x64.exe)**
- [설치 없이 압축 해제해서 쓰는 ZIP](https://github.com/moonrisepsj/gaon-erp-releases/releases/download/v0.2.0-preview.1/GAON-ERP-Windows-x64.zip)
- **[3쪽 빠른 시작 매뉴얼 PDF](https://github.com/moonrisepsj/gaon-erp-releases/releases/download/v0.2.0-preview.1/GAON-ERP-Quickstart.pdf)**
- [버전별 파일과 변경 내용](https://github.com/moonrisepsj/gaon-erp-releases/releases)

## 설치와 시작

1. `GAON-ERP-Setup-x64.exe`를 다운로드해 설치합니다. Windows 10/11 x64용입니다.
2. 바탕 화면 또는 시작 메뉴에서 **GAON ERP**를 엽니다.
3. 사내망 또는 회사 VPN에 연결한 뒤 관리자가 안내한 HTTPS 서버 주소를 넣고 **연결 확인**을 누릅니다.
4. **직원 로그인**으로 열린 기본 브라우저에서 회사 계정으로 로그인합니다.
5. GAON ERP로 돌아오면 권한에 맞는 업무 화면이 열립니다.

ZIP 버전은 압축을 모두 푼 뒤 폴더 안의 `GAON ERP.exe`를 실행하세요. EXE 하나만 따로 옮기지 마세요.
앱 메뉴의 **도움말 → 빠른 사용 안내**에서도 매뉴얼을 볼 수 있습니다.

## 현재 배포 상태

`0.2.0-preview.1`은 서버 접속형 미리보기 클라이언트입니다. **사내망·검수용 VPN HTTPS 주소는 아직 별도 준비가 필요합니다.**
파일 다운로드와 설치는 가능하지만, 주소와 직원 계정이 제공되기 전에는 실제 ERP 업무에 접속할 수 없습니다.
이 설치 파일을 받는 것만으로 맥 스튜디오의 로컬 서버가 공개되거나 업무 자료가 복사되지는 않습니다.

설치 프로그램은 아직 코드 서명 인증서가 없는 버전입니다. Windows에서 게시자 확인 안내가 표시될 수 있습니다.
은행 송금, 문자 실발송 등 외부 연동은 운영 서버의 연결·승인 상태에 따라 사용할 수 있습니다.
ARM 및 32비트 Windows 설치본은 이 릴리즈에 포함하지 않습니다.

## 공개 범위 및 검증

공개된 소스는 Windows 접속용 껍데기와 빌드 구성, 매뉴얼뿐입니다. 직원 비밀번호는 기본 브라우저에서 입력하며,
로그인 완료 뒤 ERP 세션 상태는 이 PC에 유지됩니다. 앱의 연결 설정에서 저장한 주소와 해당 서버의 로그인 상태를 지울 수 있습니다.

빌드는 GitHub Actions의 Windows 환경에서 정책 검사와 최초 화면·IPC 검사를 거친 뒤 NSIS 설치본과 ZIP을 만듭니다.
실제 운영 서버 로그인부터 업무 저장까지의 Windows 현장 검수는 운영 접속 주소가 준비된 뒤 진행해야 합니다.
각 릴리즈의 `SHA256SUMS.txt`에서 내려받은 파일의 무결성을 대조할 수 있습니다.

외부 재택 검수는 회사에서 승인한 기기만 VPN으로 연결하는 방식으로 준비합니다. 공개 저장소의 다운로드 링크가 ERP 업무 자료를 공개하는 것은 아닙니다.
