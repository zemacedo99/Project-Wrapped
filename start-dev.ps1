#!/usr/bin/env pwsh
# Project-Wrapped Development Startup
#
# Legacy entry point kept for backward compatibility. It delegates to
# setup-and-start.ps1 -Dev (local development: DB in Docker, app on the host
# with hot reload).
#
# Prefer calling .\setup-and-start.ps1 directly:
#   .\setup-and-start.ps1        Recommended: full Docker Compose deployment
#   .\setup-and-start.ps1 -Dev   Local development with hot reload (this script)

param()

& (Join-Path $PSScriptRoot "setup-and-start.ps1") -Dev @args
