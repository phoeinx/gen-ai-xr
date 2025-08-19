import os, io, json, uuid, hashlib, time, asyncio
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import replicate

# Load environment variables from .env file
load_dotenv()

# ---- Config ----
DATA_DIR = os.getenv("DATA_DIR", "data")
STATIC_MODELS_DIR = os.path.join(DATA_DIR, "static_models")
MODELS_DIR = os.path.join(DATA_DIR, "models")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
STATIC_INDEX_PATH = os.path.join(DATA_DIR, "static_index.json")
EXTERNAL_API_URL = os.getenv(
    "EXTERNAL_API_URL", "http://external-model/api/generate"
)  # replace when ready
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")
os.environ["REPLICATE_API_TOKEN"] = REPLICATE_API_TOKEN  # Set for replicate client

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STATIC_MODELS_DIR, exist_ok=True)

# ---- DB (SQLite) ----
DB_PATH = os.getenv("DB_PATH", os.path.join(DATA_DIR, "app.db"))
engine = sa.create_engine(
    f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class Task(Base):
    __tablename__ = "tasks"
    id = sa.Column(sa.String, primary_key=True)
    status = sa.Column(
        sa.String, nullable=False
    )  # queued | started | finished | failed
    filename = sa.Column(sa.String, nullable=True)
    error = sa.Column(sa.String, nullable=True)


class ImageCache(Base):
    __tablename__ = "image_cache"
    hash = sa.Column(sa.String, primary_key=True)  # normalized SHA256
    filename = sa.Column(sa.String, nullable=False)


Base.metadata.create_all(bind=engine)

# ---- App ----

app = FastAPI(title="3D Model Generator", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve models directly at /models/<filename>
app.mount("/models", StaticFiles(directory=MODELS_DIR), name="models")
app.mount(
    "/static_models", StaticFiles(directory=STATIC_MODELS_DIR), name="static_models"
)

class TextReq(BaseModel):
    prompt: str


# ---- Helpers ----
def normalize_bytes_for_hash(raw: bytes) -> bytes:
    """
    Canonicalize image by decoding and re-encoding to PNG (strips EXIF/metadata,
    normalizes color space). Using PNG ensures deterministic bytes for exact-match caching.
    """
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_static_index() -> dict:
    # list data dir
    print(os.listdir(DATA_DIR))
    if not os.path.exists(STATIC_INDEX_PATH):
        return {}
    with open(STATIC_INDEX_PATH, "r") as f:
        return json.load(f)


def keyword_match(prompt: str, index: dict) -> Optional[str]:
    p = prompt.lower()
    best, best_score = None, 0
    print(index)
    # index format example: {"office_chair_wheels.glb": ["chair","wheels","office"]}
    for fname, kws in index.items():
        score = sum(1 for k in kws if k in p)
        if score > best_score:
            best, best_score = fname, score
    return best


def call_external_model(image_path: str) -> bytes:
    """
    Replace with a real HTTP call when ready, e.g.:
      files = {"file": ("upload.png", open(image_path, "rb"), "image/png")}
      resp = requests.post(EXTERNAL_API_URL, files=files, timeout=120)
      resp.raise_for_status()
      return resp.content
    """
    output = replicate.run(
        "firtoz/trellis:e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c",
        input={
            "seed": 0,
            "images": [open(image_path, "rb")],
            "texture_size": 2048,
            "mesh_simplify": 0.9,
            "generate_color": True,
            "generate_model": True,
            "randomize_seed": True,
            "generate_normal": False,
            "save_gaussian_ply": True,
            "ss_sampling_steps": 38,
            "slat_sampling_steps": 12,
            "return_no_background": False,
            "ss_guidance_strength": 7.5,
            "slat_guidance_strength": 3,
        },
    )
    return output["model_file"].read()


def safe_filename(stem: str, ext=".glb") -> str:
    stem = "".join(c for c in stem if c.isalnum() or c in ("-", "_"))[:64]
    return stem + ext


def background_generate(task_id: str, image_bytes: bytes):
    session = SessionLocal()
    try:
        # mark started
        t = session.get(Task, task_id)
        if not t:
            return
        t.status = "started"
        session.commit()

        # Persist upload (optional)
        upload_path = os.path.join(UPLOADS_DIR, f"{task_id}.png")
        with open(upload_path, "wb") as f:
            f.write(image_bytes)

        # External call
        model_bytes = call_external_model(upload_path)

        # Save model
        short_hash = sha256(image_bytes)[:8]
        out_name = safe_filename(f"model-{short_hash}")
        out_path = os.path.join(MODELS_DIR, out_name)
        with open(out_path, "wb") as f:
            f.write(model_bytes)

        # Update cache (exact image → filename)
        ic = ImageCache(hash=sha256(image_bytes), filename=out_name)
        session.merge(ic)

        # Mark finished
        t.filename = out_name
        t.status = "finished"
        session.commit()
    except Exception as e:
        t = session.get(Task, task_id)
        if t:
            t.status = "failed"
            t.error = str(e)[:1000]
            session.commit()
    finally:
        session.close()


@app.post("/generate-model/text")
def generate_model_text(req: TextReq, request: Request):
    index = load_static_index()
    fname = keyword_match(req.prompt, index)
    if not fname:
        raise HTTPException(404, "No static model match")
    path = os.path.join(STATIC_MODELS_DIR, fname)
    print(f"/api/static_models/{fname}")
    if not os.path.exists(path):
        raise HTTPException(500, "Model file missing on server")
    return {"filename": fname, "url": f"/api/static_models/{fname}", "source": "static"}


@app.post("/generate-model/image")
async def generate_model_image(
    background: BackgroundTasks, file: UploadFile = File(...)
):
    raw = await file.read()
    if not raw or len(raw) > 15 * 1024 * 1024:
        raise HTTPException(400, "Invalid file size")

    # Normalize + exact-duplicate cache
    try:
        norm = normalize_bytes_for_hash(raw)
    except Exception:
        raise HTTPException(400, "Unsupported or corrupted image")
    h = sha256(norm)

    session = SessionLocal()
    try:
        cached = session.get(ImageCache, h)
        if cached:
            url = f"/api/models/{cached.filename}"
            return {"filename": cached.filename, "url": url, "source": "cache"}

        # Create task, enqueue background work
        task_id = str(uuid.uuid4())
        session.add(Task(id=task_id, status="queued"))
        session.commit()

        background.add_task(background_generate, task_id=task_id, image_bytes=norm)
        return {"task_id": task_id, "status_url": f"/tasks/{task_id}"}
    finally:
        session.close()


@app.get("/tasks/{task_id}")
def task_status(task_id: str, request: Request):
    session = SessionLocal()
    try:
        t = session.get(Task, task_id)
        if not t:
            raise HTTPException(404, "Task not found")
        data = {"status": t.status}
        if t.status == "finished":
            data["filename"] = t.filename
            base = str(request.base_url).rstrip("/")
            data["url"] = f"{base}/models/{t.filename}"
        if t.status == "failed":
            data["error"] = t.error
        return data
    finally:
        session.close()


# ---- NEW: SSE endpoint for task updates ----
# ...existing code...
@app.get("/tasks/{task_id}/events")
async def task_events(task_id: str, request: Request):

    async def event_gen():
        last_status = None
        # Hint client to retry quickly
        yield "retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                break

            session = SessionLocal()
            try:
                t = session.get(Task, task_id)
                if not t:
                    yield 'event: status\ndata: {"status":"not_found"}\n\n'
                    break

                if t.status != last_status:
                    payload = {"status": t.status}
                    if t.status == "finished":
                        payload["filename"] = t.filename
                        payload["url"] = f"/api/models/{t.filename}"
                    if t.status == "failed":
                        payload["error"] = t.error
                    yield f"event: status\ndata: {json.dumps(payload)}\n\n"
                    last_status = t.status

                if t.status in ("finished", "failed"):
                    break
            finally:
                session.close()

            # Heartbeat + cadence
            yield ": keep-alive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},  # for nginx
    )

@app.get("/download-model")
def download_model(filename: str):
    safe = os.path.basename(filename)
    path = os.path.join(MODELS_DIR, safe)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")
    # Use appropriate media type for GLB
    return {
        "filename": safe,
        "url": f"/api/static_models/{safe}",
        "source": "generated",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": time.time()}
