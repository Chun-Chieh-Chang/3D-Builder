from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakePrism
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCC.Core.BRep import BRep_Tool
from OCC.Core.gp import gp_Trsf, gp_Vec, gp_Pnt, gp_Dir, gp_Ax2, gp_Ax3
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
import math
from OCC.Core.GC import GC_MakeArcOfCircle

def _shape_to_mesh(shape, deflection=0.01):
    """Converts an OCCT shape to a mesh format for Three.js."""
    if shape.IsNull():
        return None
    
    # Use a finer deflection for industrial smoothness
    BRepMesh_IncrementalMesh(shape, deflection)
    vertices = []
    indices = []
    normals = []
    
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = explorer.Current()
        location = face.Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            node_offset = len(vertices) // 3
            # Extract vertices and apply location transformation
            trsf = location.Transformation()
            for i in range(1, triangulation.NbNodes() + 1):
                pnt = triangulation.Node(i)
                # Apply transformation to pnt
                pnt.Transform(trsf)
                vertices.extend([pnt.X(), pnt.Y(), pnt.Z()])
                
            # Extract triangles (indices)
            for i in range(1, triangulation.NbTriangles() + 1):
                tri = triangulation.Triangle(i)
                idx1, idx2, idx3 = tri.Get()
                # OCCT indices are 1-based
                indices.extend([idx1 - 1 + node_offset, idx2 - 1 + node_offset, idx3 - 1 + node_offset])
                
        explorer.Next()
        
    return {
        "vertices": vertices,
        "indices": indices,
        "normals": normals
    }

def process_features(features):
    """
    The Core CAD Kernel: Processes a sequence of parametric features to build a B-Rep model.
    Implements the 'Sketch -> Extrude' workflow with Datum Plane support.
    Supports BOX, CYLINDER, SPHERE, and EXTRUDE features.
    """
    final_shape = None
    
    for feat in features:
        # Support both Pydantic models (with attribute access) and plain dicts
        if hasattr(feat, 'type'):
            f_type = feat.type
            params = feat.parameters
        else:
            f_type = feat.get('type')
            params = feat.get('parameters', {})
            
        current_feat_shape = None
        op = params.get('operation', 'ADD')
        
        if f_type == 'SKETCH_POLYLINE' or f_type == 'EXTRUDE':
            # Support both explicit Sketch and the unified Extrude
            plane_type = params.get('plane', 'FRONT')
            depth = float(params.get('depth', 10.0))
            points_2d = params.get('points', []) # Expected list of [u, v]
            
            if not points_2d or len(points_2d) < 3:
                # Fallback to rectangle if points are missing (Legacy support)
                w = float(params.get('width', 10.0))
                h = float(params.get('height', 10.0))
                points_2d = [[0, 0], [w, 0], [w, h], [0, h]]

            x_origin = float(params.get('x', 0.0))
            y_origin = float(params.get('y', 0.0))
            z_origin = float(params.get('z', 0.0))

            # Define Plane Axis
            if plane_type == 'FRONT': # XY
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
                vec = gp_Vec(0, 0, depth)
            elif plane_type == 'TOP': # XZ
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
                vec = gp_Vec(0, depth, 0)
            elif plane_type == 'RIGHT': # YZ
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
                vec = gp_Vec(depth, 0, 0)
            else:
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
                vec = gp_Vec(0, 0, depth)

            # Build Wire supporting Lines and Arcs
            make_wire = BRepBuilderAPI_MakeWire()
            
            def get_gp_pnt(p):
                u_val = float(p[0])
                v_val = float(p[1])
                if plane_type == 'FRONT':
                    return gp_Pnt(u_val, v_val, 0)
                elif plane_type == 'TOP':
                    return gp_Pnt(u_val, 0, v_val)
                elif plane_type == 'RIGHT':
                    return gp_Pnt(0, u_val, v_val)
                else:
                    return gp_Pnt(u_val, v_val, 0)

            i = 0
            n_points = len(points_2d)
            while i < n_points:
                p_start = points_2d[i]
                p_next = points_2d[(i + 1) % n_points]
                
                # Check if next point is an arc control point
                if len(p_next) > 2 and p_next[2] == 'ARC_CONTROL':
                    p_control = p_next
                    p_end = points_2d[(i + 2) % n_points]
                    
                    gp_start = get_gp_pnt(p_start)
                    gp_control = get_gp_pnt(p_control)
                    gp_end = get_gp_pnt(p_end)
                    
                    arc = GC_MakeArcOfCircle(gp_start, gp_control, gp_end)
                    if arc.IsDone():
                        edge = BRepBuilderAPI_MakeEdge(arc.Value()).Edge()
                        make_wire.Add(edge)
                    else:
                        edge = BRepBuilderAPI_MakeEdge(gp_start, gp_end).Edge()
                        make_wire.Add(edge)
                    i += 2
                else:
                    gp_start = get_gp_pnt(p_start)
                    gp_end = get_gp_pnt(p_next)
                    
                    edge = BRepBuilderAPI_MakeEdge(gp_start, gp_end).Edge()
                    make_wire.Add(edge)
                    i += 1

            wire = make_wire.Wire()
            face = BRepBuilderAPI_MakeFace(wire).Face()

            # Apply Transformation (Place local sketch onto the datum plane)
            trsf = gp_Trsf()
            trsf.SetTransformation(gp_Ax3(ax2))
            face.Move(TopLoc_Location(trsf))
            
            # Transform the extrusion vector to global space
            vec.Transform(trsf)
            
            current_feat_shape = BRepPrimAPI_MakePrism(face, vec).Shape()

        elif f_type == 'BOX':
            w = float(params.get('width', 10.0))
            h = float(params.get('height', 10.0))
            d = float(params.get('depth', 10.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            current_feat_shape = BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), w, h, d).Shape()

        elif f_type == 'CYLINDER':
            r = float(params.get('radius', 5.0))
            h = float(params.get('height', 10.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            ax = gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1))
            current_feat_shape = BRepPrimAPI_MakeCylinder(ax, r, h).Shape()

        elif f_type == 'SPHERE':
            r = float(params.get('radius', 5.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            current_feat_shape = BRepPrimAPI_MakeSphere(gp_Pnt(x, y, z), r).Shape()

        # Perform the B-Rep boolean combination
        if current_feat_shape:
            if final_shape is None:
                final_shape = current_feat_shape
            else:
                if op == 'ADD':
                    final_shape = BRepAlgoAPI_Fuse(final_shape, current_feat_shape).Shape()
                elif op == 'CUT':
                    final_shape = BRepAlgoAPI_Cut(final_shape, current_feat_shape).Shape()

    if final_shape:
        return {"type": "mesh", "data": _shape_to_mesh(final_shape)}
    return None

def generate_box(width, height, depth):
    box = BRepPrimAPI_MakeBox(width, height, depth).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(box)}

def generate_cylinder(radius, height):
    cylinder = BRepPrimAPI_MakeCylinder(radius, height).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(cylinder)}

def generate_sphere(radius):
    sphere = BRepPrimAPI_MakeSphere(radius).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(sphere)}


