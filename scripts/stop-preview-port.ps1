# Libère le port utilisé par preview:node (5173 par défaut).
param(
  [int]$Port = 5173
)

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
  Write-Host "Aucun processus n'écoute sur le port $Port."
  exit 0
}

$processIds = $connections.OwningProcess | Sort-Object -Unique
foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  $name = if ($process) { $process.ProcessName } else { "pid $processId" }
  Write-Host "Arrêt de $name (PID $processId) sur le port $Port..."
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Write-Host "Port $Port libéré. Relancez : pnpm.cmd run preview:node"
