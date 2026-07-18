$ErrorActionPreference = 'Stop'
$root = (Resolve-Path 'procedures').Path
$folders = Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
    Get-ChildItem -LiteralPath $_.FullName -Directory
}

foreach ($folder in $folders) {
    $json = Join-Path $folder.FullName 'procedure.json'
    if (-not (Test-Path -LiteralPath $json)) { continue }
    $record = Get-Content -Raw -LiteralPath $json | ConvertFrom-Json
    $slug = $record.classification.life_event_group.slug
    $code = $record.procedure_code.Trim()
    $targetParent = Join-Path $root $slug
    $target = Join-Path $targetParent $code
    if ($folder.FullName -eq $target) { continue }
    if (Test-Path -LiteralPath $target) { throw "Duplicate destination: $target" }
    Move-Item -LiteralPath $folder.FullName -Destination $target
}
