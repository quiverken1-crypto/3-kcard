param(
  [switch]$Lan,
  [switch]$NoBrowser,
  [int]$Port = 8088
)
# 三国KARDS 本地服务：静态文件 + 联机房间中转（与 server.js 协议一致）
# 本机：  powershell -File start-game.ps1
# 局域网：powershell -File start-game.ps1 -Lan   （同一 WiFi 的手机/电脑打开窗口里显示的地址）

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
$sep = [System.IO.Path]::DirectorySeparatorChar
$utf8 = New-Object System.Text.UTF8Encoding($false)
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.md' = 'text/markdown; charset=utf-8'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json'
  '.m4a' = 'audio/mp4'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'
}
$blocked = @('server.js', 'start-game.ps1')

# ---------------- 监听 ----------------
$bindIp = if ($Lan) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }
$listener = $null
foreach ($p in $Port..($Port + 12)) {
  try {
    $cand = New-Object System.Net.Sockets.TcpListener($bindIp, $p)
    $cand.Start()
    $listener = $cand; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "端口 $Port 起的 13 个端口都被占用，无法启动。"; exit 1 }

function Get-LanUrls {
  $list = @()
  try {
    foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($ni.OperationalStatus -ne 'Up' -or $ni.NetworkInterfaceType -eq 'Loopback') { continue }
      foreach ($ua in $ni.GetIPProperties().UnicastAddresses) {
        if ($ua.Address.AddressFamily -eq 'InterNetwork' -and -not $ua.Address.ToString().StartsWith('169.254.')) {
          $list += "http://$($ua.Address):$Port/"
        }
      }
    }
  } catch { }
  return ,$list
}

$localUrl = "http://localhost:$Port/"
Write-Host ''
Write-Host '三国KARDS 已启动'
Write-Host "  本机打开: $localUrl"
if ($Lan) {
  Write-Host '  同一 WiFi/局域网 的朋友（手机也行）用浏览器打开：'
  foreach ($u in (Get-LanUrls)) { Write-Host "    $u" }
  Write-Host '  若 Windows 弹出防火墙提示，请勾选“专用网络”并允许访问。'
}
Write-Host '  玩的时候不要关闭本窗口，关闭即停止。'
Write-Host ''
if (-not $NoBrowser) { try { Start-Process $localUrl } catch { } }

# ---------------- 房间中转 ----------------
$rooms = @{}
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Token {
  $b = New-Object byte[] 12; $rng.GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function New-Code {
  for ($i = 0; $i -lt 50; $i++) { $c = [string](Get-Random -Minimum 1000 -Maximum 10000); if (-not $rooms.ContainsKey($c)) { return $c } }
  return [string](Get-Random -Minimum 100000 -Maximum 1000000)
}
function Now-Ms { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function J([object]$v) { return (ConvertTo-Json -InputObject $v -Compress -Depth 4) }
function Sweep-Rooms {
  $now = Now-Ms
  foreach ($k in @($rooms.Keys)) {
    $r = $rooms[$k]
    if (($now - $r.touched) -gt 900000 -or ($r.closed -and ($now - $r.touched) -gt 30000)) { $rooms.Remove($k) }
  }
}
function Seat-Of($room, $token) {
  if (-not $token) { return $null }
  if ($room.host.token -eq $token) { return 'host' }
  if ($room.guest -and $room.guest.token -eq $token) { return 'guest' }
  return $null
}
function New-Seat { return @{ token = (New-Token); seen = (Now-Ms); inbox = (New-Object System.Collections.ArrayList); seq = 0; left = $false } }

function Handle-Api($method, $path, $query, $bodyText) {
  $parts = @($path.Split('/') | Where-Object { $_ -ne '' })
  $now = Now-Ms
  $body = $null
  if ($method -eq 'POST' -and $bodyText) { try { $body = ConvertFrom-Json $bodyText } catch { return @(400, (J @{ error = 'bad json' })) } }

  if ($parts.Count -ge 2 -and $parts[1] -eq 'ping') {
    $urls = if ($Lan) { Get-LanUrls } else { @() }
    return @(200, (J @{ ok = $true; lan = [bool]$Lan; list = [bool]$Lan; urls = $urls }))
  }
  if ($parts.Count -lt 2 -or $parts[1] -ne 'rooms') { return @(404, (J @{ error = 'not found' })) }

  if ($parts.Count -eq 2) {
    if ($method -eq 'GET') {
      $list = @()
      if ($Lan) {
        foreach ($r in $rooms.Values) {
          if (-not $r.guest -and -not $r.closed -and ($now - $r.host.seen) -lt 10000) {
            $list += @{ code = $r.code; name = $r.name; age = [int](($now - $r.created) / 1000) }
          }
        }
      }
      return @(200, ('{"rooms":' + (J @($list)) + '}'))
    }
    if ($method -eq 'POST') {
      Sweep-Rooms
      if ($rooms.Count -ge 300) { return @(503, (J @{ error = '服务器房间已满' })) }
      $code = New-Code
      $name = ''
      if ($body -and $body.name) { $name = [string]$body.name; if ($name.Length -gt 20) { $name = $name.Substring(0, 20) } }
      $rooms[$code] = @{ code = $code; name = $name; created = $now; touched = $now; closed = $false; host = (New-Seat); guest = $null }
      return @(200, (J @{ code = $code; token = $rooms[$code].host.token; seat = 'host' }))
    }
    return @(405, (J @{ error = 'method' }))
  }

  $room = $rooms[$parts[2]]
  $action = if ($parts.Count -ge 4) { $parts[3] } else { '' }
  if (-not $room -or $room.closed) { return @(404, (J @{ error = '房间不存在或已关闭' })) }
  $room.touched = $now

  if ($action -eq 'join' -and $method -eq 'POST') {
    if ($room.guest) { return @(409, (J @{ error = '房间已满' })) }
    $room.guest = New-Seat
    return @(200, (J @{ code = $room.code; token = $room.guest.token; seat = 'guest' }))
  }

  $token = if ($method -eq 'GET') { $query['token'] } elseif ($body) { [string]$body.token } else { $null }
  $seat = Seat-Of $room $token
  if (-not $seat) { return @(403, (J @{ error = '身份无效' })) }
  $me = $room[$seat]
  $peer = if ($seat -eq 'host') { $room.guest } else { $room.host }
  $me.seen = $now

  if ($action -eq 'poll' -and $method -eq 'GET') {
    $since = 0; [void][long]::TryParse([string]$query['since'], [ref]$since)
    while ($me.inbox.Count -gt 0 -and $me.inbox[0].i -le $since) { $me.inbox.RemoveAt(0) }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"msgs":[')
    $first = $true
    foreach ($m in $me.inbox) {
      if (-not $first) { [void]$sb.Append(',') }
      $first = $false
      [void]$sb.Append('{"i":').Append($m.i).Append(',"d":').Append((J $m.d)).Append('}')
    }
    $peerOn = [bool]($peer -and -not $peer.left -and ($now - $peer.seen) -lt 10000)
    $peerLeft = [bool]($peer -and $peer.left)
    [void]$sb.Append('],"peer":').Append($peerOn.ToString().ToLower()).Append(',"peerLeft":').Append($peerLeft.ToString().ToLower()).Append('}')
    return @(200, $sb.ToString())
  }
  if ($action -eq 'send' -and $method -eq 'POST') {
    if (-not $peer) { return @(409, (J @{ error = '对手尚未加入' })) }
    $items = @()
    if ($body.batch) { $items = @($body.batch) } elseif ($null -ne $body.data) { $items = @($body.data) }
    foreach ($d in $items) {
      if ($d -isnot [string]) { continue }
      if ($peer.inbox.Count -ge 500) { return @(429, (J @{ error = '消息积压过多' })) }
      $peer.seq++
      [void]$peer.inbox.Add(@{ i = $peer.seq; d = $d })
    }
    return @(200, '{"ok":true}')
  }
  if ($action -eq 'leave' -and $method -eq 'POST') {
    $me.left = $true; $room.closed = $true
    return @(200, '{"ok":true}')
  }
  return @(404, (J @{ error = 'not found' }))
}

# ---------------- HTTP ----------------
function Send-Head($stream, [int]$status, [string]$type, [long]$length, $extra) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 206 = 'Partial Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 409 = 'Conflict'; 416 = 'Range Not Satisfiable'; 429 = 'Too Many Requests'; 503 = 'Service Unavailable' }[$status]
  $h = "HTTP/1.1 $status $reason`r`nContent-Type: $type`r`nContent-Length: $length`r`nConnection: close`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`n"
  if ($extra) { $h += $extra }
  $h += "`r`n"
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($bytes, 0, $bytes.Length)
}
function Send-Text($stream, [int]$status, [string]$type, [string]$text, [bool]$head) {
  $bytes = $utf8.GetBytes($text)
  Send-Head $stream $status $type $bytes.Length $null
  if (-not $head) { $stream.Write($bytes, 0, $bytes.Length) }
}
function Send-File($stream, [string]$method, [string]$rel, $headers) {
  $isHead = ($method -eq 'HEAD')
  if ($rel -eq '/' -or $rel -eq '') { $rel = '/index.html' }
  $clean = ($rel.Split('/') | Where-Object { $_ -ne '' -and $_ -ne '.' }) -join $sep
  if ($rel.Contains('..') -or $clean.Contains(':')) { Send-Text $stream 403 'text/plain' 'forbidden' $isHead; return }
  $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $clean))
  $name = [System.IO.Path]::GetFileName($full)
  if (-not $full.StartsWith($root + $sep, [StringComparison]::OrdinalIgnoreCase) -or $blocked -contains $name -or $name.StartsWith('.')) {
    Send-Text $stream 403 'text/plain' 'forbidden' $isHead; return
  }
  if (-not [System.IO.File]::Exists($full)) { Send-Text $stream 404 'text/plain' '404' $isHead; return }
  $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
  $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
  $fs = [System.IO.File]::OpenRead($full)
  try {
    [long]$len = $fs.Length; [long]$start = 0; [long]$end = $len - 1; $status = 200; $extra = "Accept-Ranges: bytes`r`n"
    $range = $headers['range']
    if ($range -and $range -match '^bytes=(\d*)-(\d*)$' -and ($Matches[1] -or $Matches[2])) {
      if ($Matches[1]) { $start = [long]$Matches[1]; if ($Matches[2]) { $end = [Math]::Min([long]$Matches[2], $len - 1) } }
      else { $start = [Math]::Max(0, $len - [long]$Matches[2]) }
      if ($start -gt $end -or $start -ge $len) { Send-Head $stream 416 'text/plain' 0 "Content-Range: bytes */$len`r`n"; return }
      $status = 206; $extra += "Content-Range: bytes $start-$end/$len`r`n"
    }
    [long]$remaining = $end - $start + 1
    Send-Head $stream $status $type $remaining $extra
    if ($isHead) { return }
    [void]$fs.Seek($start, [System.IO.SeekOrigin]::Begin)
    $buf = New-Object byte[] 65536
    while ($remaining -gt 0) {
      $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $remaining))
      if ($n -le 0) { break }
      $stream.Write($buf, 0, $n); $remaining -= $n
    }
  } finally { $fs.Dispose() }
}

function Find-HeaderEnd([byte[]]$b, [int]$n) {
  for ($i = 3; $i -lt $n; $i++) { if ($b[$i] -eq 10 -and $b[$i - 1] -eq 13 -and $b[$i - 2] -eq 10 -and $b[$i - 3] -eq 13) { return $i + 1 } }
  return -1
}

function Handle-Request($conn) {
  $data = $conn.buf.ToArray()
  $he = Find-HeaderEnd $data $data.Length
  if ($he -lt 0) { if ($data.Length -gt 65536) { return 'bad' } return $false }
  $headText = [System.Text.Encoding]::ASCII.GetString($data, 0, $he)
  $lines = $headText -split "`r`n"
  $reqLine = $lines[0].Split(' ')
  if ($reqLine.Count -lt 2) { return 'bad' }
  $headers = @{}
  foreach ($l in $lines[1..($lines.Count - 1)]) { $ix = $l.IndexOf(':'); if ($ix -gt 0) { $headers[$l.Substring(0, $ix).Trim().ToLower()] = $l.Substring($ix + 1).Trim() } }
  [long]$clen = 0; if ($headers['content-length']) { $clen = [long]$headers['content-length'] }
  if ($clen -gt 2097152) { return 'bad' }
  if ($data.Length -lt $he + $clen) { return $false }

  $method = $reqLine[0].ToUpper()
  $target = $reqLine[1]
  $qi = $target.IndexOf('?')
  $rawPath = if ($qi -ge 0) { $target.Substring(0, $qi) } else { $target }
  $query = @{}
  if ($qi -ge 0) {
    foreach ($kv in $target.Substring($qi + 1).Split('&')) {
      $e = $kv.IndexOf('=')
      if ($e -gt 0) { $query[[Uri]::UnescapeDataString($kv.Substring(0, $e))] = [Uri]::UnescapeDataString($kv.Substring($e + 1)) }
    }
  }
  try { $path = [Uri]::UnescapeDataString($rawPath) } catch { return 'bad' }
  $stream = $conn.stream

  if ($path.StartsWith('/api/')) {
    $bodyText = if ($clen -gt 0) { $utf8.GetString($data, $he, [int]$clen) } else { '' }
    $r = Handle-Api $method $path $query $bodyText
    Send-Text $stream $r[0] 'application/json; charset=utf-8' $r[1] $false
  } elseif ($method -eq 'GET' -or $method -eq 'HEAD') {
    Send-File $stream $method $path $headers
  } else {
    Send-Text $stream 405 'text/plain' 'method' $false
  }
  return $true
}

$conns = New-Object System.Collections.ArrayList
try {
  while ($true) {
    $busy = $false
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.NoDelay = $true
      $c.SendTimeout = 15000
      [void]$conns.Add(@{ client = $c; stream = $c.GetStream(); buf = (New-Object System.IO.MemoryStream); t = [DateTime]::UtcNow })
      $busy = $true
    }
    for ($i = $conns.Count - 1; $i -ge 0; $i--) {
      $k = $conns[$i]
      $done = $false
      try {
        $avail = $k.client.Available
        if ($avail -gt 0) {
          $busy = $true
          $tmp = New-Object byte[] ([Math]::Min($avail, 1048576))
          $n = $k.stream.Read($tmp, 0, $tmp.Length)
          if ($n -gt 0) { $k.buf.Write($tmp, 0, $n) }
          $res = Handle-Request $k
          if ($res -eq 'bad') { Send-Text $k.stream 400 'text/plain' 'bad request' $false; $done = $true }
          elseif ($res) { $done = $true }
        } elseif (([DateTime]::UtcNow - $k.t).TotalSeconds -gt 15) {
          $done = $true
        } elseif ($k.client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead) -and $k.client.Available -eq 0) {
          $done = $true
        }
      } catch {
        $done = $true
      }
      if ($done) {
        try { $k.stream.Flush(); $k.client.Client.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch { }
        try { $k.client.Close() } catch { }
        $conns.RemoveAt($i)
      }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 4 }
  }
} finally {
  $listener.Stop()
}
