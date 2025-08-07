# Rivendell WebXR

A WebXR application with AI-powered features, built with a containerized frontend and backend architecture.

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) (usually included with Docker Desktop)

## Getting Started

### Option A: Using Convenience Scripts (Recommended)

#### For Unix-based Systems (macOS, Linux)

**Start the development environment:**
```bash
./scripts/start.sh
```

**Stop the development environment:**
```bash
./scripts/stop.sh
```

#### For Windows Users

**Start the development environment:**
```cmd
scripts\start.bat
```

**Stop the development environment:**
```cmd
scripts\stop.bat
```

### Option B: Manual Docker Commands (Bare-knuckled)

If you prefer to run Docker commands directly or the convenience scripts don't work on your system:

#### Starting the Application

1. **Build and start all containers:**
   ```bash
   docker-compose up --build -d
   ```

2. **Verify services are running:**
   ```bash
   # Check running containers
   docker-compose ps
   
   # Check logs
   docker-compose logs -f
   ```

3. **Test the services:**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

#### Stopping the Application

```bash
# Stop all containers
docker-compose down

# Stop and remove volumes (complete cleanup)
docker-compose down -v
```

#### Other Useful Commands

```bash
# View logs for all services
docker-compose logs -f

# View logs for specific service
docker-compose logs -f frontend
docker-compose logs -f backend

# Rebuild without cache
docker-compose build --no-cache

# Start services individually
docker-compose up frontend
docker-compose up backend
```

## Service Information

- **Frontend**: Served on http://localhost:3000
- **Backend**: API server on http://localhost:8000
- **API Documentation**: Available at http://localhost:8000/docs

## Troubleshooting

1. **Docker not running**: Ensure Docker Desktop is started before running any commands
2. **Port conflicts**: Make sure ports 3000 and 8000 are not being used by other applications
3. **Permission issues** (Unix systems): You may need to make scripts executable:
   ```bash
   chmod +x scripts/start.sh scripts/stop.sh
   ```
4. **curl command not found** (Windows): Install curl or use Git Bash/WSL
