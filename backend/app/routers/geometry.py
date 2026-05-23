from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.services import geometry_service

router = APIRouter()

class BoxParams(BaseModel):
    width: float = 10.0
    height: float = 10.0
    depth: float = 10.0
    w: Optional[float] = None
    h: Optional[float] = None
    d: Optional[float] = None

class CylinderParams(BaseModel):
    radius: float = 5.0
    height: float = 10.0

class SphereParams(BaseModel):
    radius: float = 5.0

class FeatureDefinition(BaseModel):
    id: str
    type: str  # 'BOX', 'CYLINDER', 'SPHERE'
    parameters: dict

class AssemblyRequest(BaseModel):
    features: List[FeatureDefinition]

@router.post("/box")
async def create_box(params: BoxParams):
    try:
        final_w = params.w if params.w is not None else params.width
        final_h = params.h if params.h is not None else params.height
        final_d = params.d if params.d is not None else params.depth
        return geometry_service.generate_box(final_w, final_h, final_d)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cylinder")
async def create_cylinder(params: CylinderParams):
    try:
        return geometry_service.generate_cylinder(params.radius, params.height)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sphere")
async def create_sphere(params: SphereParams):
    try:
        return geometry_service.generate_sphere(params.radius)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rebuild")
async def rebuild_assembly(request: AssemblyRequest):
    try:
        print("[DEBUG] Rebuild Request Features:", [f.dict() for f in request.features])
        # We now process the entire feature tree as a single B-Rep solid (SolidWorks Part style)
        result = geometry_service.process_features(request.features)
        if result:
            # Return as a single mesh item for the renderer to display as one part
            return [result] 
        return []
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class MassPropertiesRequest(BaseModel):
    features: List[FeatureDefinition]

@router.post("/mass_properties")
async def get_mass_properties(request: MassPropertiesRequest):
    try:
        props = geometry_service.calculate_mass_properties(request.features)
        if props is None:
            raise HTTPException(status_code=500, detail="Failed to calculate physical properties for shape.")
        return props
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class ExportRequest(BaseModel):
    features: List[FeatureDefinition]
    format: str  # 'STEP', 'IGES', 'STL'
    filepath: str

@router.post("/export")
async def export_cad(request: ExportRequest):
    try:
        success = geometry_service.export_cad_file(request.features, request.format, request.filepath)
        if not success:
            raise HTTPException(status_code=500, detail=f"Failed to export shape as {request.format} to {request.filepath}")
        return {
            "status": "SUCCESS",
            "filepath": request.filepath,
            "message": f"Successfully exported to {request.filepath}"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class ExportStepRequest(BaseModel):
    features: List[FeatureDefinition]
    filename: Optional[str] = "part.step"

@router.post("/export/step")
async def export_step(request: ExportStepRequest):
    try:
        import os
        # Safely determine a dynamic download/export folder
        target_dir = os.path.join(os.path.expanduser("~"), "Downloads")
        os.makedirs(target_dir, exist_ok=True)
        filepath = os.path.join(target_dir, request.filename)
        
        success = geometry_service.export_cad_file(request.features, "STEP", filepath)
        if not success:
            raise HTTPException(status_code=500, detail="STEP writer failed to save shape.")
            
        return {
            "status": "SUCCESS", 
            "filepath": filepath, 
            "message": f"Successfully exported to {request.filename}"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



class ProjectRequest(BaseModel):
    features: List[FeatureDefinition]
    plane: str = 'FRONT'

@router.post("/project")
async def project_2d(request: ProjectRequest):
    try:
        return geometry_service.project_2d(request.features, request.plane)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class SelectedTopologyDefinition(BaseModel):
    type: str  # 'FACE' or 'EDGE' or 'VERTEX'
    id: str
    coordinates: List[float]
    normal: Optional[List[float]] = None
    edgeData: Optional[dict] = None

class ConvertEntitiesRequest(BaseModel):
    features: List[FeatureDefinition]
    selectedTopology: SelectedTopologyDefinition
    activePlane: str
    activeFaceOrigin: Optional[List[float]] = None
    activeFaceNormal: Optional[List[float]] = None

class OffsetEntitiesRequest(BaseModel):
    points: List[list]
    distance: float
    planeType: str
    activeFaceOrigin: Optional[List[float]] = None
    activeFaceNormal: Optional[List[float]] = None

class IntersectionCurveRequest(BaseModel):
    features: List[FeatureDefinition]
    activePlane: str
    activeFaceOrigin: Optional[List[float]] = None
    activeFaceNormal: Optional[List[float]] = None


@router.post("/convert_entities")
async def convert_entities(request: ConvertEntitiesRequest):
    try:
        return geometry_service.convert_entities(
            request.features,
            request.selectedTopology.dict(),
            request.activePlane,
            request.activeFaceOrigin,
            request.activeFaceNormal
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/offset_entities")
async def offset_entities(request: OffsetEntitiesRequest):
    try:
        return geometry_service.offset_entities(
            request.points,
            request.distance,
            request.planeType,
            request.activeFaceOrigin,
            request.activeFaceNormal
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/intersection_curve")
async def get_intersection_curve(request: IntersectionCurveRequest):
    try:
        return geometry_service.get_intersection_curve(
            request.features,
            request.activePlane,
            request.activeFaceOrigin,
            request.activeFaceNormal
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class RefPlaneRequest(BaseModel):
    planeType: str
    refs: List[dict]
    offset: Optional[float] = 0.0
    features: List[FeatureDefinition]

class RefAxisRequest(BaseModel):
    axisType: str
    refs: List[dict]
    features: List[FeatureDefinition]


@router.post("/ref_plane")
async def create_ref_plane(request: RefPlaneRequest):
    try:
        return geometry_service.generate_reference_plane(
            request.planeType,
            request.refs,
            request.offset,
            request.features
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ref_axis")
async def create_ref_axis(request: RefAxisRequest):
    try:
        return geometry_service.generate_reference_axis(
            request.axisType,
            request.refs,
            request.features
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
