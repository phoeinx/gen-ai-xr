@echo off
REM Stop development environment (Windows)

echo 🛑 Stopping WebXR Development Environment...

docker-compose down

echo ✅ All containers stopped
echo 💡 To remove volumes and rebuild fresh: docker-compose down -v
