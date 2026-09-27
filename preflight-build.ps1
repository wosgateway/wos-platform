param(
  [string]$EnvFile = ".env.local",
  [string]$ImageTag = "latest",
  [string]$ImageName = "wos-webhook-promote-candidate",
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Host ""
  Write-Host "PREFLIGHT FAILED" -ForegroundColor Red
  Write-Host $Message -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " WOS.os Preflight Build Validation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Node / npm
# ---------------------------------------------------------------------------
Write-Host "=== Runtime ===" -ForegroundColor Cyan

$nodeVersionText = (& node -v 2>$null)
if (-not $nodeVersionText) {
  Fail "Node.js is not available."
}

$nodeVersion = [version]($nodeVersionText.TrimStart("v"))
if ($nodeVersion.Major -lt 22) {
  Fail "Node.js >= 22 required. Found $nodeVersionText"
}

Pass "Node.js $nodeVersionText"

$npmVersion = (& npm -v 2>$null)
if (-not $npmVersion) {
  Fail "npm is not available."
}

Pass "npm $npmVersion"

# ---------------------------------------------------------------------------
# 2. Docker
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Docker ===" -ForegroundColor Cyan

$dockerVersion = (& docker --version 2>$null)
if (-not $dockerVersion) {
  Fail "Docker CLI is not available."
}

Pass $dockerVersion

# ---------------------------------------------------------------------------
# 3. Required files
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Source / Config Sanity ===" -ForegroundColor Cyan

$requiredFiles = @(
  "package.json",
  "Dockerfile",
  ".dockerignore",
  "src\lib\ai\core.ts",
  "src\lib\ai\catalog.ts",
  "src\lib\ai\notion-knowledge.ts",
  "src\app\api\ai\chat\route.ts"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path $file)) {
    Fail "Required file missing: $file"
  }

  Pass "Found $file"
}

# ---------------------------------------------------------------------------
# 4. package.json build script
# ---------------------------------------------------------------------------
$packageJson = Get-Content .\package.json -Raw | ConvertFrom-Json

if (-not $packageJson.scripts.build) {
  Fail "package.json does not define scripts.build."
}

if ($packageJson.scripts.build -ne "next build") {
  Fail "Expected package.json build script to be 'next build'. Found '$($packageJson.scripts.build)'"
}

Pass "package.json build script = next build"

# ---------------------------------------------------------------------------
# 5. Environment file
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Environment Validation ===" -ForegroundColor Cyan

if (-not (Test-Path $EnvFile)) {
  Fail "Environment file not found: $EnvFile"
}

$envLines = Get-Content $EnvFile

$envMap = @{}

foreach ($line in $envLines) {
  if ($line -match '^\s*#') {
    continue
  }

  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $envMap[$name] = $value
  }
}

function Get-EnvVal($Name) {
  if ($envMap.ContainsKey($Name)) {
    return [string]$envMap[$Name]
  }

  return ""
}

$supaUrl = Get-EnvVal "NEXT_PUBLIC_SUPABASE_URL"
$supaAnonKey = Get-EnvVal "NEXT_PUBLIC_SUPABASE_ANON_KEY"
$supaServiceUrl = Get-EnvVal "SUPABASE_URL"
$supaServiceKey = Get-EnvVal "SUPABASE_SERVICE_ROLE_KEY"

$litellmBase = Get-EnvVal "LITELLM_BASE_URL"
$litellmModel = Get-EnvVal "LITELLM_MODEL"
$litellmKey = Get-EnvVal "LITELLM_API_KEY"

$upstashUrl = Get-EnvVal "UPSTASH_REDIS_REST_URL"
$upstashToken = Get-EnvVal "UPSTASH_REDIS_REST_TOKEN"

# Supabase
if (-not $supaUrl) {
  Fail "NEXT_PUBLIC_SUPABASE_URL is missing."
}

if (-not ($supaUrl -match '^https://')) {
  Fail "NEXT_PUBLIC_SUPABASE_URL must use https://"
}

if (-not $supaAnonKey) {
  Fail "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing."
}

if (-not $supaServiceUrl) {
  Fail "SUPABASE_URL is missing."
}

if (-not $supaServiceKey) {
  Fail "SUPABASE_SERVICE_ROLE_KEY is missing."
}

Pass "Supabase public URL present"
Pass "Supabase anon key present"
Pass "Supabase service URL present"
Pass "Supabase service-role key present"

# Prevent accidental misuse of service role key
if ($envMap.ContainsKey("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")) {
  Fail "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must not exist."
}

Pass "No NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"

# LiteLLM
if (-not $litellmBase) {
  Fail "LITELLM_BASE_URL is missing."
}

if (-not $litellmModel) {
  Fail "LITELLM_MODEL is missing."
}

if (-not $litellmKey) {
  Warn "LITELLM_API_KEY is empty."
} else {
  Pass "LiteLLM API key present"
}

Pass "LiteLLM base URL present"
Pass "LiteLLM model = $litellmModel"

# Upstash
if (-not $upstashUrl) {
  Warn "UPSTASH_REDIS_REST_URL is empty."
} else {
  Pass "Upstash Redis URL present"
}

if (-not $upstashToken) {
  Warn "UPSTASH_REDIS_REST_TOKEN is empty."
} else {
  Pass "Upstash Redis token present"
}

# ---------------------------------------------------------------------------
# 6. Dockerfile wiring
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Dockerfile Wiring ===" -ForegroundColor Cyan

$dockerfile = Get-Content .\Dockerfile -Raw

if ($dockerfile -notmatch 'ARG\s+NEXT_PUBLIC_SUPABASE_URL') {
  Fail "Dockerfile missing ARG NEXT_PUBLIC_SUPABASE_URL"
}

if ($dockerfile -notmatch 'ARG\s+NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  Fail "Dockerfile missing ARG NEXT_PUBLIC_SUPABASE_ANON_KEY"
}

if ($dockerfile -notmatch 'NEXT_PUBLIC_SUPABASE_URL') {
  Fail "Dockerfile does not reference NEXT_PUBLIC_SUPABASE_URL"
}

if ($dockerfile -notmatch 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  Fail "Dockerfile does not reference NEXT_PUBLIC_SUPABASE_ANON_KEY"
}

Pass "Dockerfile Supabase build wiring present"

# ---------------------------------------------------------------------------
# 7. Docker build context hygiene
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Build Context Hygiene ===" -ForegroundColor Cyan

$dockerignore = Get-Content .\.dockerignore -Raw

if ($dockerignore -notmatch '(?m)^\.env\*$') {
  Warn ".dockerignore does not explicitly ignore .env*"
} else {
  Pass ".env* excluded from Docker build context"
}

$backupFiles = Get-ChildItem -Recurse -File -Force |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\.next\\' -and
    $_.Name -match '\.(bak|bak\d+|backup)$|\.before-'
  }

if ($backupFiles.Count -gt 0) {
  Warn "Backup/temp-like files exist in repository/build context:"
  foreach ($file in $backupFiles) {
    Write-Host "       $($file.FullName.Replace((Get-Location).Path + '\',''))" -ForegroundColor Yellow
  }
} else {
  Pass "No backup/temp-like files detected"
}

# ---------------------------------------------------------------------------
# 8. Lightweight accidental-secret scan
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Secret Hygiene ===" -ForegroundColor Cyan

$scanFiles = Get-ChildItem -Recurse -File -Force |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\.next\\' -and
    $_.FullName -notmatch '\\.git\\' -and
    $_.Name -notmatch '^\.env' -and
    $_.Extension -in @(
      ".ts", ".tsx", ".js", ".jsx", ".json", ".ps1", ".yml", ".yaml",
      ".md", ".txt", ".sql"
    )
  }

$secretHit = $false

foreach ($file in $scanFiles) {
  $content = [System.IO.File]::ReadAllText($file.FullName)

  if (-not $content) {
    continue
  }

  if ($content -match '(?i)sk-[A-Za-z0-9]{20,}') {
    Write-Host "Potential API secret pattern: $($file.FullName)" -ForegroundColor Red
    $secretHit = $true
  }

  if ($content -match '(?i)service_role.{0,30}eyJ[A-Za-z0-9_-]{20,}') {
    Write-Host "Potential Supabase service-role secret pattern: $($file.FullName)" -ForegroundColor Red
    $secretHit = $true
  }
}

if ($secretHit) {
  Fail "Potential hard-coded secret detected. Inspect the reported file(s)."
}

Pass "No obvious hard-coded secret patterns detected"

# ---------------------------------------------------------------------------
# 9. Dry run
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Build Plan ===" -ForegroundColor Cyan

$fullTag = "${ImageName}:${ImageTag}"

if ($DryRun) {
  Write-Host "DRY RUN ONLY" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Would run:"
  Write-Host "  npm run build"
  Write-Host ""
  Write-Host "Would run:"
  Write-Host "  docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=<redacted> --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<redacted> -t $fullTag ."
  Write-Host ""
  Write-Host "PREFLIGHT PASSED (DRY RUN)" -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------
# 10. Local Next.js build
# ---------------------------------------------------------------------------
if ($SkipBuild) {
  Write-Host "SkipBuild enabled: npm/Docker builds will not run." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "=== Next.js Build ===" -ForegroundColor Cyan
  Write-Host "Running npm run build ..." -ForegroundColor DarkGray

  & npm run build

  if ($LASTEXITCODE -ne 0) {
    Fail "npm run build failed."
  }

  Pass "npm run build"
}

# ---------------------------------------------------------------------------
# 11. Docker build
# ---------------------------------------------------------------------------
if ($SkipBuild) {
  Write-Host ""
  Write-Host "=== Docker Build ===" -ForegroundColor Cyan
  Write-Host "Skipped because -SkipBuild was supplied." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "PREFLIGHT PASSED (VALIDATION ONLY)" -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "=== Docker Build ===" -ForegroundColor Cyan

$buildArgs = @(
  "build",
  "--build-arg", "NEXT_PUBLIC_SUPABASE_URL=$supaUrl",
  "--build-arg", "NEXT_PUBLIC_SUPABASE_ANON_KEY=$supaAnonKey",
  "-t", $fullTag,
  "."
)

Write-Host "Building $fullTag ..." -ForegroundColor DarkGray

& docker @buildArgs

if ($LASTEXITCODE -ne 0) {
  Fail "Docker build failed."
}

Pass "Docker build $fullTag"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " PREFLIGHT PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
