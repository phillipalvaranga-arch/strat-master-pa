# Strat Master P.A desktop installer (signal-only; no broker access).
$ErrorActionPreference = 'Stop'
$d = Join-Path $env:LOCALAPPDATA 'StratMasterPA'; New-Item -ItemType Directory -Force $d | Out-Null
$base = 'https://phillipalvaranga-arch.github.io/strat-master-pa'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest "$base/icons/strat-master-pa.ico" -OutFile "$d\strat-master-pa.ico" -UseBasicParsing
Invoke-WebRequest "$base/relay/relay.js" -OutFile "$d\relay.js" -UseBasicParsing
$url = "http://127.0.0.1:8795/"
$node = Join-Path $env:LOCALAPPDATA 'StratBot\node\node.exe'
$vbs = @"
Set sh = CreateObject("WScript.Shell"): Set fso = CreateObject("Scripting.FileSystemObject")
node = "$node"
If fso.FileExists(node) Then
  On Error Resume Next
  Set h = CreateObject("MSXML2.XMLHTTP"): h.Open "GET", "http://127.0.0.1:8795/ping", False: h.Send
  If Err.Number <> 0 Then sh.Run """" & node & """ ""$d\relay.js""", 0, False: WScript.Sleep 800
  On Error GoTo 0
End If
c1 = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
c2 = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"
e1 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(c1) Then
  b = c1
ElseIf fso.FileExists(c2) Then
  b = c2
ElseIf fso.FileExists(e1) Then
  b = e1
End If
If Not fso.FileExists(node) Then url = "https://phillipalvaranga-arch.github.io/strat-master-pa/" Else url = "$url"
If b <> "" Then sh.Run """" & b & """ --app=" & url & " --window-size=1400,950", 1, False Else sh.Run url, 1, False
"@
Set-Content -Path "$d\launch.vbs" -Value $vbs -Encoding ASCII
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Strat Master P.A.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"; $lnk.Arguments = "`"$d\launch.vbs`""; $lnk.WorkingDirectory = $d
$lnk.IconLocation = "$d\strat-master-pa.ico,0"; $lnk.Description = 'Strat Master P.A - trade signals only (you place trades yourself)'; $lnk.Save()
"Installed. Node relay: " + (Test-Path $node)
