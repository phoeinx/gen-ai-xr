#!/bin/bash

# Development startup script for Gen-AI XR

echo "� Starting Gen-AI XR Development Environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Build and start containers
echo "🏗️  Building and starting containers..."
docker compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are healthy
echo "🔍 Checking service health..."

# Check frontend
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Frontend is running at http://localhost:3000"
else
    echo "❌ Frontend is not responding"
fi

# Check backend
if curl -f http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend is running at http://localhost:8000"
    echo "📖 API docs available at http://localhost:8000/docs"
else
    echo "❌ Backend is not responding"
fi

# Check whisper service
echo "🎤 Checking Whisper voice server..."
if nc -z localhost 9000; then
    echo "✅ Whisper server is running at ws://localhost:9000"
else
    echo "❌ Whisper server is not responding"
fi

echo ""
echo "🚀 Gen-AI XR is ready!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   Whisper:  ws://localhost:9000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "📝 To stop: ./scripts/stop.sh"
echo "📝 To view logs: docker-compose logs -f"
