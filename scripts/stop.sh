#!/bin/bash

# Stop development environment

echo "🛑 Stopping WebXR Development Environment..."

docker-compose down

echo "✅ All containers stopped"
echo "💡 To remove volumes and rebuild fresh: docker-compose down -v"
