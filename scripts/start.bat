@echo off
REM Development startup script for WebXR (Windows)

echo 🧝‍♂️ Starting WebXR Development Environment...

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker first.
    exit /b 1
)

REM Build and start containers
echo 🏗️  Building and starting containers...
docker-compose up --build -d

REM Wait for services to be ready
echo ⏳ Waiting for services to start...
timeout /t 5 /nobreak >nul

REM Check if services are healthy
echo 🔍 Checking service health...

REM Check frontend
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend is running at http://localhost:3000
) else (
    echo ❌ Frontend is not responding
)

REM Check backend
curl -f http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend is running at http://localhost:8000
    echo 📖 API docs available at http://localhost:8000/docs
) else (
    echo ❌ Backend is not responding
)

echo.
echo 🚀 WebXR is ready!
echo    Frontend: http://localhost:3000
echo    Backend:  http://localhost:8000
echo    API Docs: http://localhost:8000/docs
echo.
echo 📝 To stop: scripts\stop.bat
echo 📝 To view logs: docker-compose logs -f
