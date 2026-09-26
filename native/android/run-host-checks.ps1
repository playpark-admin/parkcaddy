param(
  [string]$CompilerJar = "",
  [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = "Stop"
$projectDirectory = $PSScriptRoot
$outputDirectory = Join-Path $projectDirectory ".host-tests"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$sourceDirectory = Join-Path $projectDirectory "app/src/main/java/app/playpark/parkcaddy"
$names = @("ScanProgress","CloudRecordQueue","DepthGeometry","GridDisplayPolicy","MeasurementPolicy","MeasurementRecorder","RangePolicy","ReferenceWindow","StableHeight","StickyLabels","TerrainMath","TrackingGuide")
$sources = @($names | ForEach-Object { Join-Path $sourceDirectory ($_ + ".java") })
$tests = @(Get-ChildItem -LiteralPath (Join-Path $projectDirectory "tests") -Filter "*.java")
$sources += @($tests | Select-Object -ExpandProperty FullName)
if ($JavaHome) {
  $javaExecutable = Join-Path $JavaHome "bin/java.exe"
  $javacExecutable = Join-Path $JavaHome "bin/javac.exe"
} else {
  $javaExecutable = (Get-Command java -ErrorAction Stop).Source
  $compiler = Get-Command javac -ErrorAction SilentlyContinue
  $javacExecutable = if ($compiler) { $compiler.Source } else { "" }
}
if ($CompilerJar) {
  if (-not [IO.Path]::IsPathRooted($CompilerJar)) { $CompilerJar = Join-Path $projectDirectory $CompilerJar }
  if (-not (Test-Path -LiteralPath $CompilerJar)) { throw "Compiler jar not found: $CompilerJar" }
  & $javaExecutable -jar $CompilerJar -1.8 -encoding UTF-8 -warn:none -d $outputDirectory $sources
} elseif ($javacExecutable -and (Test-Path -LiteralPath $javacExecutable)) {
  & $javacExecutable -encoding UTF-8 -d $outputDirectory $sources
} else {
  throw "Install JDK 17 or pass -CompilerJar with a Java 8 compatible Eclipse compiler."
}
if ($LASTEXITCODE -ne 0) { throw "Host compilation failed." }
foreach ($test in $tests) {
  & $javaExecutable ("-Djava.io.tmpdir=" + $outputDirectory) -cp $outputDirectory ("app.playpark.parkcaddy." + $test.BaseName)
  if ($LASTEXITCODE -ne 0) { throw "Failed: $($test.Name)" }
}
Write-Output ("PASS: " + $tests.Count + " host programs. This does not replace an Android SDK build or field accuracy validation.")
