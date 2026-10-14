$root = "E:\mocube\mocu\install-resources\extensions-default"
$broken = 0
$pkgs = Get-ChildItem -Recurse -Filter "package.json" -Path $root |
  Where-Object { $_.FullName -notmatch 'node_modules' -and (Test-Path (Join-Path $_.DirectoryName 'vendor')) }
foreach ($file in $pkgs) {
  $pkg = Get-Content $file.FullName -Raw | ConvertFrom-Json
  $deps = $pkg.dependencies
  if (-not $deps) { continue }
  foreach ($dep in $deps.PSObject.Properties) {
    if ($dep.Value -notlike 'file:*') { continue }
    $depPath = Join-Path $file.DirectoryName ($dep.Value -replace '^file:', '')
    $depPkgJson = Join-Path $depPath 'package.json'
    if (-not (Test-Path $depPkgJson)) {
      Write-Output ("MISSING-PKG: " + $dep.Name + " -> " + $dep.Value + " in " + $file.DirectoryName.Replace($root, ''))
      $broken++
      continue
    }
    $dp = Get-Content $depPkgJson -Raw | ConvertFrom-Json
    $entries = @()
    if ($dp.main) { $entries += $dp.main }
    if ($dp.exports) {
      $e = $dp.exports.'.'
      if ($e) {
        if ($e.import) { $entries += $e.import }
        if ($e.require) { $entries += $e.require }
        if ($e -is [string]) { $entries += $e }
      }
    }
    foreach ($entry in $entries) {
      $target = Join-Path $depPath ($entry -replace '^\./', '')
      if (-not (Test-Path $target)) {
        Write-Output ("BROKEN-ENTRY: " + $dep.Name + " missing " + $entry + " in " + $file.DirectoryName.Replace($root, ''))
        $broken++
      }
    }
  }
}
if ($broken -eq 0) { Write-Output "ALL VENDORED DEPS OK" } else { Write-Output ("BROKEN COUNT: " + $broken) }
