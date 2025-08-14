// VoiceController.js - Handles voice control functionality and UI

import * as THREE from 'three';
import { WhisperClient } from '../WhisperClient.js';

export class VoiceController {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    
    // Voice control state
    this.whisperClient = null;
    this.voiceEnabled = false;
    this.isListening = false;
    
    // Controller input state for voice control
    this.controllerButtonStates = new Map();
    
    // Voice UI elements
    this.loadingBarBackground = null;
    this.loadingBarFill = null;
    this.transcribingText = null;
    this.transcriptDisplay = null;
    
    // Event handlers - to be set by parent
    this.onVoiceCommand = null;
    this.onConnectionChange = null;
    this.onError = null;
    
    // Initialize voice control
    this._initVoiceControl();
    this._createVoiceUI();
  }

  async _initVoiceControl() {
    try {
      // Initialize Whisper client
      const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const whisperUrl = `${wsScheme}://${location.host}/whisper/ws`;
      this.whisperClient = new WhisperClient(whisperUrl);
      
      // Set up event handlers
      this.whisperClient.onTranscription = (result) => {
        this._handleVoiceCommand(result.text);
      };
      
      this.whisperClient.onError = (error) => {
        console.error('Voice control error:', error);
        if (this.onError) {
          this.onError(error);
        }
        if (window.showMessage) {
          window.showMessage(`Voice error: ${error}`);
        }
      };
      
      this.whisperClient.onConnectionChange = (connected) => {
        this.voiceEnabled = connected;
        console.log(`Voice control ${connected ? 'enabled' : 'disabled'}`);
        if (this.onConnectionChange) {
          this.onConnectionChange(connected);
        }
        if (window.showMessage) {
          window.showMessage(`Voice control ${connected ? 'enabled' : 'disabled'}`);
        }
      };
      
      // Try to connect
      await this.whisperClient.connect();
      
    } catch (error) {
      console.warn('Voice control not available:', error);
      this.voiceEnabled = false;
    }
  }

  _handleVoiceCommand(text) {
    const command = text.toLowerCase().trim();
    console.log('Voice command received:', command);
    
    // Show transcript
    this._showTranscript(text);
    
    // Delegate to parent handler if available
    if (this.onVoiceCommand) {
      this.onVoiceCommand(text, command);
    }
  }

  startVoiceListening() {
    if (!this.voiceEnabled || !this.whisperClient) {
      if (window.showMessage) {
        window.showMessage('❌ Voice control not available. Check Whisper server connection.');
      }
      console.warn('Voice control not available');
      return false;
    }
    
    if (this.isListening) {
      console.warn('Already listening');
      return false;
    }
    
    this.whisperClient.startRecording();
    this.isListening = true;
    
    // Show visual feedback
    this._showVoiceIndicator(true);
    
    if (window.showMessage) {
      window.showMessage('🎤 Listening... Say a model name: car, tree, cactus, bonfire, etc.');
    }
    
    return true;
  }

  stopVoiceListening() {
    if (!this.isListening || !this.whisperClient) {
      return false;
    }
    
    this.whisperClient.stopRecording();
    this.isListening = false;
    
    // Hide visual feedback
    this._showVoiceIndicator(false);
    
    if (window.showMessage) {
      window.showMessage('🔄 Processing your voice command...');
    }
    
    return true;
  }

  toggleVoiceListening() {
    if (!this.isListening) {
      return this.startVoiceListening();
    } else {
      return this.stopVoiceListening();
    }
  }

  // Controller input handling for voice control
  setupControllerInputListeners(inputSource) {
    // Initialize button state tracking for this controller
    if (!this.controllerButtonStates.has(inputSource)) {
      this.controllerButtonStates.set(inputSource, {
        bButton: false,
        lastBButton: false
      });
    }
  }

  updateControllerInput(session) {
    if (!session) return;

    // Check all input sources for gamepad input
    for (const inputSource of session.inputSources) {
      if (inputSource.gamepad) {
        this._checkControllerButtons(inputSource);
      }
    }
  }

  _checkControllerButtons(inputSource) {
    const gamepad = inputSource.gamepad;
    if (!gamepad || !gamepad.buttons) return;

    // Get or initialize button state for this controller
    let buttonState = this.controllerButtonStates.get(inputSource);
    if (!buttonState) {
      buttonState = { bButton: false, lastBButton: false };
      this.controllerButtonStates.set(inputSource, buttonState);
    }

    // Check B button (typically button index 1 on most XR controllers)
    // Button 1 is commonly the B button on Oculus/Meta controllers
    const bButtonPressed = gamepad.buttons[1] && gamepad.buttons[1].pressed;
    
    // Detect button press (not held)
    if (bButtonPressed && !buttonState.lastBButton) {
      // B button was just pressed - toggle voice recording
      console.log('B button pressed - toggling voice listening');
      this.toggleVoiceListening();
    }

    // Update button states
    buttonState.lastBButton = buttonState.bButton;
    buttonState.bButton = bButtonPressed;
  }

  // Voice UI methods for visual feedback
  _createVoiceUI() {
    // Create loading bar background
    const loadingBarGeometry = new THREE.PlaneGeometry(1.2, 0.1);
    const loadingBarMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.loadingBarBackground = new THREE.Mesh(loadingBarGeometry, loadingBarMaterial);
    this.loadingBarBackground.visible = false;
    
    // Create loading bar fill
    const loadingFillGeometry = new THREE.PlaneGeometry(1.2, 0.1);
    const loadingFillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    this.loadingBarFill = new THREE.Mesh(loadingFillGeometry, loadingFillMaterial);
    this.loadingBarFill.visible = false;
    
    // Create "Transcribing..." text
    const transcribingCanvas = document.createElement('canvas');
    transcribingCanvas.width = 512;
    transcribingCanvas.height = 64;
    const transcribingContext = transcribingCanvas.getContext('2d');
    transcribingContext.fillStyle = 'rgba(0, 0, 0, 0)';
    transcribingContext.fillRect(0, 0, transcribingCanvas.width, transcribingCanvas.height);
    transcribingContext.fillStyle = 'white';
    transcribingContext.font = 'bold 32px Arial';
    transcribingContext.textAlign = 'center';
    transcribingContext.textBaseline = 'middle';
    transcribingContext.fillText('Transcribing...', transcribingCanvas.width / 2, transcribingCanvas.height / 2);
    
    const transcribingTexture = new THREE.CanvasTexture(transcribingCanvas);
    const transcribingGeometry = new THREE.PlaneGeometry(1, 0.125);
    const transcribingMaterial = new THREE.MeshBasicMaterial({
      map: transcribingTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.transcribingText = new THREE.Mesh(transcribingGeometry, transcribingMaterial);
    this.transcribingText.visible = false;
    
    // Create transcript display plane
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    const texture = new THREE.CanvasTexture(canvas);
    const transcriptGeometry = new THREE.PlaneGeometry(1, 0.25);
    const transcriptMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.transcriptDisplay = new THREE.Mesh(transcriptGeometry, transcriptMaterial);
    this.transcriptDisplay.visible = false;
    
    // Add to camera so they follow the user
    this.camera.add(this.loadingBarBackground);
    this.camera.add(this.loadingBarFill);
    this.camera.add(this.transcribingText);
    this.camera.add(this.transcriptDisplay);
  }

  _showVoiceIndicator(show) {
    if (!this.loadingBarBackground || !this.loadingBarFill || !this.transcribingText) return;
    
    this.loadingBarBackground.visible = show;
    this.loadingBarFill.visible = show;
    this.transcribingText.visible = show;
    
    if (show) {
      // Position elements in view
      this.loadingBarBackground.position.set(0, 0.6, -2);
      this.loadingBarFill.position.set(0, 0.6, -1.99); // Slightly in front
      this.transcribingText.position.set(0, 0.75, -2);
      
      // Initialize loading progress
      this.loadingBarFill.userData.startTime = performance.now();
      this.loadingBarFill.scale.set(0, 1, 1); // Start with no width
    }
  }

  _showTranscript(text) {
    if (!this.transcriptDisplay) return;
    
    // Update canvas with new text
    const canvas = this.transcriptDisplay.material.map.image;
    const context = canvas.getContext('2d');
    
    // Clear canvas
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.fillStyle = 'white';
    context.font = '24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Word wrap for long text
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = context.measureText(testLine);
      if (metrics.width > canvas.width - 20 && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    
    // Draw lines
    const lineHeight = 30;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
    }
    
    // Update texture
    this.transcriptDisplay.material.map.needsUpdate = true;
    
    // Show transcript and position below voice indicator
    this.transcriptDisplay.visible = true;
    this.transcriptDisplay.position.set(0, 0.2, -2);
    
    // Hide transcript after 4 seconds
    setTimeout(() => {
      if (this.transcriptDisplay) {
        this.transcriptDisplay.visible = false;
      }
    }, 4000);
  }

  updateVoiceUI(time) {
    // Animate loading bar progress
    if (this.loadingBarFill && this.loadingBarFill.visible) {
      const elapsed = (time - (this.loadingBarFill.userData.startTime || 0)) * 0.001;
      // Create a smooth back-and-forth loading animation
      const progress = (Math.sin(elapsed * 2) + 1) / 2; // Oscillate between 0 and 1
      this.loadingBarFill.scale.set(progress, 1, 1);
      
      // Add subtle color pulse to the loading bar
      const colorIntensity = 0.8 + Math.sin(elapsed * 4) * 0.2; // Pulse between 0.6 and 1.0
      this.loadingBarFill.material.opacity = colorIntensity;
    }
  }

  // Cleanup method
  dispose() {
    if (this.whisperClient) {
      // Clean up whisper client if needed
      this.whisperClient = null;
    }
    
    // Remove UI elements from camera
    if (this.loadingBarBackground && this.camera) {
      this.camera.remove(this.loadingBarBackground);
      this.camera.remove(this.loadingBarFill);
      this.camera.remove(this.transcribingText);
      this.camera.remove(this.transcriptDisplay);
    }
    
    // Dispose geometries and materials
    this.loadingBarBackground?.geometry?.dispose();
    this.loadingBarBackground?.material?.dispose();
    this.loadingBarFill?.geometry?.dispose();
    this.loadingBarFill?.material?.dispose();
    this.transcribingText?.geometry?.dispose();
    this.transcribingText?.material?.dispose();
    this.transcriptDisplay?.geometry?.dispose();
    this.transcriptDisplay?.material?.dispose();
  }

  // Getters for state
  get enabled() {
    return this.voiceEnabled;
  }

  get listening() {
    return this.isListening;
  }
}
