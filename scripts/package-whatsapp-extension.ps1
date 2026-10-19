$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$extensionFolder = Join-Path $projectRoot 'extensions/copetin-whatsapp'
$files = @('manifest.json', 'background.js', 'navigation.js', 'open-chat.js', 'bridge.js', 'INSTALAR.txt') | ForEach-Object { Join-Path $extensionFolder $_ }
Compress-Archive -LiteralPath $files -DestinationPath (Join-Path $projectRoot 'public/copetin-whatsapp-extension.zip') -Force
$firefoxFolder = Join-Path $projectRoot 'data/whatsapp-firefox-package'
New-Item -ItemType Directory -Path $firefoxFolder -Force | Out-Null
foreach ($file in @('background.js', 'navigation.js', 'open-chat.js', 'bridge.js', 'INSTALAR-FIREFOX.txt')) {
    Copy-Item -LiteralPath (Join-Path $extensionFolder $file) -Destination $firefoxFolder -Force
}
Copy-Item -LiteralPath (Join-Path $extensionFolder 'manifest.firefox.json') -Destination (Join-Path $firefoxFolder 'manifest.json') -Force
Compress-Archive -Path (Join-Path $firefoxFolder '*') -DestinationPath (Join-Path $projectRoot 'public/copetin-whatsapp-firefox.zip') -Force
