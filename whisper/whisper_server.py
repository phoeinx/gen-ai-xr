#!/usr/bin/env python3
"""
Whisper Voice Server with WebSocket support
Provides real-time speech-to-text transcription using OpenAI's Whisper model
"""

import asyncio
import json
import logging
import io
import tempfile
import os
from typing import Optional, Dict, Any
import websockets
import whisper
import torch
import soundfile as sf
import numpy as np
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class WhisperServer:
    def __init__(self, model_size: str = "base", device: str = "auto"):
        """
        Initialize Whisper server
        
        Args:
            model_size: Whisper model size (tiny, base, small, medium, large)
            device: Device to run on (auto, cpu, cuda)
        """
        self.model_size = model_size
        self.device = self._determine_device(device)
        self.model: Optional[whisper.Whisper] = None
        self.clients: Dict[str, websockets.WebSocketServerProtocol] = {}
        
        logger.info(f"Initializing Whisper server with model '{model_size}' on device '{self.device}'")
    
    def _determine_device(self, device: str) -> str:
        """Determine the best device to use"""
        if device == "auto":
            if torch.cuda.is_available():
                return "cuda"
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                return "mps"  # Apple Silicon
            else:
                return "cpu"
        return device
    
    async def initialize_model(self):
        """Load the Whisper model asynchronously"""
        try:
            logger.info(f"Loading Whisper model '{self.model_size}' on {self.device}...")
            
            # Load model in a thread to avoid blocking
            loop = asyncio.get_event_loop()
            self.model = await loop.run_in_executor(
                None, 
                lambda: whisper.load_model(self.model_size, device=self.device)
            )
            
            logger.info("Whisper model loaded successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            return False
    
    async def transcribe_audio(self, audio_data: bytes, language: str = None) -> Dict[str, Any]:
        """
        Transcribe audio data using Whisper
        
        Args:
            audio_data: Raw audio bytes
            language: Optional language hint
            
        Returns:
            Dictionary with transcription results
        """
        if not self.model:
            return {"error": "Model not loaded"}
        
        try:
            # Save audio data to temporary file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_file.write(audio_data)
                temp_file_path = temp_file.name
            
            try:
                # Transcribe audio
                logger.info("Transcribing audio...")
                loop = asyncio.get_event_loop()
                
                result = await loop.run_in_executor(
                    None,
                    lambda: self.model.transcribe(
                        temp_file_path,
                        language=language,
                        fp16=False,  # Use fp32 for better compatibility
                        verbose=False
                    )
                )
                
                # Extract relevant information
                transcription = {
                    "text": result["text"].strip(),
                    "language": result["language"],
                    "segments": [
                        {
                            "start": seg["start"],
                            "end": seg["end"],
                            "text": seg["text"].strip()
                        }
                        for seg in result["segments"]
                    ]
                }
                
                logger.info(f"Transcription completed: '{transcription['text']}'")
                return transcription
                
            finally:
                # Clean up temporary file
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
                    
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return {"error": str(e)}
    
    async def handle_client(self, websocket, path):
        """Handle WebSocket client connections"""
        client_id = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        logger.info(f"Client connected: {client_id}")
        
        self.clients[client_id] = websocket
        
        try:
            # Send welcome message
            await websocket.send(json.dumps({
                "type": "connection",
                "status": "connected",
                "model": self.model_size,
                "device": self.device
            }))
            
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        # Handle binary audio data
                        logger.info(f"Received audio data from {client_id}: {len(message)} bytes")
                        
                        # Send acknowledgment
                        await websocket.send(json.dumps({
                            "type": "status",
                            "message": "Processing audio..."
                        }))
                        
                        # Transcribe audio
                        result = await self.transcribe_audio(message)
                        
                        # Send result back to client
                        await websocket.send(json.dumps({
                            "type": "transcription",
                            "result": result,
                            "timestamp": asyncio.get_event_loop().time()
                        }))
                        
                    else:
                        # Handle text messages (JSON commands)
                        try:
                            data = json.loads(message)
                            await self.handle_command(websocket, data)
                        except json.JSONDecodeError:
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": "Invalid JSON format"
                            }))
                            
                except Exception as e:
                    logger.error(f"Error processing message from {client_id}: {e}")
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": str(e)
                    }))
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client disconnected: {client_id}")
        except Exception as e:
            logger.error(f"Connection error with {client_id}: {e}")
        finally:
            if client_id in self.clients:
                del self.clients[client_id]
    
    async def handle_command(self, websocket, data: Dict[str, Any]):
        """Handle JSON commands from clients"""
        command = data.get("command")
        
        if command == "ping":
            await websocket.send(json.dumps({
                "type": "pong",
                "timestamp": asyncio.get_event_loop().time()
            }))
            
        elif command == "status":
            await websocket.send(json.dumps({
                "type": "status",
                "model": self.model_size,
                "device": self.device,
                "clients_connected": len(self.clients),
                "model_loaded": self.model is not None
            }))
            
        elif command == "transcribe_file":
            # Handle file transcription if needed
            file_path = data.get("file_path")
            if file_path and os.path.exists(file_path):
                with open(file_path, "rb") as f:
                    audio_data = f.read()
                result = await self.transcribe_audio(audio_data, data.get("language"))
                await websocket.send(json.dumps({
                    "type": "transcription",
                    "result": result,
                    "source": "file",
                    "file_path": file_path
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "File not found or path not provided"
                }))
        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown command: {command}"
            }))
    
    async def start_server(self, host: str = "0.0.0.0", port: int = 9000):
        """Start the WebSocket server"""
        logger.info(f"Starting Whisper WebSocket server on {host}:{port}")
        
        # Initialize model first
        if not await self.initialize_model():
            logger.error("Failed to initialize model, server cannot start")
            return
        
        # Start WebSocket server
        async with websockets.serve(
            self.handle_client,
            host,
            port,
            ping_interval=30,
            ping_timeout=10,
            max_size=50 * 1024 * 1024,  # 50MB max message size for large audio files
        ):
            logger.info(f"Whisper server is running on ws://{host}:{port}")
            logger.info("Server ready to accept connections")
            
            # Keep server running
            await asyncio.Future()  # Run forever

async def main():
    """Main entry point"""
    # Configuration
    model_size = os.getenv("WHISPER_MODEL", "base")  # tiny, base, small, medium, large
    device = os.getenv("WHISPER_DEVICE", "auto")     # auto, cpu, cuda, mps
    host = os.getenv("WHISPER_HOST", "0.0.0.0")
    port = int(os.getenv("WHISPER_PORT", "9000"))
    
    # Create and start server
    server = WhisperServer(model_size=model_size, device=device)
    
    try:
        await server.start_server(host=host, port=port)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
