# Detects (and optionally kills) running OurCode IDE instances.
# Exit code 0 = instance(s) found; 1 = none found (or detection failed).
# Avoids cmd/batch escaping issues entirely — called from run.bat / dev.bat.
param([switch]$Kill)

try {
  $procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'OurCode IDE.exe' -or
    ($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*OurCode-ide*' -and $_.CommandLine -notlike '*--type=*')
  })
} catch {
  exit 1
}

if ($procs.Count -eq 0) { exit 1 }

if ($Kill) {
  $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

exit 0
