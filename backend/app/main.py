from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import asyncio
import uuid
import os
from typing import Dict, Optional
import time

app = FastAPI(title="Rivendell 3D Model Generator", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static model files
app.mount("/models", StaticFiles(directory="models"), name="models")

# In-memory job storage (in production, use Redis or database)
generation_jobs: Dict[str, Dict] = {}

# Load available models from the models directory
def get_available_models():
    """Scan the models directory and return available GLB files"""
    models_dir = "models"
    available_models = {}
    
    if os.path.exists(models_dir):
        for filename in os.listdir(models_dir):
            if filename.endswith('.glb'):
                # Use filename without extension as keyword
                keyword = filename.replace('.glb', '').lower()
                available_models[keyword] = filename
                print(f"Found model: {keyword} -> {filename}")
    
    return available_models

# Get available models on startup
AVAILABLE_MODELS = get_available_models()

class GenerateModelRequest(BaseModel):
    prompt: str
    x: Optional[float] = 0
    z: Optional[float] = 0

class GenerateModelResponse(BaseModel):
    job_id: str
    status: str
    message: str
    estimated_time: int

class ModelStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: Optional[float] = None
    model_url: Optional[str] = None
    error: Optional[str] = None

def find_model_by_keyword(prompt: str) -> Optional[str]:
    """Find a model file based on keywords in the prompt"""
    prompt_lower = prompt.lower()
    
    # Direct filename match first (exact keyword)
    for keyword, filename in AVAILABLE_MODELS.items():
        if keyword in prompt_lower:
            print(f"Found exact match: {keyword} -> {filename}")
            return filename
    
    # Partial keyword matching - check if any model keyword is contained in the prompt
    for keyword, filename in AVAILABLE_MODELS.items():
        # Split keyword by common separators and check each part
        keyword_parts = keyword.replace('_', ' ').replace('-', ' ').split()
        for part in keyword_parts:
            if len(part) > 2 and part in prompt_lower:  # Avoid matching very short words
                print(f"Found partial match: {part} (from {keyword}) -> {filename}")
                return filename
    
    # Reverse matching - check if prompt words are contained in model keywords
    prompt_words = prompt_lower.replace(',', ' ').replace('.', ' ').split()
    for word in prompt_words:
        if len(word) > 2:  # Skip short words like "a", "an", "the"
            for keyword, filename in AVAILABLE_MODELS.items():
                if word in keyword:
                    print(f"Found reverse match: {word} in {keyword} -> {filename}")
                    return filename
    
    return None

@app.get("/download-model/{model_name}")
async def download_model(model_name: str):
    """Download a specific model file"""
    # Ensure .glb extension
    if not model_name.endswith('.glb'):
        model_name += '.glb'
    
    model_path = f"models/{model_name}"
    
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Model not found: {model_name}")
    
    return FileResponse(
        model_path,
        media_type="application/octet-stream",
        filename=model_name
    )

@app.get("/debug/models")
async def debug_models():
    """Debug endpoint to see what models are loaded"""
    models_dir = "models"
    debug_info = {
        "models_directory_exists": os.path.exists(models_dir),
        "available_models": AVAILABLE_MODELS,
        "model_count": len(AVAILABLE_MODELS)
    }
    
    if os.path.exists(models_dir):
        all_files = os.listdir(models_dir)
        debug_info["all_files_in_models_dir"] = all_files
        debug_info["glb_files"] = [f for f in all_files if f.endswith('.glb')]
    
    return debug_info

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy", 
        "timestamp": time.time(),
        "models_loaded": len(AVAILABLE_MODELS),
        "available_keywords": list(AVAILABLE_MODELS.keys())
    }

@app.get("/")
async def root():
    return {
        "message": "Rivendell 3D Model Generator API",
        "available_models": list(AVAILABLE_MODELS.keys()),
        "model_files": list(AVAILABLE_MODELS.values()),
        "total_models": len(AVAILABLE_MODELS)
    }

@app.get("/available-models")
async def get_models():
    """Get list of available models and their keywords"""
    return {
        "models": AVAILABLE_MODELS,
        "count": len(AVAILABLE_MODELS),
        "instructions": "Use filename (without .glb) as keyword in your prompt"
    }

@app.post("/generate-model", response_model=GenerateModelResponse)
async def generate_model(request: GenerateModelRequest):
    """Generate/select a 3D model based on text prompt"""
    
    # Find matching model
    model_filename = find_model_by_keyword(request.prompt)
    
    if not model_filename:
        raise HTTPException(
            status_code=404, 
            detail=f"No model found for prompt: '{request.prompt}'. Available keywords: {list(AVAILABLE_MODELS.keys())}"
        )
    
    # Verify model file exists
    model_path = f"models/{model_filename}"
    if not os.path.exists(model_path):
        raise HTTPException(
            status_code=500,
            detail=f"Model file not found: {model_filename}"
        )
    
    # Create job and mark as immediately completed
    job_id = str(uuid.uuid4())
    generation_jobs[job_id] = {
        "status": "completed",
        "prompt": request.prompt,
        "model_filename": model_filename,
        "x": request.x,
        "z": request.z,
        "created_at": time.time(),
        "progress": 1.0,
        "model_url": f"/models/{model_filename}"
    }
    
    return GenerateModelResponse(
        job_id=job_id,
        status="completed",
        message=f"Model '{model_filename}' ready for prompt: '{request.prompt}'",
        estimated_time=0
    )

@app.post("/generate-model-direct")
async def generate_model_direct(request: GenerateModelRequest):
    """Directly return model URL without job system - for immediate use"""
    
    # Find matching model
    model_filename = find_model_by_keyword(request.prompt)
    
    if not model_filename:
        raise HTTPException(
            status_code=404, 
            detail=f"No model found for prompt: '{request.prompt}'. Available keywords: {list(AVAILABLE_MODELS.keys())}"
        )
    
    # Verify model file exists
    model_path = f"models/{model_filename}"
    if not os.path.exists(model_path):
        raise HTTPException(
            status_code=500,
            detail=f"Model file not found: {model_filename}"
        )
    
    return {
        "status": "success",
        "prompt": request.prompt,
        "model_filename": model_filename,
        "model_url": f"/models/{model_filename}",
        "x": request.x,
        "z": request.z,
        "message": f"Model '{model_filename}' found for: '{request.prompt}'"
    }

@app.get("/model-status/{job_id}", response_model=ModelStatusResponse)
async def get_model_status(job_id: str):
    """Get the status of a model generation job"""
    if job_id not in generation_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = generation_jobs[job_id]
    
    return ModelStatusResponse(
        job_id=job_id,
        status=job["status"],
        progress=job.get("progress"),
        model_url=job.get("model_url"),
        error=job.get("error")
    )

@app.get("/download-model/{model_name}")
async def download_model(model_name: str):
    """Download a specific model file."""
    model_path = f"models/{model_name}"
    
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="Model not found")
    
    return FileResponse(
        model_path,
        media_type="application/octet-stream",
        filename=model_name
    )

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": time.time()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
