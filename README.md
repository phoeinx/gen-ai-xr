# Gen-AI + AR

A WebXR application with AI-powered object generation and voice control features, built with a containerized frontend, backend, and Whisper voice server architecture.

## Features

- **WebXR Support**: Immersive VR/AR experience with Three.js
- **AI Object Generation**: Create 3D objects using natural language prompts
- **Voice Control**: Speech-to-text commands using OpenAI Whisper
- **Real-time Interaction**: Walk through environments and manipulate objects
- **Containerized Architecture**: Easy deployment with Docker Compose

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) (usually included with Docker Desktop)
- Microphone access for voice control features

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
   - Whisper Voice Server: ws://localhost:9000
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

- **Frontend**: WebXR application served on http://localhost:3000
- **Backend**: AI object generation API server on http://localhost:8000
- **Whisper Server**: Voice transcription service on ws://localhost:9000
- **API Documentation**: Available at http://localhost:8000/docs

## Usage

### Controls

#### Keyboard Controls
- **WASD**: Move through the environment
- **Mouse**: Look around (click to lock mouse cursor)
- **F**: Spawn flowers
- **G**: Generate AI objects (opens prompt)
- **V**: Start/stop voice recording
- **ESC**: Unlock mouse cursor

#### Voice Commands
Press **V** to start voice recording, then speak one of these commands:

##### Available 3D Models (Keyword Matching)
Simply say the model name:
- **"car"** / **"vehicle"** / **"automobile"** - Load a car model
- **"tree"** / **"plant"** - Load a tree model  
- **"cactus"** / **"succulent"** - Load a cactus model
- **"bonfire"** / **"fire"** / **"campfire"** - Load a bonfire model
- **"firework"** / **"fireworks"** / **"rocket"** - Load a firework model
- **"toaster"** / **"toast"** - Load a toaster model
- **"flower"** / **"bloom"** - Load a flower model
- **"desk"** / **"table"** - Load a desk model

##### Quick Actions
- **"spawn flower"** - Spawn a flower at current location
- **"place"** / **"drop"** / **"put down"** - Place currently held object in the world

##### Environment Controls
- **"clear sky"** / **"bright sky"** - Set sky to clear weather
- **"dark sky"** / **"cloudy sky"** - Set sky to cloudy weather

*Note: Voice commands now use simple keyword matching for fast model loading. For AI generation, use the text prompt system (Press G).*

### VR/AR Mode
- Click the VR button to enter immersive mode (requires VR headset)
- All controls work in VR with hand tracking/controllers

## Troubleshooting

1. **Docker not running**: Ensure Docker Desktop is started before running any commands
2. **Port conflicts**: Make sure ports 3000, 8000, and 9000 are not being used by other applications
3. **Voice control not working**: 
   - Check microphone permissions in your browser
   - Ensure Whisper server is running (check ws://localhost:9000)
   - Try refreshing the page to reinitialize WebSocket connection
4. **Permission issues** (Unix systems): You may need to make scripts executable:
   ```bash
   chmod +x scripts/start.sh scripts/stop.sh
   ```
5. **curl command not found** (Windows): Install curl or use Git Bash/WSL
