#!/usr/bin/env pwsh

# Project-Wrapped Development Startup Script
# This script automates: Docker container startup, environment variables, and server launch

$ErrorActionPreference = "Continue"

Write-Host "Project-Wrapped Development Startup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Database configuration
$DB_CONTAINER_NAME = "project-wrapped-db"
$DB_PASSWORD = "password"
$DB_NAME = "projectwrapped"
$DB_PORT = "5432"
$DB_IMAGE = "postgres:latest"

# Check if Docker is available
Write-Host ""
Write-Host "Checking Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
}
catch {
    Write-Host "ERROR: Docker is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Check if Docker daemon is running
Write-Host "Checking Docker daemon..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
}
catch {
    Write-Host "Docker Desktop is starting..." -ForegroundColor Yellow
    & "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    Start-Sleep -Seconds 15
}

# Check if container already exists
$container = docker ps -a --filter "name=^${DB_CONTAINER_NAME}$" --format "{{.Names}}" 2>$null

if ($container) {
    $running = docker ps --filter "name=^${DB_CONTAINER_NAME}$" --format "{{.Names}}" 2>$null
    
    if ($running) {
        Write-Host "OK: Database container is already running" -ForegroundColor Green
    }
    else {
        Write-Host "Starting existing database container..." -ForegroundColor Yellow
        docker start $DB_CONTAINER_NAME 2>$null
        Write-Host "OK: Database container started" -ForegroundColor Green
        Start-Sleep -Seconds 3
    }
}
else {
    Write-Host "Creating PostgreSQL container..." -ForegroundColor Yellow
    $args = @(
        "run",
        "--name", $DB_CONTAINER_NAME,
        "-e", "POSTGRES_PASSWORD=$DB_PASSWORD",
        "-e", "POSTGRES_DB=$DB_NAME",
        "-p", "${DB_PORT}:5432",
        "-d", $DB_IMAGE
    )
    docker $args 2>$null | Out-Null
    
    Write-Host "OK: Database container created" -ForegroundColor Green
    Start-Sleep -Seconds 5
}

# Wait for database to be ready
Write-Host "Waiting for database to be ready..." -ForegroundColor Yellow
$dbReady = $false

for ($i = 0; $i -lt 30; $i++) {
    try {
        docker exec $DB_CONTAINER_NAME pg_isready -U postgres 2>&1 | Out-Null
        Write-Host "OK: Database is ready" -ForegroundColor Green
        $dbReady = $true
        break
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $dbReady) {
    Write-Host "WARNING: Database startup timeout (it may still be initializing)" -ForegroundColor Yellow
}

# Set environment variables
Write-Host ""
Write-Host "Setting environment variables..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://postgres:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"
$env:SESSION_SECRET = "dev-secret-key"
$env:NODE_ENV = "development"

# Optional: Set Azure DevOps PAT if you have one (for testing)
# You can set this in your PowerShell profile or pass it as an environment variable
# $env:AZURE_DEVOPS_PAT = "your-pat-token-here"

Write-Host "OK: Environment variables set" -ForegroundColor Green
if ($env:AZURE_DEVOPS_PAT) {
    Write-Host "   Note: Azure DevOps PAT configured from environment" -ForegroundColor Gray
}

# Start the development server
Write-Host ""
Write-Host "Starting development server..." -ForegroundColor Yellow
Write-Host "Server: http://localhost:5000" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Cyan
Write-Host ""

Set-Location c:\Users\jamacedo\Git\Project-Wrapped
npx tsx server/index.ts
