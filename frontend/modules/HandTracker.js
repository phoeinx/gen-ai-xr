// HandTracker.js - Hand tracking and gesture recognition module

import * as THREE from 'three';
import { XRHandModelFactory } from 'https://esm.sh/three@0.158.0/examples/jsm/webxr/XRHandModelFactory.js';

export class HandTracker {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    
    // Hand tracking state
    this.handModels = { left: null, right: null };
    this.pinchState = { left: false, right: false };
    this.lastPinchState = { left: false, right: false };
    this.grabbedObject = null;
    this.isHolding = false;
    this.handModelFactory = new XRHandModelFactory();
    
    // Callbacks for hand events
    this.onPinchStart = null;
    this.onPinchEnd = null;
    this.onGrabObject = null;
    this.onReleaseObject = null;
  }

  // Initialize hand tracking when XR session starts
  setupHandTracking(session) {
    if (!session || !session.inputSources) return;
    
    // Set up input sources change listener
    session.addEventListener('inputsourceschange', this._onInputSourcesChange.bind(this));
    
    // Add hand models for any hands already present
    for (const inputSource of session.inputSources) {
      if (inputSource.hand) {
        this._addHandModel(inputSource);
      }
    }
  }

  // Clean up hand tracking when XR session ends
  cleanupHandTracking() {
    // Remove hand models from scene
    for (const [handedness, handModel] of Object.entries(this.handModels)) {
      if (handModel) {
        this.scene.remove(handModel);
        this.handModels[handedness] = null;
      }
    }
    
    // Reset states
    this.pinchState = { left: false, right: false };
    this.lastPinchState = { left: false, right: false };
    this.grabbedObject = null;
    this.isHolding = false;
  }

  // Update hand tracking in animation loop
  updateHandTracking(frame) {
    if (!this.renderer.xr.isPresenting) return;
    
    const session = this.renderer.xr.getSession();
    if (!session) return;
    
    // Update each hand model
    for (const [handedness, handModel] of Object.entries(this.handModels)) {
      if (!handModel) continue;
      
      const inputSource = Array.from(session.inputSources).find(
        src => src.handedness === handedness && src.hand
      );
      
      if (inputSource && inputSource.hand) {
        try {
          const referenceSpace = this.renderer.xr.getReferenceSpace();
          const framePose = frame.getPose(inputSource.hand.get('index-finger-tip'), referenceSpace);
          
          if (framePose) {
            const isPinching = this._detectPinch(inputSource.hand, frame, referenceSpace);
            this._handlePinchGesture(handedness, isPinching, framePose.transform.position);
          }
        } catch (e) {
          // Silently handle errors in hand pose detection
        }
      }
    }
    
    // Update grabbed object position
    this._updateGrabbedObject();
  }

  // Event handler for input sources change
  _onInputSourcesChange(event) {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    
    for (const inputSource of session.inputSources) {
      if (inputSource.hand) {
        this._addHandModel(inputSource);
      }
    }
  }

  // Add hand model for a given input source
  _addHandModel(inputSource) {
    const handedness = inputSource.handedness;
    
    if (!this.handModels[handedness]) {
      const handModel = this.handModelFactory.createHandModel(inputSource);
      this.handModels[handedness] = handModel;
      this.scene.add(handModel);
      
      console.log(`Added ${handedness} hand model`);
    }
  }

  // Detect pinch gesture based on thumb-index finger distance
  _detectPinch(hand, frame, referenceSpace) {
    try {
      const thumbTip = frame.getPose(hand.get('thumb-tip'), referenceSpace);
      const indexTip = frame.getPose(hand.get('index-finger-tip'), referenceSpace);
      
      if (thumbTip && indexTip) {
        const thumbPos = new THREE.Vector3().fromArray([
          thumbTip.transform.position.x,
          thumbTip.transform.position.y,
          thumbTip.transform.position.z
        ]);
        
        const indexPos = new THREE.Vector3().fromArray([
          indexTip.transform.position.x,
          indexTip.transform.position.y,
          indexTip.transform.position.z
        ]);
        
        const distance = thumbPos.distanceTo(indexPos);
        return distance < 0.03; // 3cm threshold for pinch
      }
    } catch (e) {
      // Handle errors in pose detection
    }
    
    return false;
  }

  // Handle pinch gesture state changes
  _handlePinchGesture(handedness, isPinching, position) {
    const wasPinching = this.lastPinchState[handedness];
    this.pinchState[handedness] = isPinching;
    
    // Detect pinch start
    if (isPinching && !wasPinching) {
      this._onPinchStart(handedness, position);
    } 
    // Detect pinch end
    else if (!isPinching && wasPinching) {
      this._onPinchEnd(handedness);
    }
    
    this.lastPinchState[handedness] = isPinching;
  }

  // Handle pinch start event
  _onPinchStart(handedness, position) {
    console.log(`Pinch started with ${handedness} hand`);
    
    // Call external callback if provided
    if (this.onPinchStart) {
      this.onPinchStart(handedness, position);
    }
    
    // Default behavior: spawn object if none grabbed and models available
    if (!this.grabbedObject && this.onGrabObject) {
      const worldPosition = {
        x: position.x,
        y: position.y,
        z: position.z
      };
      
      this.onGrabObject(handedness, worldPosition);
    }
  }

  // Handle pinch end event
  _onPinchEnd(handedness) {
    console.log(`Pinch ended with ${handedness} hand`);
    
    // Call external callback if provided
    if (this.onPinchEnd) {
      this.onPinchEnd(handedness);
    }
    
    // Default behavior: release grabbed object
    if (this.grabbedObject && handedness === 'right') {
      if (this.onReleaseObject) {
        this.onReleaseObject(handedness);
      }
      
      this.grabbedObject = null;
      this.isHolding = false;
    }
  }

  // Update grabbed object position to follow hand
  _updateGrabbedObject() {
    if (this.grabbedObject && this.isHolding) {
      // Update object position based on right hand
      const rightHand = this.handModels.right;
      if (rightHand) {
        this.grabbedObject.position.copy(rightHand.position);
      }
    }
  }

  // Set grabbed object from external source
  setGrabbedObject(object) {
    this.grabbedObject = object;
    this.isHolding = !!object;
  }

  // Get current grabbed object
  getGrabbedObject() {
    return this.grabbedObject;
  }

  // Check if currently holding an object
  isHoldingObject() {
    return this.isHolding;
  }

  // Get hand model by handedness
  getHandModel(handedness) {
    return this.handModels[handedness];
  }

  // Get current pinch state for a hand
  getPinchState(handedness) {
    return this.pinchState[handedness];
  }

  // Check if any hand is currently pinching
  isAnyHandPinching() {
    return this.pinchState.left || this.pinchState.right;
  }

  // Release any currently grabbed object
  releaseGrabbedObject() {
    if (this.grabbedObject) {
      this.grabbedObject = null;
      this.isHolding = false;
      
      if (this.onReleaseObject) {
        this.onReleaseObject('manual');
      }
    }
  }
}
