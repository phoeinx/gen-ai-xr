# Whisper Voice Server

This service provides real-time speech-to-text transcription using OpenAI's Whisper model via WebSocket connections.

## Features

- **Real-time transcription**: WebSocket-based audio streaming
- **Multiple model sizes**: Support for tiny, base, small, medium, and large Whisper models
- **Cross-platform**: Supports CPU, CUDA, and Apple Silicon (MPS)
- **Voice commands**: Integrated with the XR visualization for voice control

## Configuration

Environment variables:
- `WHISPER_MODEL`: Model size (default: "base")
  - Options: "tiny", "base", "small", "medium", "large"
- `WHISPER_DEVICE`: Compute device (default: "auto")
  - Options: "auto", "cpu", "cuda", "mps"
- `WHISPER_HOST`: Server host (default: "0.0.0.0")
- `WHISPER_PORT`: Server port (default: "9000")

## WebSocket API

### Connection

Connect to `ws://localhost:9000` (or your configured host/port)

### Message Types

#### Text Commands (JSON)
```json
{
  "command": "ping"
}
```

```json
{
  "command": "status"
}
```

#### Audio Data (Binary)
Send raw audio data as binary WebSocket message. Supported formats:
- WebM/Opus (recommended for web browsers)
- WAV, MP3, M4A, etc.

### Response Types

#### Connection Confirmation
```json
{
  "type": "connection",
  "status": "connected",
  "model": "base",
  "device": "cpu"
}
```

#### Transcription Result
```json
{
  "type": "transcription",
  "result": {
    "text": "Hello world",
    "language": "en",
    "segments": [
      {
        "start": 0.0,
        "end": 1.2,
        "text": "Hello world"
      }
    ]
  },
  "timestamp": 1234567890.123
}
```

#### Status Response
```json
{
  "type": "status",
  "model": "base",
  "device": "cpu",
  "clients_connected": 1,
  "model_loaded": true
}
```

#### Error
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Voice Commands

The frontend supports these voice commands:

- **"spawn flower"** / **"create flower"**: Spawn a flower at current location
- **"create [object]"** / **"generate [object]"** / **"make [object]"**: Generate an AI object
- **"place"** / **"drop"**: Place currently held object
- **"clear sky"** / **"bright sky"**: Set sky to clear
- **"dark sky"** / **"cloudy sky"**: Set sky to cloudy

## Usage in Frontend

```javascript
import { WhisperClient } from './WhisperClient.js';

const client = new WhisperClient('ws://localhost:9000');

// Set up event handlers
client.onTranscription = (result) => {
  console.log('Transcription:', result.text);
};

client.onError = (error) => {
  console.error('Error:', error);
};

// Connect and start recording
await client.connect();
await client.startRecording();

// Stop recording and get transcription
client.stopRecording();
```

## Testing

Run the test script to verify the server:

```bash
cd whisper
python test_server.py
```

## Performance Notes

- **Model Size vs Speed**: Larger models are more accurate but slower
  - tiny: ~39 MB, fastest
  - base: ~74 MB, good balance
  - small: ~244 MB, better accuracy
  - medium: ~769 MB, high accuracy
  - large: ~1550 MB, best accuracy

- **Device Selection**: 
  - CUDA (NVIDIA GPU): Fastest for large models
  - MPS (Apple Silicon): Good performance on M1/M2 Macs
  - CPU: Slowest but most compatible

- **Audio Quality**: Higher quality audio (16kHz+, low noise) improves transcription accuracy

## Troubleshooting

### Common Issues

1. **Model download fails**: Check internet connection, models are downloaded on first use
2. **CUDA out of memory**: Use a smaller model or switch to CPU
3. **WebSocket connection fails**: Check firewall settings and port availability
4. **Poor transcription quality**: Use higher quality audio input or larger model

### Logs

View server logs:
```bash
docker-compose logs whisper
```

### Manual Testing

Test the server directly:
```bash
# In whisper directory
python whisper_server.py
```

Then connect with the test client:
```bash
python test_server.py
```
