# Libère les ports utilisés par preview:node (5173–5182 par défaut).
param(
  [int]$Port = 5173,
  [int]$Range = 10
)

$freed = 0
for ($offset = 0; $offset -lt $Range; $offset++) {
  $listenPort = $Port + $offset
  $connections = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) { continue }

  $processIds = $connections.OwningProcess | Sort-Object -Unique
  foreach ($processId in $processIds) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "pid $processId" }
    Write-Host "Arrêt de $name (PID $processId) sur le port $listenPort..."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $freed++
  }
}

if ($freed -eq 0) {
  Write-Host "Aucun processus n'écoute sur les ports $Port-$($Port + $Range - 1)."
} else {
  Write-Host "Ports libérés. Relancez : pnpm.cmd run preview:node"
}
