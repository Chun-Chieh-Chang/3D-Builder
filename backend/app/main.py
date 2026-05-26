from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import geometry

app = FastAPI(title="3D-Builder Heavy Engine", version="0.1.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(geometry.router, prefix="/api/v1/geometry", tags=["geometry"])

@app.get("/")
async def root():
    return {"message": "3D-Builder Heavy Engine is running", "engine": "OCCT"}

@app.get("/api/v1/health")
async def health():
    return {"status": "OK"}
