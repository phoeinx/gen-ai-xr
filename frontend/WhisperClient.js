/**
 * WhisperClient - WebSocket client for real-time speech-to-text
 * Connects to the Whisper voice server for audio transcription
 */

export class WhisperClient {
    constructor(url = 'ws://localhost:9000') {
        this.url = url;
        this.websocket = null;
        this.isConnected = false;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        // Event callbacks
        this.onTranscription = null;
        this.onError = null;
        this.onStatusChange = null;
        this.onConnectionChange = null;
        
        // Audio recording settings
        this.recordingOptions = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 16000
        };
    }
    
    /**
     * Connect to the Whisper WebSocket server
     */
    async connect() {
        try {
            console.log(`Connecting to Whisper server: ${this.url}`);
            
            this.websocket = new WebSocket(this.url);
            
            this.websocket.onopen = () => {
                console.log('Connected to Whisper server');
                this.isConnected = true;
                if (this.onConnectionChange) {
                    this.onConnectionChange(true);
                }
            };
            
            this.websocket.onmessage = (event) => {
                this.handleMessage(event.data);
            };
            
            this.websocket.onclose = () => {
                console.log('Disconnected from Whisper server');
                this.isConnected = false;
                if (this.onConnectionChange) {
                    this.onConnectionChange(false);
                }
            };
            
            this.websocket.onerror = (error) => {
                console.error('Whisper WebSocket error:', error);
                if (this.onError) {
                    this.onError('WebSocket connection error');
                }
            };
            
            // Wait for connection
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                this.websocket.onopen = () => {
                    clearTimeout(timeout);
                    console.log('Connected to Whisper server');
                    this.isConnected = true;
                    if (this.onConnectionChange) {
                        this.onConnectionChange(true);
                    }
                    resolve();
                };
                
                this.websocket.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('Failed to connect to Whisper server'));
                };
            });
            
        } catch (error) {
            console.error('Connection error:', error);
            throw error;
        }
    }
    
    /**
     * Disconnect from the server
     */
    disconnect() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.isConnected = false;
        
        if (this.isRecording) {
            this.stopRecording();
        }
    }
    
    /**
     * Handle incoming messages from the server
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'connection':
                    console.log('Server connection confirmed:', message);
                    break;
                    
                case 'transcription':
                    console.log('Transcription received:', message.result);
                    if (this.onTranscription) {
                        this.onTranscription(message.result);
                    }
                    break;
                    
                case 'status':
                    console.log('Server status:', message);
                    if (this.onStatusChange) {
                        this.onStatusChange(message);
                    }
                    break;
                    
                case 'error':
                    console.error('Server error:', message.message);
                    if (this.onError) {
                        this.onError(message.message);
                    }
                    break;
                    
                case 'pong':
                    console.log('Ping response received');
                    break;
                    
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }
    
    /**
     * Send a command to the server
     */
    sendCommand(command, data = {}) {
        if (!this.isConnected || !this.websocket) {
            console.error('Not connected to server');
            return false;
        }
        
        const message = {
            command: command,
            ...data
        };
        
        this.websocket.send(JSON.stringify(message));
        return true;
    }
    
    /**
     * Ping the server
     */
    ping() {
        return this.sendCommand('ping');
    }
    
    /**
     * Get server status
     */
    getStatus() {
        return this.sendCommand('status');
    }
    
    /**
     * Start recording audio from microphone
     */
    async startRecording() {
        if (this.isRecording) {
            console.warn('Already recording');
            return;
        }
        
        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream, this.recordingOptions);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };
            
            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;
            
            console.log('Started recording audio');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            if (this.onError) {
                this.onError('Failed to access microphone: ' + error.message);
            }
            throw error;
        }
    }
    
    /**
     * Stop recording and send audio for transcription
     */
    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            console.warn('Not currently recording');
            return;
        }
        
        this.mediaRecorder.stop();
        
        // Stop all tracks to release microphone
        if (this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => {
                track.stop();
            });
        }
        
        this.isRecording = false;
        console.log('Stopped recording audio');
    }
    
    /**
     * Process recorded audio and send to server
     */
    async processRecording() {
        if (this.audioChunks.length === 0) {
            console.warn('No audio data to process');
            return;
        }
        
        try {
            // Combine audio chunks into a blob
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            
            // Convert to ArrayBuffer for WebSocket transmission
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            console.log(`Sending audio data: ${arrayBuffer.byteLength} bytes`);
            
            // Send to server
            if (this.isConnected && this.websocket) {
                this.websocket.send(arrayBuffer);
            } else {
                console.error('Cannot send audio: not connected to server');
                if (this.onError) {
                    this.onError('Not connected to server');
                }
            }
            
        } catch (error) {
            console.error('Error processing recording:', error);
            if (this.onError) {
                this.onError('Failed to process audio: ' + error.message);
            }
        }
        
        // Clean up
        this.audioChunks = [];
    }
    
    /**
     * Send audio file for transcription
     */
    async transcribeFile(file) {
        if (!this.isConnected) {
            throw new Error('Not connected to server');
        }
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log(`Sending file for transcription: ${arrayBuffer.byteLength} bytes`);
            this.websocket.send(arrayBuffer);
        } catch (error) {
            console.error('Error sending file:', error);
            throw error;
        }
    }
    
    /**
     * Check if microphone is available
     */
    static async checkMicrophoneAccess() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            return audioInputs.length > 0;
        } catch (error) {
            console.error('Error checking microphone access:', error);
            return false;
        }
    }
    
    /**
     * Request microphone permission
     */
    static async requestMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately
            return true;
        } catch (error) {
            console.error('Microphone permission denied:', error);
            return false;
        }
    }
}
