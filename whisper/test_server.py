#!/usr/bin/env python3
"""
Test script for Whisper server
Run this to test the server locally before Docker deployment
"""

import asyncio
import json
import websockets
import sys

async def test_whisper_server():
    uri = "ws://localhost:9000"
    
    try:
        print(f"Connecting to {uri}...")
        async with websockets.connect(uri) as websocket:
            print("Connected successfully!")
            
            # Test ping
            await websocket.send(json.dumps({"command": "ping"}))
            response = await websocket.recv()
            print(f"Ping response: {response}")
            
            # Test status
            await websocket.send(json.dumps({"command": "status"}))
            response = await websocket.recv()
            print(f"Status response: {response}")
            
            print("Test completed successfully!")
            
    except Exception as e:
        print(f"Test failed: {e}")
        return False
    
    return True

if __name__ == "__main__":
    success = asyncio.run(test_whisper_server())
    sys.exit(0 if success else 1)
