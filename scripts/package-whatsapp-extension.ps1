$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$extensionFolder = Join-Path $projectRoot 'extensions/copetin-whatsapp'
$files = @('manifest.json', 'background.js', 'navigation.js', 'open-chat.js', 'bridge.js', 'INSTALAR.txt') | ForEach-Object { Join-Path $extensionFolder $_ }
Compress-Archive -LiteralPath $files -DestinationPath (Join-Path $projectRoot 'public/copetin-whatsapp-extension.zip') -Force
