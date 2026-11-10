# 建置 Android 殼（不用 Gradle、不用 Android Studio）：aapt2 → javac → d8 → zipalign → apksigner
# 需要：JDK 17 以上、Android SDK（platforms;android-36.1、build-tools;37.0.0）。
#   $env:ANDROID_SDK_ROOT 沒設的話用 A:\android-sdk；JAVA_HOME 沒設的話用 PATH 上的 java 那一套
# 用法：pwsh android/build.ps1            → android/build/hiyori.apk
#       pwsh android/build.ps1 -Install   → 建好後裝到 adb 連著的手機
# 簽章用這台電腦的 ~/.android/debug.keystore（Android 的慣例，沒有就建一把）：同一台電腦建的可以直接蓋過去更新；
# 換一台電腦建的簽章不同，要先解除安裝（資料用線上同步帶回來）
param([switch]$Install, [int]$VersionCode = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() / 60), [string]$VersionName = (Get-Date -Format 'yyyy.MM.dd'))
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'A:\android-sdk' }
$bt = Join-Path $sdk 'build-tools\37.0.0'
$jar = Join-Path $sdk 'platforms\android-36.1\android.jar'
$jbin = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin' } else { Split-Path (Get-Command javac).Source }
if (-not (Test-Path $jar)) { throw "找不到 $jar：先用 sdkmanager 裝 platforms;android-36.1 和 build-tools;37.0.0" }
function Run([string]$exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE) { throw "$(Split-Path $exe -Leaf) 失敗（$LASTEXITCODE）" } }

$out = Join-Path $root 'build'
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\gen", "$out\classes", "$out\dex" | Out-Null

Run "$bt\aapt2.exe" @('compile', '--dir', "$root\res", '-o', "$out\res.zip")
Run "$bt\aapt2.exe" @('link', '-o', "$out\unaligned.apk", '-I', $jar, '--manifest', "$root\AndroidManifest.xml", '--java', "$out\gen",
  '--min-sdk-version', '36', '--target-sdk-version', '36', '--version-code', "$VersionCode", '--version-name', $VersionName, "$out\res.zip")

$src = @(Get-ChildItem -Recurse "$root\src", "$out\gen" -Filter *.java | ForEach-Object FullName)
Run "$jbin\javac.exe" (@('-nowarn', '-Xlint:-options', '--release', '17', '-encoding', 'UTF-8', '-classpath', $jar, '-d', "$out\classes") + $src)
$classes = @(Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" (@('--release', '--lib', $jar, '--min-api', '36', '--output', "$out\dex") + $classes)
Push-Location "$out\dex"; try { Run "$jbin\jar.exe" @('--update', '--file', "$out\unaligned.apk", 'classes.dex') } finally { Pop-Location }

Run "$bt\zipalign.exe" @('-f', '-P', '16', '4', "$out\unaligned.apk", "$out\aligned.apk")
$ks = Join-Path $HOME '.android\debug.keystore'
if (-not (Test-Path $ks)) {
  New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
  Run "$jbin\keytool.exe" @('-genkeypair', '-keystore', $ks, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950', '-dname', 'CN=Android Debug,O=Android,C=US')
}
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', "$out\hiyori.apk", "$out\aligned.apk")
Run "$bt\apksigner.bat" @('verify', "$out\hiyori.apk")
"建好了：$out\hiyori.apk（{0:N0} KB，版本 $VersionName／$VersionCode）" -f ((Get-Item "$out\hiyori.apk").Length / 1KB)
if ($Install) { Run (Join-Path $sdk 'platform-tools\adb.exe') @('install', '-r', "$out\hiyori.apk") }
