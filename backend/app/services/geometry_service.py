import math

try:
    from OCC.Core.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
    from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Ax3, gp_Trsf, gp_Vec, gp_Ax1
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_EDGE, TopAbs_VERTEX
    from OCC.Core.BRep import BRep_Tool
    from OCC.Core.TopLoc import TopLoc_Location
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
    from OCC.Core.GC import GC_MakeArcOfCircle
    from OCC.Core.TopoDS import topods
    from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet, BRepFilletAPI_MakeChamfer
    from OCC.Core.GProp import GProp_GProps

    from OCC.Core.BRepGProp import brepgprop_VolumeProperties, brepgprop_SurfaceProperties

    HAS_OCC = True
except ImportError:
    HAS_OCC = False


def _shape_to_mesh(shape, deflection=0.01):
    if not HAS_OCC: return None
    """Converts an OCCT shape to a mesh format for Three.js."""
    if shape.IsNull():
        return None
    
    # Use a finer deflection for industrial smoothness
    BRepMesh_IncrementalMesh(shape, deflection)
    vertices = []
    indices = []
    normals = []
    
    from OCC.Core.TopAbs import TopAbs_REVERSED
    from OCC.Core.TopoDS import topods
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
    from OCC.Core.BRepLProp import BRepLProp_SLProps
    
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = topods.Face(explorer.Current())
        location = face.Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            node_offset = len(vertices) // 3
            trsf = location.Transformation()
            is_reversed = (face.Orientation() == TopAbs_REVERSED)
            
            # Extract vertices and apply location transformation
            for i in range(1, triangulation.NbNodes() + 1):
                pnt = triangulation.Node(i)
                pnt.Transform(trsf)
                vertices.extend([pnt.X(), pnt.Y(), pnt.Z()])
                
            # Compute and extract high-precision normals at each node
            has_uv = triangulation.HasUVNodes()
            if has_uv:
                try:
                    adaptor = BRepAdaptor_Surface(face)
                    for i in range(1, triangulation.NbNodes() + 1):
                        uv = triangulation.UVNode(i)
                        props = BRepLProp_SLProps(adaptor, uv.X(), uv.Y(), 1, 1e-6)
                        if props.IsNormalDefined():
                            normal = props.Normal()
                            normal.Transform(trsf)
                            nx, ny, nz = normal.X(), normal.Y(), normal.Z()
                            if is_reversed:
                                nx, ny, nz = -nx, -ny, -nz
                            normals.extend([nx, ny, nz])
                        else:
                            normals.extend([0.0, 0.0, 1.0])
                except Exception as norm_err:
                    print(f"[WARNING] Normal extraction failed for face: {norm_err}")
                    for _ in range(triangulation.NbNodes()):
                        normals.extend([0.0, 0.0, 1.0])
            else:
                for _ in range(triangulation.NbNodes()):
                    normals.extend([0.0, 0.0, 1.0])
                
            # Extract triangles (indices)
            for i in range(1, triangulation.NbTriangles() + 1):
                tri = triangulation.Triangle(i)
                idx1, idx2, idx3 = tri.Get()
                # OCCT indices are 1-based
                indices.extend([idx1 - 1 + node_offset, idx2 - 1 + node_offset, idx3 - 1 + node_offset])

            # Record face metadata for selection resolution
            face_metadata.append({
                "id": str(face.HashCode(1000000)), # Transient Hash
                "area": face_area,
                "curvature": curvature,
                "v_count": v_count,
                "index_range": [node_offset, len(vertices) // 3]
            })
                
        explorer.Next()
        
    return {
        "vertices": vertices,
        "indices": indices,
        "normals": normals,
        "face_metadata": face_metadata
    }

def find_matching_edge(shape, target_start, target_end, signature=None):
    if not shape or shape.IsNull():
        return None
        
    try:
        t_start = [float(target_start[0]), float(target_start[1]), float(target_start[2])]
        t_end = [float(target_end[0]), float(target_end[1]), float(target_end[2])]
    except Exception:
        return None
        
    best_edge = None
    min_dist = float('inf')
    
    explorer = TopExp_Explorer(shape, TopAbs_EDGE)
    while explorer.More():
        edge = topods.Edge(explorer.Current())
        v_exp = TopExp_Explorer(edge, TopAbs_VERTEX)
        pnts = []
        while v_exp.More():
            v = topods.Vertex(v_exp.Current())
            pt = BRep_Tool.Pnt(v)
            pnts.extend([[pt.X(), pt.Y(), pt.Z()]])
            v_exp.Next()
            
        if len(pnts) >= 2:
            unique_pnts = []
            for p in pnts:
                if not any(math.dist(p, up) < 1e-4 for up in unique_pnts):
                    unique_pnts.append(p)
                    
            if len(unique_pnts) >= 2:
                d1 = math.dist(unique_pnts[0], t_start) + math.dist(unique_pnts[1], t_end)
                d2 = math.dist(unique_pnts[0], t_end) + math.dist(unique_pnts[1], t_start)
                d = min(d1, d2)
                if d < min_dist:
                    min_dist = d
                    best_edge = edge
                    
        explorer.Next()
        
        # TNS Edge Signature Matching
    if signature and 'length' in signature:
        target_len = float(signature['length'])
        # Re-evaluate candidates based on length similarity
        # (This is a simplified version, in a full TNS we'd store all candidate scores)
        pass

    if min_dist < 5.0:
        return best_edge
    return None


def _build_wire_from_points(points):
    make_wire = BRepBuilderAPI_MakeWire()
    
    def get_gp_pnt(p):
        u_val = float(p[0])
        v_val = float(p[1])
        return gp_Pnt(u_val, v_val, 0.0)

    i = 0
    n_points = len(points)
    while i < n_points:
        p_start = points[i]
        p_next = points[(i + 1) % n_points]

        if len(p_next) > 2 and p_next[2] == 'ARC_CONTROL':
            p_control = p_next
            p_end = points[(i + 2) % n_points]

            arc = GC_MakeArcOfCircle(get_gp_pnt(p_start), get_gp_pnt(p_control), get_gp_pnt(p_end))
            if arc.IsDone():
                edge = BRepBuilderAPI_MakeEdge(arc.Value()).Edge()
                make_wire.Add(edge)
            else:
                edge = BRepBuilderAPI_MakeEdge(get_gp_pnt(p_start), get_gp_pnt(p_end)).Edge()
                make_wire.Add(edge)
            i += 2
        else:
            edge = BRepBuilderAPI_MakeEdge(get_gp_pnt(p_start), get_gp_pnt(p_next)).Edge()
            make_wire.Add(edge)
            i += 1
    return make_wire.Wire()

def import_step_file(filepath):
    """
    Imports a STEP file and returns its B-Rep shape.
    """
    if not HAS_OCC:
        return None
    try:
        from OCC.Core.STEPControl import STEPControl_Reader
        reader = STEPControl_Reader()
        status = reader.ReadFile(filepath)
        
        from OCC.Core.IFSelect import IFSelect_RetDone
        if status == IFSelect_RetDone:
            reader.TransferRoots()
            shape = reader.OneShape()
            return shape
        return None
    except Exception as e:
        print(f"[ERROR] Failed to import STEP file: {e}")
        return None

def detect_interference(component_shapes):
    """
    Detects geometric collisions between a list of component shapes.
    Returns: List of interference meshes (the intersecting volumes).
    """
    if not HAS_OCC:
        return []
    
    interferences = []
    try:
        from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common
        from OCC.Core.BRepCheck import BRepCheck_Analyzer
        
        c_ids = list(component_shapes.keys())
        for i in range(len(c_ids)):
            for j in range(i + 1, len(c_ids)):
                s1 = component_shapes[c_ids[i]]
                s2 = component_shapes[c_ids[j]]
                
                if s1.IsNull() or s2.IsNull():
                    continue
                
                # Calculate the intersection (Common) volume
                common_tool = BRepAlgoAPI_Common(s1, s2)
                common_tool.Build()
                
                if common_tool.IsDone():
                    inter_shape = common_tool.Shape()
                    
                    # Verify if it's a real solid intersection
                    from OCC.Core.GProp import GProp_GProps
                    from OCC.Core.BRepGProp import brepgprop
                    props = GProp_GProps()
                    brepgprop.VolumeProperties(inter_shape, props)
                    
                    if props.Mass() > 1e-3: # Volume threshold
                        mesh = _shape_to_mesh(inter_shape)
                        interferences.append({
                            "components": [c_ids[i], c_ids[j]],
                            "volume": props.Mass(),
                            "mesh": mesh
                        })
    except Exception as e:
        print(f"[ERROR] Interference detection failed: {e}")
        
    return interferences

def build_feature_shape_in_isolation(f_type, params, parent_shape=None, all_features=[]):
    if not HAS_OCC:
        return None

    current_feat_shape = None

    if f_type == 'DUMB_SOLID':
        filepath = params.get('filepath')
        if filepath and os.path.exists(filepath):
            # We cache the imported shape in a way or just re-read for now
            imported_shape = import_step_file(filepath)
            if imported_shape:
                # Apply optional transformation
                x, y, z = float(params.get('x', 0)), float(params.get('y', 0)), float(params.get('z', 0))
                if x != 0 or y != 0 or z != 0:
                    trsf = gp_Trsf()
                    trsf.SetTranslation(gp_Vec(x, y, z))
                    imported_shape.Move(TopLoc_Location(trsf))
                return imported_shape
        return None

    if f_type == 'SKETCH_POLYLINE' or f_type == 'EXTRUDE':
        plane_type = params.get('plane', 'FRONT')
        depth = float(params.get('depth', 10.0))
        points_2d = params.get('points', [])

        # Check if nested list of loops (multi-loop)
        is_nested = False
        if points_2d and isinstance(points_2d[0], list) and len(points_2d[0]) > 0 and isinstance(points_2d[0][0], list):
            is_nested = True

        loops = points_2d if is_nested else [points_2d]
        cleaned_loops = []

        for loop in loops:
            filtered_points = []
            for pt in loop:
                if not pt:
                    continue
                if not filtered_points:
                    filtered_points.append(pt)
                else:
                    prev = filtered_points[-1]
                    dist = math.hypot(float(pt[0]) - float(prev[0]), float(pt[1]) - float(prev[1]))
                    if dist > 1e-4:
                        filtered_points.append(pt)

            if len(filtered_points) > 1:
                first = filtered_points[0]
                last = filtered_points[-1]
                dist = math.hypot(float(first[0]) - float(last[0]), float(first[1]) - float(last[1]))
                if dist < 1e-4:
                    filtered_points.pop()

            if len(filtered_points) >= 3:
                cleaned_loops.append(filtered_points)

        if not cleaned_loops:
            return None

        x_origin = float(params.get('x', 0.0))
        y_origin = float(params.get('y', 0.0))
        z_origin = float(params.get('z', 0.0))

        if plane_type == 'FRONT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
        elif plane_type == 'TOP':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
        elif plane_type == 'RIGHT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
        elif plane_type == 'FACE':
            face_origin = params.get('faceOrigin', [0.0, 0.0, 0.0])
            face_normal = params.get('faceNormal', [0.0, 0.0, 1.0])

            # Resolve face topology naming on rebuilt parent shape
            if parent_shape is not None and not parent_shape.IsNull():
                matched_origin, matched_normal, _ = find_matching_face(parent_shape, face_origin, face_normal)
                face_origin = matched_origin
                face_normal = matched_normal

            ox, oy, oz = float(face_origin[0]), float(face_origin[1]), float(face_origin[2])
            nx, ny, nz = float(face_normal[0]), float(face_normal[1]), float(face_normal[2])
            
            n_len = math.sqrt(nx*nx + ny*ny + nz*nz)
            if n_len > 1e-6: nx, ny, nz = nx/n_len, ny/n_len, nz/n_len
            else: nx, ny, nz = 0.0, 0.0, 1.0

            if abs(nx) < 1e-5 and abs(ny) < 1e-5: xx, xy, xz = 1.0, 0.0, 0.0
            else:
                xx, xy, xz = -ny, nx, 0.0
                x_len = math.sqrt(xx*xx + xy*xy)
                xx, xy = xx/x_len, xy/x_len

            ax2 = gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz))
        
        # Custom Reference Plane Resolution (TNS Stage 2+)
        elif any((f.get('id') if isinstance(f, dict) else getattr(f, 'id', None)) == plane_type for f in all_features):
            target_plane = next((f for f in all_features if (f.get('id') if isinstance(f, dict) else getattr(f, 'id', None)) == plane_type), None)
            p_params = target_plane.get('parameters', {}) if isinstance(target_plane, dict) else getattr(target_plane, 'parameters', {})
            p_res = generate_reference_plane(p_params.get('planeType', 'OFFSET'), p_params.get('refs', []), p_params.get('offset', 0.0), all_features)
            ax2 = gp_Ax2(gp_Pnt(*p_res['origin']), gp_Dir(*p_res['normal']), gp_Dir(*p_res['xDir']))
        
        else:
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))

        # Extrude along plane normal in global coordinates
        normal_dir = ax2.Direction()
        vec = gp_Vec(normal_dir.X() * depth, normal_dir.Y() * depth, normal_dir.Z() * depth)

        try:
            wires = []
            for loop in cleaned_loops:
                wire = _build_wire_from_points(loop)
                wires.append(wire)

            # Build face with holes (outermost is wires[0], rest are cutouts)
            make_face = BRepBuilderAPI_MakeFace(wires[0])
            for inner_wire in wires[1:]:
                make_face.Add(inner_wire)
            face = make_face.Face()

            # Move face to local plane
            trsf = gp_Trsf()
            trsf.SetTransformation(gp_Ax3(ax2), gp_Ax3())
            face.Move(TopLoc_Location(trsf))

            current_feat_shape = BRepPrimAPI_MakePrism(face, vec).Shape()
        except Exception as sketch_err:
            print(f"[ERROR] Failed to construct sketch/prism wire inside build_feature_shape_in_isolation: {sketch_err}")
            current_feat_shape = None

    elif f_type == 'REVOLVE':
        plane_type = params.get('plane', 'FRONT')
        angle = float(params.get('angle', 360.0)) * math.pi / 180.0
        points_2d = params.get('points', [])

        is_nested = False
        if points_2d and isinstance(points_2d[0], list) and len(points_2d[0]) > 0 and isinstance(points_2d[0][0], list):
            is_nested = True

        loops = points_2d if is_nested else [points_2d]
        cleaned_loops = []

        for loop in loops:
            filtered_points = []
            for pt in loop:
                if not pt:
                    continue
                if not filtered_points:
                    filtered_points.append(pt)
                else:
                    prev = filtered_points[-1]
                    dist = math.hypot(float(pt[0]) - float(prev[0]), float(pt[1]) - float(prev[1]))
                    if dist > 1e-4:
                        filtered_points.append(pt)

            if len(filtered_points) > 1:
                first = filtered_points[0]
                last = filtered_points[-1]
                dist = math.hypot(float(first[0]) - float(last[0]), float(first[1]) - float(last[1]))
                if dist < 1e-4:
                    filtered_points.pop()

            if len(filtered_points) >= 3:
                cleaned_loops.append(filtered_points)

        if not cleaned_loops:
            return None

        x_origin = float(params.get('x', 0.0))
        y_origin = float(params.get('y', 0.0))
        z_origin = float(params.get('z', 0.0))

        if plane_type == 'FRONT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
        elif plane_type == 'TOP':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
        elif plane_type == 'RIGHT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
        elif plane_type == 'FACE':
            face_origin = params.get('faceOrigin', [0.0, 0.0, 0.0])
            face_normal = params.get('faceNormal', [0.0, 0.0, 1.0])

            # Resolve face topology naming on rebuilt parent shape
            if parent_shape is not None and not parent_shape.IsNull():
                matched_origin, matched_normal, _ = find_matching_face(parent_shape, face_origin, face_normal)
                face_origin = matched_origin
                face_normal = matched_normal

            ox, oy, oz = float(face_origin[0]), float(face_origin[1]), float(face_origin[2])
            nx, ny, nz = float(face_normal[0]), float(face_normal[1]), float(face_normal[2])
            
            n_len = math.sqrt(nx*nx + ny*ny + nz*nz)
            if n_len > 1e-6: nx, ny, nz = nx/n_len, ny/n_len, nz/n_len
            else: nx, ny, nz = 0.0, 0.0, 1.0

            if abs(nx) < 1e-5 and abs(ny) < 1e-5: xx, xy, xz = 1.0, 0.0, 0.0
            else:
                xx, xy, xz = -ny, nx, 0.0
                x_len = math.sqrt(xx*xx + xy*xy)
                xx, xy = xx/x_len, xy/x_len

            ax2 = gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz))
        
        # Custom Reference Plane Resolution (TNS Stage 2+)
        elif any((f.get('id') if isinstance(f, dict) else getattr(f, 'id', None)) == plane_type for f in all_features):
            target_plane = next((f for f in all_features if (f.get('id') if isinstance(f, dict) else getattr(f, 'id', None)) == plane_type), None)
            p_params = target_plane.get('parameters', {}) if isinstance(target_plane, dict) else getattr(target_plane, 'parameters', {})
            p_res = generate_reference_plane(p_params.get('planeType', 'OFFSET'), p_params.get('refs', []), p_params.get('offset', 0.0), all_features)
            ax2 = gp_Ax2(gp_Pnt(*p_res['origin']), gp_Dir(*p_res['normal']), gp_Dir(*p_res['xDir']))
        
        else:
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))

        try:
            wires = []
            for loop in cleaned_loops:
                wire = _build_wire_from_points(loop)
                wires.append(wire)

            # Build face with holes
            make_face = BRepBuilderAPI_MakeFace(wires[0])
            for inner_wire in wires[1:]:
                make_face.Add(inner_wire)
            face = make_face.Face()

            # Revolve around local Y-axis in local space
            local_axis = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))
            revol_shape = BRepPrimAPI_MakeRevol(face, local_axis, angle).Shape()

            # Move and rotate the revolved solid to ax2 plane
            trsf = gp_Trsf()
            trsf.SetTransformation(gp_Ax3(ax2), gp_Ax3())
            revol_shape.Move(TopLoc_Location(trsf))

            current_feat_shape = revol_shape
        except Exception as e:
            print(f"[ERROR] Revolve failed inside build_feature_shape_in_isolation: {e}")
            current_feat_shape = None

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

    elif f_type == 'SWEEP':
        profile_points = params.get('profile_points', [])
        path_points = params.get('path_points', [])
        
        if not profile_points or not path_points:
            return None
            
        try:
            from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakePipe
            
            # Construct profile wire
            profile_wire = _build_wire_from_points(profile_points)
            
            # Construct path wire (typically not closed)
            # We need a non-closed version of _build_wire_from_points or handle it here
            make_path = BRepBuilderAPI_MakeWire()
            for i in range(len(path_points) - 1):
                p1 = gp_Pnt(float(path_points[i][0]), float(path_points[i][1]), float(path_points[i][2]) if len(path_points[i])>2 else 0.0)
                p2 = gp_Pnt(float(path_points[i+1][0]), float(path_points[i+1][1]), float(path_points[i+1][2]) if len(path_points[i+1])>2 else 0.0)
                edge = BRepBuilderAPI_MakeEdge(p1, p2).Edge()
                make_path.Add(edge)
            path_wire = make_path.Wire()
            
            sweep_tool = BRepOffsetAPI_MakePipe(path_wire, profile_wire)
            sweep_tool.Build()
            if sweep_tool.IsDone():
                return sweep_tool.Shape()
        except Exception as sweep_err:
            print(f"[ERROR] SWEEP feature failed: {sweep_err}")
            return None
    elif f_type == 'HOLE_WIZARD':
        hole_type = params.get('hole_type', 'SIMPLE') # SIMPLE, COUNTERBORE, COUNTERSINK
        diameter = float(params.get('diameter', 6.0))
        depth = float(params.get('depth', 10.0))
        
        # Position & Orientation
        x, y, z = float(params.get('x', 0)), float(params.get('y', 0)), float(params.get('z', 0))
        # Orientation defaults to Z-axis but can be mapped to face normal
        nx, ny, nz = float(params.get('nx', 0)), float(params.get('ny', 0)), float(params.get('nz', 1))
        
        from OCC.Core.gp import gp_Ax1, gp_Dir, gp_Pnt
        axis = gp_Ax1(gp_Pnt(x, y, z), gp_Dir(nx, ny, nz))
        
        try:
            from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone
            from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
            
            # 1. Base Drilled Hole
            main_hole = BRepPrimAPI_MakeCylinder(axis, diameter/2.0, depth).Shape()
            final_hole_shape = main_hole
            
            if hole_type == 'COUNTERBORE':
                cb_diameter = float(params.get('cb_diameter', diameter * 1.5))
                cb_depth = float(params.get('cb_depth', diameter * 0.5))
                cb_hole = BRepPrimAPI_MakeCylinder(axis, cb_diameter/2.0, cb_depth).Shape()
                final_hole_shape = BRepAlgoAPI_Fuse(main_hole, cb_hole).Shape()
                
            elif hole_type == 'COUNTERSINK':
                cs_diameter = float(params.get('cs_diameter', diameter * 1.5))
                cs_angle = float(params.get('cs_angle', 90.0)) * math.pi / 180.0
                # Cone height to reach diameter
                cs_height = (cs_diameter/2.0 - diameter/2.0) / math.tan(cs_angle/2.0)
                cs_hole = BRepPrimAPI_MakeCone(axis, cs_diameter/2.0, diameter/2.0, cs_height).Shape()
                final_hole_shape = BRepAlgoAPI_Fuse(main_hole, cs_hole).Shape()
            
            return final_hole_shape
        except Exception as hole_err:
            print(f"[ERROR] HOLE_WIZARD feature failed: {hole_err}")
            return None
    elif f_type == 'LOFT':
        profiles_data = params.get('profiles', []) # List of point arrays
        if len(profiles_data) < 2:
            return None
            
        try:
            from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_ThruSections
            
            loft_tool = BRepOffsetAPI_ThruSections(True) # isSolid=True
            
            for profile_pts in profiles_data:
                if not profile_pts: continue
                # We need to handle 3D points for profiles if they are on different planes
                # For this implementation, we expect profiles to be passed as global 3D wires or 2D + plane info
                wire = _build_wire_from_points(profile_pts)
                loft_tool.AddWire(wire)
            
            loft_tool.Build()
            if loft_tool.IsDone():
                return loft_tool.Shape()
        except Exception as loft_err:
            print(f"[ERROR] LOFT feature failed: {loft_err}")
            return None
    return current_feat_shape

def process_features(features, deflection=0.01):
    """
    The Core CAD Kernel: Processes a sequence of parametric features to build a B-Rep model.
    Implements the 'Sketch -> Extrude' workflow with Datum Plane support.
    Supports BOX, CYLINDER, SPHERE, and EXTRUDE features.
    """
    if not HAS_OCC:
        return {"type": "mesh", "data": generate_mock_mesh(features)}

    final_shape = None
    ref_geometry = [] # [{id, type, origin, normal/direction, xDir, yDir}]

    for feat in features:
        if hasattr(feat, 'type'):
            f_id = feat.id
            f_type = feat.type
            params = feat.parameters
        else:
            f_id = feat.get('id')
            f_type = feat.get('type')
            params = feat.get('parameters', {})

        if f_type == 'REFERENCE_PLANE':
            res = generate_reference_plane(params.get('planeType', 'OFFSET'), params.get('refs', []), params.get('offset', 0.0), features)
            ref_geometry.append({"id": f_id, "type": "PLANE", "data": res})
            continue
        
        elif f_type == 'REFERENCE_AXIS':
            res = generate_reference_axis(params.get('axisType', 'TWO_POINTS'), params.get('refs', []), features)
            ref_geometry.append({"id": f_id, "type": "AXIS", "data": res})
            continue
    
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
        
        if f_type == 'FILLET':
            if final_shape is not None:
                radius = float(params.get('radius', 2.0))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end, params.get("signature"))
                    if matched_edge:
                        try:
                            fillet_tool = BRepFilletAPI_MakeFillet(final_shape)
                            fillet_tool.Add(radius, matched_edge)
                            fillet_tool.Build()
                            if fillet_tool.IsDone():
                                final_shape = fillet_tool.Shape()
                        except Exception as fillet_err:
                            print(f"[ERROR] Fillet failed: {fillet_err}")
            continue

        elif f_type == 'SHELL':
            if final_shape is not None:
                thickness = float(params.get('thickness', 2.0))
                faces_to_remove_params = params.get('faces_to_remove', [])
                
                from OCC.Core.TopTools import TopTools_ListOfShape
                from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
                
                removed_faces = TopTools_ListOfShape()
                for f_ref in faces_to_remove_params:
                    f_origin = f_ref.get('coordinates', [0,0,0])
                    f_normal = f_ref.get('normal', [0,0,1])
                    f_sig = f_ref.get('signature', {})
                    
                    # Resolve face using TNS Stage 2
                    _, _, matched_face = find_matching_face(final_shape, f_origin, f_normal, f_sig)
                    if matched_face:
                        removed_faces.Append(matched_face)
                
                try:
                    # Create the hollow solid
                    # Tolerance (1e-3), JoinType (GeomAbs_Arc), Inside(False)
                    from OCC.Core.GeomAbs import GeomAbs_Arc
                    shell_tool = BRepOffsetAPI_MakeThickSolid(final_shape, removed_faces, -thickness, 1e-3, GeomAbs_Arc, False)
                    shell_tool.Build()
                    if shell_tool.IsDone():
                        final_shape = shell_tool.Shape()
                except Exception as shell_err:
                    print(f"[ERROR] SHELL feature failed: {shell_err}")
            continue

        elif f_type == 'CHAMFER':
            if final_shape is not None:
                distance = float(params.get('distance', 1.5))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end, params.get("signature"))
                    if matched_edge:
                        try:
                            chamfer_tool = BRepFilletAPI_MakeChamfer(final_shape)
                            chamfer_tool.Add(distance, matched_edge)
                            chamfer_tool.Build()
                            if chamfer_tool.IsDone():
                                final_shape = chamfer_tool.Shape()
                        except Exception as chamfer_err:
                            print(f"[ERROR] Chamfer failed: {chamfer_err}")
            continue

        if f_type in ['SKETCH_POLYLINE', 'EXTRUDE', 'REVOLVE', 'BOX', 'CYLINDER', 'SPHERE']:
            current_feat_shape = build_feature_shape_in_isolation(f_type, params, final_shape, features)

        elif f_type == 'PATTERN':
            target_id = params.get('target_feature_id')
            pattern_type = params.get('pattern_type', 'LINEAR')
            axis = params.get('axis', 'X')
            count = int(params.get('count', 2))
            spacing = float(params.get('spacing', 10.0))

            target_feat = None
            for prev_feat in features:
                prev_id = prev_feat.id if hasattr(prev_feat, 'id') else prev_feat.get('id')
                if prev_id == target_id:
                    target_feat = prev_feat
                    break

            if target_feat:
                tf_type = target_feat.type if hasattr(target_feat, 'type') else target_feat.get('type')
                tf_params = target_feat.parameters if hasattr(target_feat, 'parameters') else target_feat.get('parameters', {})
                target_shape = build_feature_shape_in_isolation(tf_type, tf_params, None, features)

                if target_shape:
                    copies = []
                    for i in range(1, count):
                        trsf = gp_Trsf()
                        if pattern_type == 'LINEAR':
                            val = spacing * i
                            if axis == 'X':
                                vec = gp_Vec(val, 0, 0)
                            elif axis == 'Y':
                                vec = gp_Vec(0, val, 0)
                            else:
                                vec = gp_Vec(0, 0, val)
                            trsf.SetTranslation(vec)
                        else:  # CIRCULAR
                            angle_rad = math.radians(spacing * i)
                            if axis == 'X':
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0))
                            elif axis == 'Y':
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))
                            else:
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
                            trsf.SetRotation(ax1, angle_rad)

                        shape_copy = target_shape.Moved(TopLoc_Location(trsf))
                        copies.append(shape_copy)

                    target_op = tf_params.get('operation', 'ADD')
                    for copy_shape in copies:
                        if final_shape is None:
                            final_shape = copy_shape
                        else:
                            if target_op == 'ADD':
                                final_shape = BRepAlgoAPI_Fuse(final_shape, copy_shape).Shape()
                            elif target_op == 'CUT':
                                final_shape = BRepAlgoAPI_Cut(final_shape, copy_shape).Shape()

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
        return {"type": "mesh", "data": _shape_to_mesh(final_shape, deflection), "ref_geometry": ref_geometry}
    return None

def build_shape_only(features):
    """Processes features and returns the raw OCCT TopoDS_Shape."""
    final_shape = None
    ref_geometry = [] # [{id, type, origin, normal/direction, xDir, yDir}]

    for feat in features:
        if hasattr(feat, 'type'):
            f_id = feat.id
            f_type = feat.type
            params = feat.parameters
        else:
            f_id = feat.get('id')
            f_type = feat.get('type')
            params = feat.get('parameters', {})

        if f_type == 'REFERENCE_PLANE':
            res = generate_reference_plane(params.get('planeType', 'OFFSET'), params.get('refs', []), params.get('offset', 0.0), features)
            ref_geometry.append({"id": f_id, "type": "PLANE", "data": res})
            continue
        
        elif f_type == 'REFERENCE_AXIS':
            res = generate_reference_axis(params.get('axisType', 'TWO_POINTS'), params.get('refs', []), features)
            ref_geometry.append({"id": f_id, "type": "AXIS", "data": res})
            continue
    
    for feat in features:
        if hasattr(feat, 'type'):
            f_type = feat.type
            params = feat.parameters
        else:
            f_type = feat.get('type')
            params = feat.get('parameters', {})
            
        if f_type == 'FILLET':
            if final_shape is not None:
                radius = float(params.get('radius', 2.0))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end, params.get("signature"))
                    if matched_edge:
                        try:
                            fillet_tool = BRepFilletAPI_MakeFillet(final_shape)
                            fillet_tool.Add(radius, matched_edge)
                            fillet_tool.Build()
                            if fillet_tool.IsDone():
                                final_shape = fillet_tool.Shape()
                        except Exception as fillet_err:
                            print(f"[ERROR] Fillet failed: {fillet_err}")
            continue

        elif f_type == 'SHELL':
            if final_shape is not None:
                thickness = float(params.get('thickness', 2.0))
                faces_to_remove_params = params.get('faces_to_remove', [])
                
                from OCC.Core.TopTools import TopTools_ListOfShape
                from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
                
                removed_faces = TopTools_ListOfShape()
                for f_ref in faces_to_remove_params:
                    f_origin = f_ref.get('coordinates', [0,0,0])
                    f_normal = f_ref.get('normal', [0,0,1])
                    f_sig = f_ref.get('signature', {})
                    
                    # Resolve face using TNS Stage 2
                    _, _, matched_face = find_matching_face(final_shape, f_origin, f_normal, f_sig)
                    if matched_face:
                        removed_faces.Append(matched_face)
                
                try:
                    # Create the hollow solid
                    # Tolerance (1e-3), JoinType (GeomAbs_Arc), Inside(False)
                    from OCC.Core.GeomAbs import GeomAbs_Arc
                    shell_tool = BRepOffsetAPI_MakeThickSolid(final_shape, removed_faces, -thickness, 1e-3, GeomAbs_Arc, False)
                    shell_tool.Build()
                    if shell_tool.IsDone():
                        final_shape = shell_tool.Shape()
                except Exception as shell_err:
                    print(f"[ERROR] SHELL feature failed: {shell_err}")
            continue

        elif f_type == 'CHAMFER':
            if final_shape is not None:
                distance = float(params.get('distance', 1.5))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end, params.get("signature"))
                    if matched_edge:
                        try:
                            chamfer_tool = BRepFilletAPI_MakeChamfer(final_shape)
                            chamfer_tool.Add(distance, matched_edge)
                            chamfer_tool.Build()
                            if chamfer_tool.IsDone():
                                final_shape = chamfer_tool.Shape()
                        except Exception as chamfer_err:
                            print(f"[ERROR] Chamfer failed: {chamfer_err}")
            continue

        if f_type in ['SKETCH_POLYLINE', 'EXTRUDE', 'REVOLVE', 'BOX', 'CYLINDER', 'SPHERE']:
            current_feat_shape = build_feature_shape_in_isolation(f_type, params, final_shape, features)

        elif f_type == 'PATTERN':
            target_id = params.get('target_feature_id')
            pattern_type = params.get('pattern_type', 'LINEAR')
            axis = params.get('axis', 'X')
            count = int(params.get('count', 2))
            spacing = float(params.get('spacing', 10.0))

            target_feat = None
            for prev_feat in features:
                prev_id = prev_feat.id if hasattr(prev_feat, 'id') else prev_feat.get('id')
                if prev_id == target_id:
                    target_feat = prev_feat
                    break

            if target_feat:
                tf_type = target_feat.type if hasattr(target_feat, 'type') else target_feat.get('type')
                tf_params = target_feat.parameters if hasattr(target_feat, 'parameters') else target_feat.get('parameters', {})
                target_shape = build_feature_shape_in_isolation(tf_type, tf_params, None, features)

                if target_shape:
                    copies = []
                    for i in range(1, count):
                        trsf = gp_Trsf()
                        if pattern_type == 'LINEAR':
                            val = spacing * i
                            if axis == 'X':
                                vec = gp_Vec(val, 0, 0)
                            elif axis == 'Y':
                                vec = gp_Vec(0, val, 0)
                            else:
                                vec = gp_Vec(0, 0, val)
                            trsf.SetTranslation(vec)
                        else:  # CIRCULAR
                            angle_rad = math.radians(spacing * i)
                            if axis == 'X':
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0))
                            elif axis == 'Y':
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))
                            else:
                                ax1 = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
                            trsf.SetRotation(ax1, angle_rad)

                        shape_copy = target_shape.Moved(TopLoc_Location(trsf))
                        copies.append(shape_copy)

                    target_op = tf_params.get('operation', 'ADD')
                    for copy_shape in copies:
                        if final_shape is None:
                            final_shape = copy_shape
                        else:
                            if target_op == 'ADD':
                                final_shape = BRepAlgoAPI_Fuse(final_shape, copy_shape).Shape()
                            elif target_op == 'CUT':
                                final_shape = BRepAlgoAPI_Cut(final_shape, copy_shape).Shape()

        # Perform the B-Rep boolean combination
        if current_feat_shape:
            if final_shape is None:
                final_shape = current_feat_shape
            else:
                if op == 'ADD':
                    final_shape = BRepAlgoAPI_Fuse(final_shape, current_feat_shape).Shape()
                elif op == 'CUT':
                    final_shape = BRepAlgoAPI_Cut(final_shape, current_feat_shape).Shape()

    return final_shape

def generate_box(width, height, depth):
    if not HAS_OCC:
        return {"type": "mesh", "data": make_mock_box_mesh(width, height, depth)}
    box = BRepPrimAPI_MakeBox(width, height, depth).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(box)}

def generate_cylinder(radius, height):
    if not HAS_OCC:
        return {"type": "mesh", "data": make_mock_cylinder_mesh(radius, height)}
    cylinder = BRepPrimAPI_MakeCylinder(radius, height).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(cylinder)}

def generate_sphere(radius):
    if not HAS_OCC:
        return {"type": "mesh", "data": make_mock_sphere_mesh(radius)}
    sphere = BRepPrimAPI_MakeSphere(radius).Shape()
    return {"type": "mesh", "data": _shape_to_mesh(sphere)}


# ==========================================
# Pure-Python High-Fidelity Parametric Mesh Engine
# ==========================================

def make_mock_box_mesh(w, h, d, x=0, y=0, z=0):
    vertices = [
        x, y, z,          # 0
        x+w, y, z,        # 1
        x+w, y+h, z,      # 2
        x, y+h, z,        # 3
        x, y, z+d,        # 4
        x+w, y, z+d,      # 5
        x+w, y+h, z+d,    # 6
        x, y+h, z+d       # 7
    ]
    indices = [
        # Front
        0, 2, 1,  0, 3, 2,
        # Back
        4, 5, 6,  4, 6, 7,
        # Left
        0, 7, 3,  0, 4, 7,
        # Right
        1, 2, 6,  1, 6, 5,
        # Top
        3, 6, 2,  3, 7, 6,
        # Bottom
        0, 1, 5,  0, 5, 4
    ]
    return {"vertices": vertices, "indices": indices, "normals": []}

def make_mock_cylinder_mesh(r, h, x=0, y=0, z=0):
    segments = 32
    vertices = []
    indices = []
    
    # Bottom cap (z)
    for i in range(segments):
        theta = (i / segments) * 2.0 * math.pi
        vertices.extend([x + r * math.cos(theta), y + r * math.sin(theta), z])
    # Top cap (z+h)
    for i in range(segments):
        theta = (i / segments) * 2.0 * math.pi
        vertices.extend([x + r * math.cos(theta), y + r * math.sin(theta), z + h])
        
    v_bot_center = 2 * segments
    v_top_center = 2 * segments + 1
    vertices.extend([x, y, z])
    vertices.extend([x, y, z + h])
    
    for i in range(segments):
        curr = i
        nxt = (i + 1) % segments
        indices.extend([v_bot_center, nxt, curr])
        
    for i in range(segments):
        curr = segments + i
        nxt = segments + (i + 1) % segments
        indices.extend([v_top_center, curr, nxt])
        
    for i in range(segments):
        b_curr = i
        b_nxt = (i + 1) % segments
        t_curr = segments + i
        t_nxt = segments + (i + 1) % segments
        indices.extend([b_curr, t_curr, b_nxt])
        indices.extend([b_nxt, t_curr, t_nxt])
        
    return {"vertices": vertices, "indices": indices, "normals": []}

def make_mock_sphere_mesh(r, x=0, y=0, z=0):
    rings = 16
    segments = 32
    vertices = []
    indices = []
    
    for ring in range(rings + 1):
        phi = (ring / rings) * math.pi
        sin_phi = math.sin(phi)
        cos_phi = math.cos(phi)
        for seg in range(segments + 1):
            theta = (seg / segments) * 2.0 * math.pi
            vx = x + r * sin_phi * math.cos(theta)
            vy = y + r * sin_phi * math.sin(theta)
            vz = z + r * cos_phi
            vertices.extend([vx, vy, vz])
            
    for ring in range(rings):
        for seg in range(segments):
            v00 = ring * (segments + 1) + seg
            v01 = ring * (segments + 1) + seg + 1
            v10 = (ring + 1) * (segments + 1) + seg
            v11 = (ring + 1) * (segments + 1) + seg + 1
            indices.extend([v00, v10, v01])
            indices.extend([v01, v10, v11])
            
    return {"vertices": vertices, "indices": indices, "normals": []}

def make_mock_revolve_mesh(points_2d, angle_deg=360.0):
    angle_rad = angle_deg * math.pi / 180.0
    steps = 32
    vertices = []
    indices = []
    
    M = len(points_2d)
    for s in range(steps + 1):
        theta = s * angle_rad / steps
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        for p in range(M):
            u = float(points_2d[p][0])
            v = float(points_2d[p][1])
            x = u * cos_t
            y = v
            z = u * sin_t
            vertices.extend([x, y, z])
            
    for s in range(steps):
        for p in range(M - 1):
            v00 = s * M + p
            v01 = s * M + p + 1
            v10 = (s + 1) * M + p
            v11 = (s + 1) * M + p + 1
            indices.extend([v00, v10, v01])
            indices.extend([v01, v10, v11])
            
    return {"vertices": vertices, "indices": indices, "normals": []}

def make_mock_aviv_mesh(W=100.0, D=80.0, H=20.0, R=33.4, F=5.0):
    cx = W/2.0 - F
    cz = D/2.0 - F
    
    outer_points = []
    # Corner 1: top-right (+X, +Z)
    for i in range(8):
        theta = (i / 7.0) * (math.pi / 2.0)
        outer_points.append([cx + F * math.cos(theta), cz + F * math.sin(theta)])
    # Corner 2: top-left (-X, +Z)
    for i in range(8):
        theta = math.pi / 2.0 + (i / 7.0) * (math.pi / 2.0)
        outer_points.append([-cx + F * math.cos(theta), cz + F * math.sin(theta)])
    # Corner 3: bottom-left (-X, -Z)
    for i in range(8):
        theta = math.pi + (i / 7.0) * (math.pi / 2.0)
        outer_points.append([-cx + F * math.cos(theta), -cz + F * math.sin(theta)])
    # Corner 4: bottom-right (+X, -Z)
    for i in range(8):
        theta = 1.5 * math.pi + (i / 7.0) * (math.pi / 2.0)
        outer_points.append([cx + F * math.cos(theta), -cz + F * math.sin(theta)])
        
    inner_points = []
    for i in range(32):
        theta = (i / 32.0) * 2.0 * math.pi
        inner_points.append([R * math.cos(theta), R * math.sin(theta)])
        
    vertices = []
    indices = []
    
    # 0 to 31: bottom outer (Y=0)
    # 32 to 63: bottom inner (Y=0)
    # 64 to 95: top outer (Y=H)
    # 96 to 127: top inner (Y=H)
    for p in outer_points:
        vertices.extend([p[0], 0.0, p[1]])
    for p in inner_points:
        vertices.extend([p[0], 0.0, p[1]])
    for p in outer_points:
        vertices.extend([p[0], H, p[1]])
    for p in inner_points:
        vertices.extend([p[0], H, p[1]])
        
    # Top face
    for i in range(32):
        o_curr = 64 + i
        o_next = 64 + (i + 1) % 32
        aria = 96 + i
        a_next = 96 + (i + 1) % 32
        indices.extend([o_curr, o_next, aria])
        indices.extend([aria, o_next, a_next])
        
    # Bottom face
    for i in range(32):
        o_curr = i
        o_next = (i + 1) % 32
        aria = 32 + i
        a_next = 32 + (i + 1) % 32
        indices.extend([o_curr, aria, o_next])
        indices.extend([aria, a_next, o_next])
        
    # Outer side walls
    for i in range(32):
        b_curr = i
        b_next = (i + 1) % 32
        t_curr = 64 + i
        t_next = 64 + (i + 1) % 32
        indices.extend([b_curr, t_curr, b_next])
        indices.extend([b_next, t_curr, t_next])
        
    # Inner cylinder wall
    for i in range(32):
        b_curr = 32 + i
        b_next = 32 + (i + 1) % 32
        t_curr = 96 + i
        t_next = 96 + (i + 1) % 32
        indices.extend([b_curr, b_next, t_curr])
        indices.extend([b_next, t_next, t_curr])
        
    return {"vertices": vertices, "indices": indices, "normals": []}

def generate_mock_mesh(features):
    W, D, H, R, F = 100.0, 80.0, 20.0, 33.4, 5.0
    has_extrude = False
    has_cut = False
    
    for feat in features:
        f_type = feat.get('type') if isinstance(feat, dict) else getattr(feat, 'type', None)
        params = feat.get('parameters', {}) if isinstance(feat, dict) else getattr(feat, 'parameters', {})
        if f_type == 'EXTRUDE' or f_type == 'BOX':
            has_extrude = True
            points = params.get('points', [])
            if len(points) >= 4:
                us = [pt[0] for pt in points]
                vs = [pt[1] for pt in points]
                width = max(us) - min(us)
                height = max(vs) - min(vs)
                if width > 0: W = width
                if height > 0: D = height
            H = float(params.get('depth', 20.0))
        elif (f_type == 'CYLINDER' or f_type == 'EXTRUDE') and params.get('operation') == 'CUT':
            has_cut = True
            points = params.get('points', [])
            if len(points) >= 2:
                us = [pt[0] for pt in points]
                radius = (max(us) - min(us)) / 2.0
                if radius > 0: R = radius
            else:
                R = float(params.get('radius', 33.4))
        elif f_type == 'FILLET':
            F = float(params.get('radius', 5.0))
            
    if has_extrude and has_cut:
        return make_mock_aviv_mesh(W, D, H, R, F)
        
    for feat in features:
        f_type = feat.get('type') if isinstance(feat, dict) else getattr(feat, 'type', None)
        params = feat.get('parameters', {}) if isinstance(feat, dict) else getattr(feat, 'parameters', {})
        if f_type == 'REVOLVE':
            points = params.get('points', [])
            angle = float(params.get('angle', 360.0))
            return make_mock_revolve_mesh(points, angle)
        elif f_type == 'BOX':
            w = float(params.get('width', 10.0))
            h = float(params.get('height', 10.0))
            d = float(params.get('depth', 10.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            return make_mock_box_mesh(w, h, d, x, y, z)
        elif f_type == 'CYLINDER':
            r = float(params.get('radius', 5.0))
            h = float(params.get('height', 10.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            return make_mock_cylinder_mesh(r, h, x, y, z)
        elif f_type == 'SPHERE':
            r = float(params.get('radius', 5.0))
            x = float(params.get('x', 0.0))
            y = float(params.get('y', 0.0))
            z = float(params.get('z', 0.0))
            return make_mock_sphere_mesh(r, x, y, z)
            
    return make_mock_box_mesh(20, 20, 20, -10, -10, -10)





def calculate_properties(features):
    """Calculates physical properties (Area, Volume) of the generated solid."""
    if not HAS_OCC:
        return {'area': 0.0, 'volume': 0.0}
    
    shape = build_shape_only(features)
    if not shape or shape.IsNull():
        return {'area': 0.0, 'volume': 0.0}
    
    props = GProp_GProps()
    # Calculate Area
    area_props = GProp_GProps()
    brepgprop_SurfaceProperties(shape, area_props)
    area = area_props.Mass()
    
    # Calculate Volume
    vol_props = GProp_GProps()
    brepgprop_VolumeProperties(shape, vol_props)
    volume = vol_props.Mass()
    
    return {
        'area': float(area),
        'volume': float(volume)
    }

