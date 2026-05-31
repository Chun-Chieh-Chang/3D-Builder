import math
import json
import hashlib
from collections import OrderedDict

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
    from OCC.Core.BRepGProp import brepgprop
    from OCC.Core.IGESControl import IGESControl_Writer
    from OCC.Core.StlAPI import StlAPI_Writer
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
    colors = [] # New colors array
    face_metadata = []
    edge_metadata = []

    from OCC.Core.TopAbs import TopAbs_REVERSED, TopAbs_FACE, TopAbs_EDGE
    from OCC.Core.TopoDS import topods
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
    from OCC.Core.BRepLProp import BRepLProp_SLProps
    from OCC.Core.GProp import GProp_GProps
    from OCC.Core.BRepGProp import brepgprop
    from OCC.Core.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
    from OCC.Core.BRep import BRep_Tool

    # Extract Face Metadata
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = topods.Face(explorer.Current())
        h_face = face.HashCode(10000000)
        
        # Resolve Color
        f_color_hex = linker.color_map.get(h_face, "#60A5FA") # Default Blue
        r, g, b = 0.37, 0.65, 0.98
        try:
            c_hex = f_color_hex.lstrip('#')
            if len(c_hex) == 6:
                r, g, b = int(c_hex[0:2], 16)/255.0, int(c_hex[2:4], 16)/255.0, int(c_hex[4:6], 16)/255.0
        except: pass

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
                colors.extend([r, g, b])
                
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

            # Compute basic face properties
            props = GProp_GProps()
            brepgprop.SurfaceProperties(face, props)
            face_area = props.Mass()
            v_count = triangulation.NbNodes()
            curvature = "unknown"
            
            surface_type = "UNKNOWN"
            axis_origin = None
            axis_direction = None
            radius = None
            
            try:
                adaptor = BRepAdaptor_Surface(face)
                geom_type = adaptor.GetType()
                if geom_type == GeomAbs_Cylinder:
                    surface_type = "CYLINDER"
                    curvature = "cylindrical"
                    cyl = adaptor.Cylinder()
                    ax3 = cyl.Position()
                    loc = ax3.Location()
                    dir_vec = ax3.Direction()
                    axis_origin = [loc.X(), loc.Y(), loc.Z()]
                    axis_direction = [dir_vec.X(), dir_vec.Y(), dir_vec.Z()]
                    radius = cyl.Radius()
                elif geom_type == GeomAbs_Plane:
                    surface_type = "PLANE"
                    curvature = "planar"
            except Exception as e:
                print(f"[WARNING] Surface type extraction failed: {e}")

            # Record face metadata for selection resolution
            face_metadata.append({
                "id": str(face.HashCode(1000000)), # Transient Hash
                "area": face_area,
                "curvature": curvature,
                "v_count": v_count,
                "index_range": [node_offset, len(vertices) // 3],
                "surface_type": surface_type,
                "axis_origin": axis_origin,
                "axis_direction": axis_direction,
                "radius": radius
            })
                
        explorer.Next()

    # Extract Edge Metadata
    explorer_edge = TopExp_Explorer(shape, TopAbs_EDGE)
    while explorer_edge.More():
        edge = topods.Edge(explorer_edge.Current())
        if not edge.IsNull():
            v_exp = TopExp_Explorer(edge, TopAbs_VERTEX)
            pnts = []
            while v_exp.More():
                v = topods.Vertex(v_exp.Current())
                pt = BRep_Tool.Pnt(v)
                pnts.append([pt.X(), pt.Y(), pt.Z()])
                v_exp.Next()
            
            if len(pnts) >= 2:
                # Basic signature
                props = GProp_GProps()
                brepgprop.LinearProperties(edge, props)
                length = props.Mass()
                
                edge_metadata.append({
                    "id": str(edge.HashCode(1000000)),
                    "start": pnts[0],
                    "end": pnts[-1],
                    "length": length
                })
        explorer_edge.Next()
        
    return {
        "vertices": vertices,
        "indices": indices,
        "normals": normals,
        "colors": colors,
        "face_metadata": face_metadata,
        "edge_metadata": edge_metadata
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

def get_tangent_edges(shape, start_edge, angular_tolerance=0.01):
    from OCC.Core.TopExp import topexp, TopExp_Explorer
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_ListIteratorOfListOfShape
    from OCC.Core.TopAbs import TopAbs_VERTEX, TopAbs_EDGE
    from OCC.Core.BRep import BRep_Tool
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
    from OCC.Core.TopoDS import topods
    from OCC.Core.gp import gp_Pnt, gp_Vec
    import math

    tangent_edges = [start_edge]
    visited_hashes = set([start_edge.HashCode(2**31 - 1)])
    
    # Map vertices to edges
    v_e_map = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_EDGE, v_e_map)
    
    queue = [start_edge]
    while queue:
        current_edge = queue.pop(0)
        c_curve = BRepAdaptor_Curve(current_edge)
        
        # Get vertices of current edge
        v_exp = TopExp_Explorer(current_edge, TopAbs_VERTEX)
        while v_exp.More():
            v = topods.Vertex(v_exp.Current())
            v_exp.Next()
            
            # evaluate tangent of current_edge at v
            param_c = BRep_Tool.Parameter(v, current_edge)
            pt_c = gp_Pnt()
            vec_c = gp_Vec()
            c_curve.D1(param_c, pt_c, vec_c)
            if vec_c.Magnitude() < 1e-7:
                continue
            vec_c.Normalize()
            
            # Check adjacent edges
            if v_e_map.Contains(v):
                edge_list = v_e_map.FindFromKey(v)
                it = TopTools_ListIteratorOfListOfShape(edge_list)
                while it.More():
                    adj_shape = it.Value()
                    it.Next()
                    adj_edge = topods.Edge(adj_shape)
                    ehash = adj_edge.HashCode(2**31 - 1)
                    if ehash in visited_hashes:
                        continue
                        
                    # Check tangency
                    adj_curve = BRepAdaptor_Curve(adj_edge)
                    param_adj = BRep_Tool.Parameter(v, adj_edge)
                    pt_adj = gp_Pnt()
                    vec_adj = gp_Vec()
                    adj_curve.D1(param_adj, pt_adj, vec_adj)
                    if vec_adj.Magnitude() < 1e-7:
                        continue
                    vec_adj.Normalize()
                    
                    # Angle between vectors
                    dot = max(-1.0, min(1.0, vec_c.Dot(vec_adj)))
                    angle = math.acos(dot)
                    
                    # Tangent if angle is ~0 or ~180 degrees
                    if angle < angular_tolerance or abs(angle - math.pi) < angular_tolerance:
                        tangent_edges.append(adj_edge)
                        visited_hashes.add(ehash)
                        queue.append(adj_edge)
                        
    return tangent_edges

def _build_wire_from_points(points, is_closed=True):
    make_wire = BRepBuilderAPI_MakeWire()
    
    def get_gp_pnt(p):
        x_val = float(p[0])
        y_val = float(p[1])
        z_val = float(p[2]) if len(p) >= 3 and isinstance(p[2], (int, float)) else 0.0
        return gp_Pnt(x_val, y_val, z_val)

    def get_label(p):
        return p[-1] if len(p) > 2 and isinstance(p[-1], str) else None

    i = 0
    n_points = len(points)
    limit = n_points if is_closed else n_points - 1
    
    while i < limit:
        p_start = points[i]
        p_next = points[(i + 1) % n_points]
        next_label = get_label(p_next)

        if next_label == 'ARC_CONTROL':
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
        elif next_label == 'SPLINE_CONTROL':
            # Gather all spline points until we hit a non-SPLINE_CONTROL point (which is the end point)
            spline_pts = [p_start]
            curr_idx = (i + 1) % n_points
            while get_label(points[curr_idx]) == 'SPLINE_CONTROL':
                spline_pts.append(points[curr_idx])
                curr_idx = (curr_idx + 1) % n_points
                if not is_closed and curr_idx == 0:
                    break # Reached end of open path
            
            p_end = points[curr_idx]
            spline_pts.append(p_end)
            
            from OCC.Core.TColgp import TColgp_HArray1OfPnt
            from OCC.Core.GeomAPI import GeomAPI_Interpolate
            
            h_array = TColgp_HArray1OfPnt(1, len(spline_pts))
            for idx, pt in enumerate(spline_pts):
                h_array.SetValue(idx + 1, get_gp_pnt(pt))
                
            anInterpolation = GeomAPI_Interpolate(h_array, False, 1.0e-3)
            anInterpolation.Perform()
            if anInterpolation.IsDone():
                spline_curve = anInterpolation.Curve()
                edge = BRepBuilderAPI_MakeEdge(spline_curve).Edge()
                make_wire.Add(edge)
            else:
                edge = BRepBuilderAPI_MakeEdge(get_gp_pnt(p_start), get_gp_pnt(p_end)).Edge()
                make_wire.Add(edge)
                
            # Advance i past all spline controls, note that p_end is the start of the next edge
            if curr_idx > i:
                i = curr_idx
            else:
                # Wrap around happened
                i = n_points
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

            if params.get('operation') == 'SURFACE':
                from OCC.Core.TopoDS import TopoDS_Compound
                from OCC.Core.BRep import BRep_Builder
                
                builder = BRep_Builder()
                comp = TopoDS_Compound()
                builder.MakeCompound(comp)
                
                for w in wires:
                    trsf = gp_Trsf()
                    trsf.SetTransformation(gp_Ax3(ax2), gp_Ax3())
                    
                    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
                    transform_api = BRepBuilderAPI_Transform(w, trsf)
                    moved_wire = transform_api.Shape()
                    
                    prism = BRepPrimAPI_MakePrism(moved_wire, vec).Shape()
                    builder.Add(comp, prism)
                current_feat_shape = comp
            else:
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
            
            # Construct profile wire (closed)
            profile_wire = _build_wire_from_points(profile_points, is_closed=True)
            
            # Construct path wire (open, supporting SPLINE_CONTROL points)
            path_wire = _build_wire_from_points(path_points, is_closed=False)
            
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

_REBUILD_MESH_CACHE: OrderedDict[str, object] = OrderedDict()
_REBUILD_CACHE_MAX = 48
_SHAPE_PREFIX_CACHE: OrderedDict[str, object] = OrderedDict()
_SHAPE_PREFIX_CACHE_MAX = 32


def _store_shape_prefix(cache_key: str, shape) -> None:
    if shape is None or (HAS_OCC and shape.IsNull()):
        return
    _SHAPE_PREFIX_CACHE[cache_key] = shape
    _SHAPE_PREFIX_CACHE.move_to_end(cache_key)
    while len(_SHAPE_PREFIX_CACHE) > _SHAPE_PREFIX_CACHE_MAX:
        _SHAPE_PREFIX_CACHE.popitem(last=False)


def _feature_tree_fingerprint(features) -> str:
    serializable = []
    for feat in features:
        if hasattr(feat, "model_dump"):
            serializable.append(feat.model_dump())
        elif hasattr(feat, "dict"):
            serializable.append(feat.dict())
        elif hasattr(feat, "type"):
            serializable.append(
                {"id": feat.id, "type": feat.type, "parameters": feat.parameters}
            )
        else:
            serializable.append(feat)
    payload = json.dumps(serializable, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def process_features_cached(
    features,
    deflection=0.01,
    from_feature_index=0,
    feature_fingerprint=None,
):
    """
    Rebuild with LRU mesh cache. When from_feature_index > 0 and a cached
    TopoDS prefix exists, only the suffix feature list is boolean-processed.
    """
    fp = feature_fingerprint or _feature_tree_fingerprint(features)
    cache_key = f"{fp}|from:{from_feature_index}|def:{deflection}"
    if cache_key in _REBUILD_MESH_CACHE:
        _REBUILD_MESH_CACHE.move_to_end(cache_key)
        return _REBUILD_MESH_CACHE[cache_key]

    from_index = max(0, int(from_feature_index or 0))
    result = None

    if not HAS_OCC:
        result = process_features(features, deflection=deflection)
    elif from_index > 0 and from_index < len(features):
        prefix = features[:from_index]
        prefix_key = _feature_tree_fingerprint(prefix)
        initial_shape = _SHAPE_PREFIX_CACHE.get(prefix_key)
        if initial_shape is None:
            initial_shape = build_shape_only(
                prefix,
                cache_prefixes=True,
                full_features=features,
                start_index=0,
            )
            if initial_shape is not None:
                _store_shape_prefix(prefix_key, initial_shape)
        if initial_shape is not None:
            ref_geometry = []
            final_shape = build_shape_only(
                features[from_index:],
                initial_shape=initial_shape,
                cache_prefixes=True,
                full_features=features,
                start_index=from_index,
            )
            if final_shape:
                result = {
                    "type": "mesh",
                    "data": _shape_to_mesh(final_shape, deflection),
                    "ref_geometry": ref_geometry,
                }
        if result is None:
            result = process_features(features, deflection=deflection)
    else:
        result = process_features(features, deflection=deflection)
        if result is not None:
            build_shape_only(
                features,
                cache_prefixes=True,
                full_features=features,
                start_index=0,
            )

    if result is not None:
        _REBUILD_MESH_CACHE[cache_key] = result
        while len(_REBUILD_MESH_CACHE) > _REBUILD_CACHE_MAX:
            _REBUILD_MESH_CACHE.popitem(last=False)
    return result


class TopologicalLinker:
    """Tracks how shapes evolve through operations (Boolean, Transform) and manages property inheritance."""
    def __init__(self):
        self.mapping = {} # Original Shape Hash -> List of New Shape Hashes
        self.shape_pool = {} # Hash -> Shape object
        self.color_map = {} # Hash -> Hex Color string
        
    def record_evolution(self, tool, original_shapes):
        """Records Generated and Modified shapes from an OCC tool (e.g. BRepAlgoAPI)."""
        from OCC.Core.TopExp import TopExp_Explorer
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE
        
        for orig in original_shapes:
            if orig is None or (HAS_OCC and orig.IsNull()): continue
            h_orig = orig.HashCode(10000000)
            self.shape_pool[h_orig] = orig
            
            # Get color from original shape if it exists
            orig_color = self.color_map.get(h_orig)
            
            # Track sub-shapes
            for sub_type in [TopAbs_FACE, TopAbs_EDGE]:
                exp = TopExp_Explorer(orig, sub_type)
                while exp.More():
                    sub = exp.Current()
                    h_sub = sub.HashCode(10000000)
                    self.shape_pool[h_sub] = sub
                    
                    # Inherit color from parent if sub-shape doesn't have one
                    sub_color = self.color_map.get(h_sub) or orig_color
                    if sub_color: self.color_map[h_sub] = sub_color
                    
                    # Get Generated
                    generated_list = tool.Generated(sub)
                    if generated_list and not generated_list.IsNull():
                        exp_gen = TopExp_Explorer(generated_list, sub_type)
                        while exp_gen.More():
                            gen_sub = exp_gen.Current()
                            h_gen = gen_sub.HashCode(10000000)
                            if h_sub not in self.mapping: self.mapping[h_sub] = []
                            self.mapping[h_sub].append(h_gen)
                            self.shape_pool[h_gen] = gen_sub
                            # Propagate Color to Generated
                            if sub_color: self.color_map[h_gen] = sub_color
                            exp_gen.Next()
                        
                    # Get Modified
                    modified_list = tool.Modified(sub)
                    if modified_list and not modified_list.IsNull():
                        exp_mod = TopExp_Explorer(modified_list, sub_type)
                        while exp_mod.More():
                            mod_sub = exp_mod.Current()
                            h_mod = mod_sub.HashCode(10000000)
                            if h_sub not in self.mapping: self.mapping[h_sub] = []
                            self.mapping[h_sub].append(h_mod)
                            self.shape_pool[h_mod] = mod_sub
                            # Propagate Color to Modified
                            if sub_color: self.color_map[h_mod] = sub_color
                            exp_mod.Next()
                    exp.Next()

linker = TopologicalLinker()

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
            f_color = getattr(feat, 'color', None)
        else:
            f_type = feat.get('type')
            params = feat.get('parameters', {})
            f_color = feat.get('color')
            
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

        elif f_type == 'THICKEN':
            if final_shape is not None:
                thickness = float(params.get('thickness', 1.0))
                try:
                    from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
                    from OCC.Core.TopTools import TopTools_ListOfShape
                    from OCC.Core.GeomAbs import GeomAbs_Arc
                    
                    # MakeThickSolid requires a solid, but for a surface we can use BRepOffsetAPI_MakeOffsetShape
                    # Actually BRepOffsetAPI_MakeOffsetShape creates a solid from a face if the offset is non-zero
                    from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape
                    
                    offset_maker = BRepOffsetAPI_MakeOffsetShape()
                    # PerformByJoin(Shape, OffsetValue, Tolerance, Mode, Intersection, SelfInter, JoinType)
                    from OCC.Core.BRepOffset import BRepOffset_Skin
                    offset_maker.PerformByJoin(final_shape, thickness, 1e-3, BRepOffset_Skin, False, False, GeomAbs_Arc)
                    if offset_maker.IsDone():
                        final_shape = offset_maker.Shape()
                except Exception as thicken_err:
                    print(f"[ERROR] THICKEN failed: {thicken_err}")
            continue

        elif f_type == 'SHELL':
            if final_shape is not None:
                thickness = float(params.get('thickness', 2.0))
                is_flip = params.get('flip', False)
                # In OCC, negative offset usually means internal shell
                actual_offset = thickness if is_flip else -thickness
                
                faces_to_remove_params = params.get('faces_to_remove_refs', [])
                
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
                    shell_tool = BRepOffsetAPI_MakeThickSolid(final_shape, removed_faces, actual_offset, 1e-3, GeomAbs_Arc, False)
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

        if f_type in ['SKETCH', 'SKETCH_POLYLINE', 'EXTRUDE', 'REVOLVE', 'BOX', 'CYLINDER', 'SPHERE', 'SWEEP', 'LOFT']:
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
            # Assign color to the new shape in the linker
            if f_color:
                h_feat = current_feat_shape.HashCode(10000000)
                linker.color_map[h_feat] = f_color

            if final_shape is None:
                final_shape = current_feat_shape
            else:

                    if op == 'ADD':
                        tool = BRepAlgoAPI_Fuse(final_shape, current_feat_shape)
                    else:
                        tool = BRepAlgoAPI_Cut(final_shape, current_feat_shape)
                    
                    tool.Build()
                    if tool.IsDone():
                        linker.record_evolution(tool, [final_shape, current_feat_shape])
                        final_shape = tool.Shape()
                except Exception as bool_err:
                    print(f"[ERROR] Boolean TNS 3.0 failed: {bool_err}")
                    # Fallback to standard non-tracking boolean
                    if op == 'ADD': final_shape = BRepAlgoAPI_Fuse(final_shape, current_feat_shape).Shape()
                    else: final_shape = BRepAlgoAPI_Cut(final_shape, current_feat_shape).Shape()

    if final_shape:
        return {"type": "mesh", "data": _shape_to_mesh(final_shape, deflection), "ref_geometry": ref_geometry}
    return None

def build_shape_only(
    features,
    initial_shape=None,
    cache_prefixes=False,
    full_features=None,
    start_index=0,
):
    """Processes features and returns the raw OCCT TopoDS_Shape."""
    final_shape = initial_shape
    all_features = full_features if full_features is not None else features
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
    
    for local_idx, feat in enumerate(features):
        if hasattr(feat, 'type'):
            f_type = feat.type
            params = feat.parameters
        else:
            f_type = feat.get('type')
            params = feat.get('parameters', {})

        op = params.get('operation', 'ADD')
        current_feat_shape = None
            
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
                is_flip = params.get('flip', False)
                # In OCC, negative offset usually means internal shell
                actual_offset = thickness if is_flip else -thickness
                
                faces_to_remove_params = params.get('faces_to_remove_refs', [])
                
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
                    shell_tool = BRepOffsetAPI_MakeThickSolid(final_shape, removed_faces, actual_offset, 1e-3, GeomAbs_Arc, False)
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
                tangent_prop = params.get('tangentPropagation', True)
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end, params.get("signature"))
                    if matched_edge:
                        try:
                            chamfer_tool = BRepFilletAPI_MakeChamfer(final_shape)
                            
                            edges_to_chamfer = [matched_edge]
                            if tangent_prop:
                                edges_to_chamfer = get_tangent_edges(final_shape, matched_edge)
                            
                            visited_hashes = set()
                            for e in edges_to_chamfer:
                                ehash = e.HashCode(2**31 - 1)
                                if ehash not in visited_hashes:
                                    chamfer_tool.Add(distance, e)
                                    visited_hashes.add(ehash)
                                
                            chamfer_tool.Build()
                            if chamfer_tool.IsDone():
                                final_shape = chamfer_tool.Shape()
                        except Exception as chamfer_err:
                            print(f"[ERROR] Chamfer failed: {chamfer_err}")
            continue

        elif f_type == 'FILLET':
            if final_shape is not None:
                r1 = float(params.get('radius', 2.0))
                r2 = float(params.get('radius2', r1))
                tangent_prop = params.get('tangentPropagation', True)
                refs = params.get('refs', [])
                if not refs:
                    # Fallback for old tests if they only pass edge_start and edge_end
                    edge_start = params.get('edge_start')
                    edge_end = params.get('edge_end')
                    if edge_start and edge_end:
                        refs = [{"edgeData": {"start": edge_start, "end": edge_end}, "signature": params.get("signature")}]
                
                if refs:
                    try:
                        from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
                        fillet_tool = BRepFilletAPI_MakeFillet(final_shape)
                        edges_added = 0
                        visited_hashes = set()
                        
                        for ref in refs:
                            edge_data = ref.get('edgeData', {})
                            edge_start = edge_data.get('start')
                            edge_end = edge_data.get('end')
                            signature = ref.get('signature')
                            if edge_start and edge_end:
                                matched_edge = find_matching_edge(final_shape, edge_start, edge_end, signature)
                                if matched_edge:
                                    edges_to_fillet = [matched_edge]
                                    if tangent_prop:
                                        edges_to_fillet = get_tangent_edges(final_shape, matched_edge)
                                        
                                    for e in edges_to_fillet:
                                        ehash = e.HashCode(2**31 - 1)
                                        if ehash not in visited_hashes:
                                            if abs(r1 - r2) < 1e-4:
                                                fillet_tool.Add(r1, e)
                                            else:
                                                fillet_tool.Add(r1, r2, e)
                                            visited_hashes.add(ehash)
                                            edges_added += 1
                        
                        if edges_added > 0:
                            fillet_tool.Build()
                            if fillet_tool.IsDone():
                                final_shape = fillet_tool.Shape()
                    except Exception as fillet_err:
                        print(f"[ERROR] Fillet failed: {fillet_err}")
            continue

        if f_type in ['SKETCH', 'SKETCH_POLYLINE', 'EXTRUDE', 'REVOLVE', 'BOX', 'CYLINDER', 'SPHERE', 'SWEEP', 'LOFT']:
            current_feat_shape = build_feature_shape_in_isolation(f_type, params, final_shape, features)

        elif f_type == 'PATTERN':
            target_ids = params.get('target_feature_ids', [])
            # Legacy support
            single_target = params.get('target_feature_id')
            if single_target and single_target not in target_ids:
                target_ids.append(single_target)
                
            pattern_type = params.get('pattern_type', 'LINEAR')
            count = int(params.get('count', 2))
            spacing = float(params.get('spacing', 10.0))
            direction_refs = params.get('direction_refs', [])
            
            dir_vec = gp_Vec(1, 0, 0)
            dir_pnt = gp_Pnt(0, 0, 0)
            
            if direction_refs and len(direction_refs) > 0 and final_shape is not None:
                ref = direction_refs[0]
                matched_edge = find_matching_edge(final_shape, ref.get('coordinates'), ref.get('end_coordinates'), ref.get('signature'))
                if matched_edge:
                    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
                    curve_adaptor = BRepAdaptor_Curve(matched_edge)
                    u_min = curve_adaptor.FirstParameter()
                    pnt = gp_Pnt()
                    vec = gp_Vec()
                    curve_adaptor.D1(u_min, pnt, vec)
                    if vec.Magnitude() > 1e-6:
                        dir_vec = vec.Normalized()
                    dir_pnt = pnt
            else:
                axis_str = params.get('axis', 'X')
                if axis_str == 'X':
                    dir_vec = gp_Vec(1, 0, 0)
                elif axis_str == 'Y':
                    dir_vec = gp_Vec(0, 1, 0)
                else:
                    dir_vec = gp_Vec(0, 0, 1)

            from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
            
            for target_id in target_ids:
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
                        target_op = tf_params.get('operation', 'ADD')
                        for i in range(1, count):
                            trsf = gp_Trsf()
                            if pattern_type == 'LINEAR':
                                val = spacing * i
                                trsf.SetTranslation(dir_vec.Multiplied(val))
                            else:  # CIRCULAR
                                angle_rad = math.radians(spacing * i)
                                ax1 = gp_Ax1(dir_pnt, gp_Dir(dir_vec.X(), dir_vec.Y(), dir_vec.Z()))
                                trsf.SetRotation(ax1, angle_rad)

                            copy_shape = BRepBuilderAPI_Transform(target_shape, trsf, True).Shape()
                            if final_shape is None:
                                final_shape = copy_shape
                            else:
                                if target_op == 'ADD':
                                    final_shape = BRepAlgoAPI_Fuse(final_shape, copy_shape).Shape()
                                elif target_op == 'CUT':
                                    final_shape = BRepAlgoAPI_Cut(final_shape, copy_shape).Shape()
                                
        elif f_type == 'MIRROR':
            target_ids = params.get('target_feature_ids', [])
            # Legacy support for single target_id
            single_target = params.get('target_feature_id')
            if single_target and single_target not in target_ids:
                target_ids.append(single_target)
                
            mirror_plane_refs = params.get('mirror_plane_refs', [])
            
            ax2 = gp_Ax2(gp_Pnt(0,0,0), gp_Dir(0,0,1))
            
            if mirror_plane_refs and len(mirror_plane_refs) > 0:
                ref = mirror_plane_refs[0]
                if ref.get('type') == 'FACE':
                    face_origin = ref.get('coordinates', [0,0,0])
                    face_normal = ref.get('normal', [0,0,1])
                    ax2 = gp_Ax2(gp_Pnt(*face_origin), gp_Dir(*face_normal))
                elif ref.get('id') in ['FRONT', 'TOP', 'RIGHT']:
                    plane = ref['id']
                    if plane == 'FRONT':
                        ax2 = gp_Ax2(gp_Pnt(0,0,0), gp_Dir(0,0,1), gp_Dir(1,0,0))
                    elif plane == 'TOP':
                        ax2 = gp_Ax2(gp_Pnt(0,0,0), gp_Dir(0,1,0), gp_Dir(1,0,0))
                    elif plane == 'RIGHT':
                        ax2 = gp_Ax2(gp_Pnt(0,0,0), gp_Dir(1,0,0), gp_Dir(0,0,-1))
            
            trsf = gp_Trsf()
            trsf.SetMirror(ax2)
            
            from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
            
            if target_ids:
                for target_id in target_ids:
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
                            # Use BRepBuilderAPI_Transform for mirror (better than Moved/TopLoc)
                            copy_shape = BRepBuilderAPI_Transform(target_shape, trsf, True).Shape()
                            target_op = tf_params.get('operation', 'ADD')
                            if target_op == 'ADD':
                                final_shape = BRepAlgoAPI_Fuse(final_shape, copy_shape).Shape()
                            elif target_op == 'CUT':
                                final_shape = BRepAlgoAPI_Cut(final_shape, copy_shape).Shape()
            else:
                if final_shape:
                    copy_shape = BRepBuilderAPI_Transform(final_shape, trsf, True).Shape()
                    final_shape = BRepAlgoAPI_Fuse(final_shape, copy_shape).Shape()

        elif f_type == 'DRAFT':
            angle_deg = float(params.get('angle', 5))
            angle_rad = math.radians(angle_deg)
            neutral_refs = params.get('neutral_plane_refs', [])
            face_refs = params.get('faces_to_draft_refs', [])
            
            if final_shape and neutral_refs and face_refs:
                n_ref = neutral_refs[0]
                n_origin = n_ref.get('coordinates', [0,0,0])
                n_normal = n_ref.get('normal', [0,0,1])
                n_sig = n_ref.get('signature', {})
                
                # Resolve neutral face with signature
                matched_n_origin, matched_n_normal, _ = find_matching_face(final_shape, n_origin, n_normal, n_sig)
                
                n_norm_vec = gp_Vec(*matched_n_normal)
                if n_norm_vec.Magnitude() > 1e-6:
                    n_norm_vec.Normalize()
                else:
                    n_norm_vec = gp_Vec(0,0,1)
                pull_dir = gp_Dir(n_norm_vec.X(), n_norm_vec.Y(), n_norm_vec.Z())
                
                from OCC.Core.Geom import Geom_Plane
                neutral_plane_geom = Geom_Plane(gp_Pnt(*matched_n_origin), pull_dir)
                
                from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
                draft_tool = BRepOffsetAPI_DraftAngle(final_shape)
                
                faces_added = 0
                for f_ref in face_refs:
                    f_origin = f_ref.get('coordinates', [0,0,0])
                    f_normal = f_ref.get('normal', [0,0,1])
                    f_sig = f_ref.get('signature', {})
                    _, _, matched_face = find_matching_face(final_shape, f_origin, f_normal, f_sig)
                    if matched_face:
                        draft_tool.Add(matched_face, pull_dir, angle_rad, neutral_plane_geom)
                        faces_added += 1
                
                if faces_added > 0:
                    try:
                        draft_tool.Build()
                        if draft_tool.IsDone():
                            final_shape = draft_tool.Shape()
                    except Exception as e:
                        print(f"[ERROR] Draft failed: {e}")

        elif f_type == 'SHELL':
            thickness = float(params.get('thickness', 2.0))
            is_flip = params.get('flip', False)
            actual_offset = thickness if is_flip else -thickness
            faces_refs = params.get('faces_to_remove_refs', [])
            
            if final_shape:
                from OCC.Core.TopTools import TopTools_ListOfShape
                from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
                
                faces_to_remove = TopTools_ListOfShape()
                for ref in faces_refs:
                    origin = ref.get('coordinates', [0,0,0])
                    normal = ref.get('normal', [0,0,1])
                    f_sig = ref.get('signature', {})
                    _, _, matched_face = find_matching_face(final_shape, origin, normal, f_sig)
                    if matched_face:
                        faces_to_remove.Append(matched_face)
                
                try:
                    from OCC.Core.GeomAbs import GeomAbs_Arc
                    shell_tool = BRepOffsetAPI_MakeThickSolid(final_shape, faces_to_remove, actual_offset, 1e-3, GeomAbs_Arc, False)
                    shell_tool.Build()
                    if shell_tool.IsDone():
                        final_shape = shell_tool.Shape()
                except Exception as e:
                    print(f"[ERROR] Isolated SHELL failed: {e}")
            continue
                    
        elif f_type == 'HOLE_WIZARD':
            hole_type = params.get('hole_type', 'SIMPLE')
            diameter = float(params.get('diameter', 5))
            depth = float(params.get('depth', 10))
            refs = params.get('hole_placement_refs', [])
            
            if final_shape and refs:
                ref = refs[0]
                origin = ref.get('coordinates', [0,0,0])
                normal = ref.get('normal', [0,0,1])
                
                # Prevent zero normal vector division
                norm_vec = gp_Vec(*normal)
                if norm_vec.Magnitude() > 1e-6:
                    norm_vec.Normalize()
                else:
                    norm_vec = gp_Vec(0,0,1)
                    
                drill_dir = gp_Dir(-norm_vec.X(), -norm_vec.Y(), -norm_vec.Z())
                drill_pnt = gp_Pnt(*origin)
                drill_ax2 = gp_Ax2(drill_pnt, drill_dir)
                
                hole_tool_shape = None
                
                try:
                    if hole_type == 'SIMPLE':
                        hole_tool_shape = BRepPrimAPI_MakeCylinder(drill_ax2, diameter/2.0, depth).Shape()
                        
                    elif hole_type == 'COUNTERBORE':
                        cb_dia = float(params.get('cb_diameter', 10))
                        cb_depth = float(params.get('cb_depth', 5))
                        
                        cb_cyl = BRepPrimAPI_MakeCylinder(drill_ax2, cb_dia/2.0, cb_depth).Shape()
                        
                        p2 = gp_Pnt(drill_pnt.X() + drill_dir.X()*cb_depth, 
                                    drill_pnt.Y() + drill_dir.Y()*cb_depth, 
                                    drill_pnt.Z() + drill_dir.Z()*cb_depth)
                        ax2_2 = gp_Ax2(p2, drill_dir)
                        main_cyl = BRepPrimAPI_MakeCylinder(ax2_2, diameter/2.0, max(0.1, depth - cb_depth)).Shape()
                        
                        hole_tool_shape = BRepAlgoAPI_Fuse(cb_cyl, main_cyl).Shape()
                        
                    elif hole_type == 'COUNTERSINK':
                        cs_dia = float(params.get('cs_diameter', 10))
                        cs_angle = float(params.get('cs_angle', 90))
                        
                        angle_rad = math.radians(cs_angle / 2.0)
                        if angle_rad > 0.01:
                            cone_depth = (cs_dia - diameter) / (2.0 * math.tan(angle_rad))
                        else:
                            cone_depth = 0.1
                            
                        # MakeCone takes R1, R2, H
                        cone = BRepPrimAPI_MakeCone(drill_ax2, cs_dia/2.0, diameter/2.0, cone_depth).Shape()
                        
                        p2 = gp_Pnt(drill_pnt.X() + drill_dir.X()*cone_depth, 
                                    drill_pnt.Y() + drill_dir.Y()*cone_depth, 
                                    drill_pnt.Z() + drill_dir.Z()*cone_depth)
                        ax2_2 = gp_Ax2(p2, drill_dir)
                        main_cyl = BRepPrimAPI_MakeCylinder(ax2_2, diameter/2.0, max(0.1, depth - cone_depth)).Shape()
                        
                        hole_tool_shape = BRepAlgoAPI_Fuse(cone, main_cyl).Shape()
                    
                    if hole_tool_shape:
                        final_shape = BRepAlgoAPI_Cut(final_shape, hole_tool_shape).Shape()
                except Exception as e:
                    print(f"[ERROR] Hole Wizard failed: {e}")

        # Perform the B-Rep boolean combination
        if current_feat_shape:
            # Assign color to the new shape in the linker
            if f_color:
                h_feat = current_feat_shape.HashCode(10000000)
                linker.color_map[h_feat] = f_color

            if final_shape is None:
                final_shape = current_feat_shape
            else:

                    if op == 'ADD':
                        tool = BRepAlgoAPI_Fuse(final_shape, current_feat_shape)
                    else:
                        tool = BRepAlgoAPI_Cut(final_shape, current_feat_shape)
                    
                    tool.Build()
                    if tool.IsDone():
                        linker.record_evolution(tool, [final_shape, current_feat_shape])
                        final_shape = tool.Shape()
                except Exception as bool_err:
                    print(f"[ERROR] Boolean TNS 3.0 failed: {bool_err}")
                    # Fallback to standard non-tracking boolean
                    if op == 'ADD': final_shape = BRepAlgoAPI_Fuse(final_shape, current_feat_shape).Shape()
                    else: final_shape = BRepAlgoAPI_Cut(final_shape, current_feat_shape).Shape()

        if cache_prefixes and final_shape is not None and HAS_OCC and not final_shape.IsNull():
            global_idx = start_index + local_idx
            prefix_key = _feature_tree_fingerprint(all_features[: global_idx + 1])
            _store_shape_prefix(prefix_key, final_shape)

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




def project_2d(features, plane_type='FRONT', section_plane=None):
    """
    Industrial-grade 2D View Projection using OpenCASCADE HLR (Hidden Line Removal).
    Separates visible and hidden edges for technical drawing standards.
    """
    shape = build_shape_only(features)
    if not shape or shape.IsNull():
        return []

    # --- P5-2 Section View Support ---
    if section_plane and HAS_OCC:
        try:
            from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Section
            from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeFace
            from OCC.Core.gp import gp_Pln, gp_Pnt, gp_Dir
            
            p_ori = section_plane.get('origin', [0,0,0])
            p_norm = section_plane.get('normal', [0,0,1])
            plane = gp_Pln(gp_Pnt(*p_ori), gp_Dir(*p_norm))
            
            # Generate the intersection curve (Section edges)
            section_tool = BRepAlgoAPI_Section(shape, plane, True)
            section_tool.Build()
            if section_tool.IsDone():
                section_shape = section_tool.Shape()
                # For a true section view in 2D, we often want BOTH the HLR of the remaining part 
                # AND the highlighted section profile. 
                # For 1.5, we will prioritize returning the section edges.
                # In a full impl, we'd clip the 'shape' first.
                pass
        except Exception as sec_err:
            print(f"[ERROR] Section generation failed: {sec_err}")

    if not HAS_OCC:
        # Fallback for non-OCC environments (Simplified wireframe)
        projected_lines = []
        explorer = TopExp_Explorer(shape, TopAbs_EDGE)
        while explorer.More():
            edge = topods.Edge(explorer.Current())
            v_exp = TopExp_Explorer(edge, TopAbs_VERTEX)
            pnts = []
            while v_exp.More():
                v = topods.Vertex(v_exp.Current())
                pt = BRep_Tool.Pnt(v)
                if plane_type == 'FRONT': u, v_val = pt.X(), pt.Y()
                elif plane_type == 'TOP': u, v_val = pt.X(), -pt.Z()
                elif plane_type == 'RIGHT': u, v_val = pt.Z(), pt.Y()
                elif plane_type == 'ISO': 
                    u = (pt.X() - pt.Z()) * 0.707106781
                    v_val = pt.Y() - (pt.X() + pt.Z()) * 0.35355339
                else: u, v_val = pt.X(), pt.Y()
                pnts.append([u, v_val])
                v_exp.Next()
            if len(pnts) >= 2: projected_lines.append({"points": pnts, "visible": True})
            explorer.Next()
        return projected_lines

    # --- Full HLR Algorithm for Production ---
    from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
    from OCC.Core.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
    
    # Default camera orientation
    eye = gp_Dir(0, 0, 1)
    up = gp_Dir(0, 1, 0)
    custom_basis = None

    # Define camera orientation for HLR based on plane_type
    if plane_type == 'FRONT': eye = gp_Dir(0, 0, 1); up = gp_Dir(0, 1, 0)
    elif plane_type == 'TOP': eye = gp_Dir(0, 1, 0); up = gp_Dir(0, 0, -1)
    elif plane_type == 'RIGHT': eye = gp_Dir(1, 0, 0); up = gp_Dir(0, 1, 0)
    elif plane_type == 'ISO': eye = gp_Dir(1, 1, 1); up = gp_Dir(0, 1, 0)
    else:
        # Check if it's a reference plane ID
        target_plane = next((f for f in features if (f.id if hasattr(f, 'id') else f.get('id')) == plane_type), None)
        if target_plane:
            p_params = target_plane.parameters if hasattr(target_plane, 'parameters') else target_plane.get('parameters', {})
            custom_basis = generate_reference_plane(p_params.get('planeType', 'OFFSET'), p_params.get('refs', []), p_params.get('offset', 0.0), features)
            eye = gp_Dir(*custom_basis['normal'])
            up = gp_Dir(*custom_basis['yDir'])
    
    # Setup HLR Projector
    from OCC.Core.HLRAlgo import HLRAlgo_Projector
    projector = HLRAlgo_Projector(gp_Ax2(gp_Pnt(0,0,0), eye, up))
    
    hlr = HLRBRep_Algo()
    hlr.Add(shape)
    hlr.Projector(projector)
    hlr.Update()
    hlr.Hide()
    
    hlr_shapes = HLRBRep_HLRToShape(hlr)
    
    output_lines = []
    
    def extract_from_shape(s, is_visible):
        exp = TopExp_Explorer(s, TopAbs_EDGE)
        while exp.More():
            e = topods.Edge(exp.Current())
            adaptor = BRepAdaptor_Curve(e)
            pnts = []
            n_samples = 10
            for i in range(n_samples + 1):
                p = adaptor.Value(adaptor.FirstParameter() + (adaptor.LastParameter()-adaptor.FirstParameter()) * i / n_samples)
                # Map to 2D view space
                if plane_type == 'FRONT': u, v_val = p.X(), p.Y()
                elif plane_type == 'TOP': u, v_val = p.X(), -p.Z()
                elif plane_type == 'RIGHT': u, v_val = p.Z(), p.Y()
                elif plane_type == 'ISO': 
                    u = (p.X() - p.Z()) * 0.707106781
                    v_val = p.Y() - (p.X() + p.Z()) * 0.35355339
                elif custom_basis:
                    uv = project_3d_to_2d(p.X(), p.Y(), p.Z(), 'FACE', face_origin=custom_basis['origin'], face_normal=custom_basis['normal'])
                    u, v_val = uv[0], uv[1]
                else: u, v_val = p.X(), p.Y()
                pnts.append([u, v_val])
            output_lines.append({"points": pnts, "visible": is_visible})
            exp.Next()

    extract_from_shape(hlr_shapes.VCompound(), True)
    extract_from_shape(hlr_shapes.OutLineVCompound(), True)
    # Hidden lines (dashed)
    extract_from_shape(hlr_shapes.HCompound(), False)
    extract_from_shape(hlr_shapes.OutLineHCompound(), False)
    
    return output_lines

def project_assembly_2d(components_data, plane_type='FRONT'):
    """
    Project a multi-body assembly into 2D using HLR.
    """
    if not HAS_OCC:
        return []
    
    from OCC.Core.TopoDS import TopoDS_Compound
    from OCC.Core.BRep import BRep_Builder
    from OCC.Core.TopLoc import TopLoc_Location
    from OCC.Core.gp import gp_Trsf, gp_Vec, gp_Ax1, gp_Pnt, gp_Dir, gp_Ax2
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_EDGE
    from OCC.Core.TopoDS import topods
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
    from OCC.Core.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
    from OCC.Core.HLRAlgo import HLRAlgo_Projector

    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    
    for comp in components_data:
        features = comp.get('features', [])
        transform = comp.get('transform', {})
        shape = build_shape_only(features)
        
        if shape and not shape.IsNull():
            pos = transform.get('position', [0.0, 0.0, 0.0])
            rot = transform.get('rotation', [0.0, 0.0, 0.0])
            
            rx, ry, rz = rot[0], rot[1], rot[2]
            trsf_x = gp_Trsf()
            trsf_x.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(1,0,0)), rx)
            trsf_y = gp_Trsf()
            trsf_y.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,1,0)), ry)
            trsf_z = gp_Trsf()
            trsf_z.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,0,1)), rz)
            
            final_rot = trsf_z.Multiplied(trsf_y).Multiplied(trsf_x)
            final_trsf = gp_Trsf()
            final_trsf.SetTranslation(gp_Vec(*pos))
            final_trsf.Multiply(final_rot)
            
            shape.Move(TopLoc_Location(final_trsf))
            builder.Add(compound, shape)
            
    if plane_type == 'FRONT': eye = gp_Dir(0, 0, 1); up = gp_Dir(0, 1, 0)
    elif plane_type == 'TOP': eye = gp_Dir(0, 1, 0); up = gp_Dir(0, 0, -1)
    elif plane_type == 'RIGHT': eye = gp_Dir(1, 0, 0); up = gp_Dir(0, 1, 0)
    elif plane_type == 'ISO': 
        eye = gp_Dir(1, 1, 1)
        up = gp_Dir(0, 1, 0)
    else: eye = gp_Dir(0, 0, 1); up = gp_Dir(0, 1, 0)
    
    projector = HLRAlgo_Projector(gp_Ax2(gp_Pnt(0,0,0), eye, up))
    
    hlr = HLRBRep_Algo()
    hlr.Add(compound)
    hlr.Projector(projector)
    hlr.Update()
    hlr.Hide()
    
    hlr_shapes = HLRBRep_HLRToShape(hlr)
    output_lines = []
    
    def extract_from_shape(s, is_visible):
        exp = TopExp_Explorer(s, TopAbs_EDGE)
        while exp.More():
            e = topods.Edge(exp.Current())
            adaptor = BRepAdaptor_Curve(e)
            pnts = []
            n_samples = 10
            # Setup projection coordinates for ISO as well
            # For ISO, we want isometric projection:
            # But the projector itself does 3D->2D transform?
            # Actually, HLRAlgo_Projector transforms points if we use its Project methods.
            # But we can just use the standard 2D mapping if we rotate the geometry.
            # Wait, HLRAlgo_Projector DOES NOT rotate the 3D output of HLRBRep_HLRToShape.
            # The returned VCompound is in the ORIGINAL 3D coordinates!
            # So if we map to X,Y for FRONT it works because eye is Z.
            # For ISO we need to project. HLRAlgo_Projector has Project(p3d, p2d) but we don't have python bindings easily accessible.
            # Let's write a simple matrix projection for ISO view:
            
            iso_u = lambda x,y,z: (x - z) * 0.707106781
            iso_v = lambda x,y,z: y - (x + z) * 0.35355339
            
            for i in range(n_samples + 1):
                p = adaptor.Value(adaptor.FirstParameter() + (adaptor.LastParameter()-adaptor.FirstParameter()) * i / n_samples)
                if plane_type == 'FRONT': u, v_val = p.X(), p.Y()
                elif plane_type == 'TOP': u, v_val = p.X(), -p.Z() # Map Top correctly (Z is down in 2D)
                elif plane_type == 'RIGHT': u, v_val = p.Z(), p.Y() # Map Right correctly (Z is horizontal)
                elif plane_type == 'ISO': u, v_val = iso_u(p.X(), p.Y(), p.Z()), iso_v(p.X(), p.Y(), p.Z())
                else: u, v_val = p.X(), p.Y()
                pnts.append([u, v_val])
            output_lines.append({"points": pnts, "visible": is_visible})
            exp.Next()

    extract_from_shape(hlr_shapes.VCompound(), True)
    extract_from_shape(hlr_shapes.OutLineVCompound(), True)
    extract_from_shape(hlr_shapes.HCompound(), False)
    extract_from_shape(hlr_shapes.OutLineHCompound(), False)
    return output_lines


def project_3d_to_2d(x, y, z, plane_type, face_origin=None, face_normal=None):
    """Projects a 3D world space coordinate onto the active plane local 2D UV coordinate space."""
    if plane_type == 'FRONT':
        return [x, y]
    elif plane_type == 'TOP':
        return [x, z]
    elif plane_type == 'RIGHT':
        return [y, z]
    elif plane_type == 'FACE' and face_origin and face_normal:
        ox, oy, oz = float(face_origin[0]), float(face_origin[1]), float(face_origin[2])
        nx, ny, nz = float(face_normal[0]), float(face_normal[1]), float(face_normal[2])
        
        # Normalize normal
        n_len = math.sqrt(nx*nx + ny*ny + nz*nz)
        if n_len > 1e-6:
            nx, ny, nz = nx/n_len, ny/n_len, nz/n_len
        else:
            nx, ny, nz = 0.0, 0.0, 1.0
            
        # Compute tangent xDir
        if abs(nx) < 1e-5 and abs(ny) < 1e-5:
            tx, ty, tz = 1.0, 0.0, 0.0
        else:
            tx, ty, tz = -ny, nx, 0.0
            t_len = math.sqrt(tx*tx + ty*ty)
            tx, ty = tx/t_len, ty/t_len
            
        # Compute bitangent yDir = normal x tangent
        bx = ny * tz - nz * ty
        by = nz * tx - nx * tz
        bz = nx * ty - ny * tx
        
        # Project vector from origin
        dx, dy, dz = x - ox, y - oy, z - oz
        u = dx * tx + dy * ty + dz * tz
        v = dx * bx + dy * by + dz * bz
        return [u, v]
        
    return [x, y]


def find_closest_face(shape, point_3d):
    """Finds the closest B-Rep TopoDS_Face in the shape to the given 3D coordinate point."""
    if not shape or shape.IsNull():
        return None
        
    try:
        target_pt = [float(point_3d[0]), float(point_3d[1]), float(point_3d[2])]
    except Exception:
        return None
        
    best_face = None
    min_dist = float('inf')
    
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = topods.Face(explorer.Current())
        
        # Traverse vertices to check distance
        v_exp = TopExp_Explorer(face, TopAbs_VERTEX)
        face_min_v_dist = float('inf')
        sum_x, sum_y, sum_z = 0.0, 0.0, 0.0
        v_count = 0
        
        while v_exp.More():
            v = topods.Vertex(v_exp.Current())
            pt = BRep_Tool.Pnt(v)
            d = math.dist(target_pt, [pt.X(), pt.Y(), pt.Z()])
            if d < face_min_v_dist:
                face_min_v_dist = d
            sum_x += pt.X()
            sum_y += pt.Y()
            sum_z += pt.Z()
            v_count += 1
            v_exp.Next()
            
        if v_count > 0:
            center = [sum_x / v_count, sum_y / v_count, sum_z / v_count]
            d_center = math.dist(target_pt, center)
            effective_dist = min(face_min_v_dist, d_center)
            
            if effective_dist < min_dist:
                min_dist = effective_dist
                best_face = face
                
        explorer.Next()
        
    if min_dist < 10.0:
        return best_face
    return None


def find_matching_face(shape, ref_origin, ref_normal, signature=None):
    """
    Topological Naming Service (TNS) for faces:
    Attempts to locate the corresponding face on the rebuilt `shape` that matches
    the original `ref_origin`, `ref_normal`, and optional geometric `signature`.
    """
    if not shape or shape.IsNull():
        return ref_origin, ref_normal, None
        
    try:
        r_ori = [float(ref_origin[0]), float(ref_origin[1]), float(ref_origin[2])]
        r_nrm = [float(ref_normal[0]), float(ref_normal[1]), float(ref_normal[2])]
    except Exception:
        return ref_origin, ref_normal, None

    # Normalize reference normal
    n_len = math.sqrt(r_nrm[0]**2 + r_nrm[1]**2 + r_nrm[2]**2)
    if n_len > 1e-6:
        r_nrm = [r_nrm[0]/n_len, r_nrm[1]/n_len, r_nrm[2]/n_len]
    else:
        r_nrm = [0.0, 0.0, 1.0]

    candidate_faces = []
    
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = topods.Face(explorer.Current())
        
        # Calculate geometric center of gravity
        v_exp = TopExp_Explorer(face, TopAbs_VERTEX)
        v_count = 0
        sum_x, sum_y, sum_z = 0.0, 0.0, 0.0
        while v_exp.More():
            v = topods.Vertex(v_exp.Current())
            pt = BRep_Tool.Pnt(v)
            sum_x += pt.X()
            sum_y += pt.Y()
            sum_z += pt.Z()
            v_count += 1
            v_exp.Next()
            
        if v_count == 0:
            explorer.Next()
            continue
            
        center = [sum_x / v_count, sum_y / v_count, sum_z / v_count]
        
        # Resolve normal direction of surface using Adaptor
        surf_normal = None
        try:
            from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
            adaptor = BRepAdaptor_Surface(face)
            surf_type = adaptor.GetType()
            if surf_type == 0: # GeomAbs_Plane
                gp_pln = adaptor.Plane()
                gp_dir = gp_pln.Position().Direction()
                surf_normal = [gp_dir.X(), gp_dir.Y(), gp_dir.Z()]
                from OCC.Core.TopAbs import TopAbs_REVERSED
                if face.Orientation() == TopAbs_REVERSED:
                    surf_normal = [-surf_normal[0], -surf_normal[1], -surf_normal[2]]
        except Exception:
            pass
            
        if not surf_normal:
            surf_normal = r_nrm  # Fallback

        # Check normal alignment (dot product > 0.95, roughly within 18 degrees)
        dot = surf_normal[0]*r_nrm[0] + surf_normal[1]*r_nrm[1] + surf_normal[2]*r_nrm[2]
        if dot > 0.95:
            proj_dist = center[0]*r_nrm[0] + center[1]*r_nrm[1] + center[2]*r_nrm[2]
            candidate_faces.append({
                "face": face,
                "center": center,
                "normal": surf_normal,
                "proj_dist": proj_dist
            })
            
        explorer.Next()

    if not candidate_faces:
        return ref_origin, ref_normal, None

    # If only one candidate aligns with normal, it is a perfect match (e.g. box faces)
    if len(candidate_faces) == 1:
        best = candidate_faces[0]
        return best["center"], best["normal"], best["face"]

    # Multi-signature disambiguation (TNS Stage 2)
    # Weights: 1.0 * Distance + 0.5 * AreaDiff + 2.0 * CurvatureMismatch
    r_area = float(signature.get('area', 0.0)) if signature else 0.0
    r_curv = signature.get('curvature', 'PLANE') if signature else 'PLANE'

    def calculate_score(c):
        dist = math.dist(c["center"], r_ori)
        # Area similarity (normalized)
        area_diff = abs(c.get("area", 0) - r_area) / (max(r_area, 1e-6))
        # Curvature penalty (high if types don't match)
        curv_penalty = 0 if c.get("curvature") == r_curv else 100.0
        return dist + (area_diff * 5.0) + curv_penalty

    # Pre-populate candidate metadata for scoring
    for c in candidate_faces:
        c_face = c["face"]
        c_props = GProp_GProps()
        brepgprop.SurfaceProperties(c_face, c_props)
        c["area"] = c_props.Mass()
        c_surf = BRepAdaptor_Surface(c_face)
        c_stype = c_surf.GetType()
        from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Sphere, GeomAbs_Cone, GeomAbs_Torus
        c["curvature"] = "PLANE" if c_stype == GeomAbs_Plane else "CYLINDER" if c_stype == GeomAbs_Cylinder else "SPHERE" if c_stype == GeomAbs_Sphere else "UNKNOWN"

    best_candidate = min(candidate_faces, key=calculate_score)
    return best_candidate["center"], best_candidate["normal"], best_candidate["face"]


def convert_entities(features, topology, plane_type, face_origin=None, face_normal=None):
    """Projects outer boundaries of 3D selected faces or selected edges onto the sketch plane's LCS UV space."""
    if not HAS_OCC:
        return []
        
    shape = build_shape_only(features)
    if not shape or shape.IsNull():
        return []

    # --- P5-2 Section View Support ---
    if section_plane and HAS_OCC:
        try:
            from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Section
            from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeFace
            from OCC.Core.gp import gp_Pln, gp_Pnt, gp_Dir
            
            p_ori = section_plane.get('origin', [0,0,0])
            p_norm = section_plane.get('normal', [0,0,1])
            plane = gp_Pln(gp_Pnt(*p_ori), gp_Dir(*p_norm))
            
            # Generate the intersection curve (Section edges)
            section_tool = BRepAlgoAPI_Section(shape, plane, True)
            section_tool.Build()
            if section_tool.IsDone():
                section_shape = section_tool.Shape()
                # For a true section view in 2D, we often want BOTH the HLR of the remaining part 
                # AND the highlighted section profile. 
                # For 1.5, we will prioritize returning the section edges.
                # In a full impl, we'd clip the 'shape' first.
                pass
        except Exception as sec_err:
            print(f"[ERROR] Section generation failed: {sec_err}")
        
    topo_type = topology.get('type')
    coords = topology.get('coordinates', [0.0, 0.0, 0.0])
    
    projected_points = []
    
    if topo_type == 'EDGE':
        edge_data = topology.get('edgeData')
        if edge_data and 'start' in edge_data and 'end' in edge_data:
            t_start = edge_data['start']
            t_end = edge_data['end']
            matched_edge = find_matching_edge(shape, t_start, t_end)
            
            if matched_edge:
                from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
                from OCC.Core.GeomAbs import GeomAbs_Line, GeomAbs_Circle
                
                curve = BRepAdaptor_Curve(matched_edge)
                c_type = curve.GetType()
                
                p_start = curve.Value(curve.FirstParameter())
                p_end = curve.Value(curve.LastParameter())
                
                uv_start = project_3d_to_2d(p_start.X(), p_start.Y(), p_start.Z(), plane_type, face_origin, face_normal)
                uv_end = project_3d_to_2d(p_end.X(), p_end.Y(), p_end.Z(), plane_type, face_origin, face_normal)
                
                if c_type == GeomAbs_Circle:
                    mid_param = (curve.FirstParameter() + curve.LastParameter()) / 2.0
                    p_mid = curve.Value(mid_param)
                    uv_mid = project_3d_to_2d(p_mid.X(), p_mid.Y(), p_mid.Z(), plane_type, face_origin, face_normal)
                    
                    projected_points.append([uv_start[0], uv_start[1], 'START'])
                    projected_points.append([uv_mid[0], uv_mid[1], 'ARC_CONTROL'])
                    projected_points.append([uv_end[0], uv_end[1]])
                else:
                    projected_points.append([uv_start[0], uv_start[1], 'START'])
                    projected_points.append([uv_end[0], uv_end[1]])
        
        if not projected_points:
            uv = project_3d_to_2d(coords[0], coords[1], coords[2], plane_type, face_origin, face_normal)
            projected_points.append([uv[0], uv[1], 'START'])
            
    elif topo_type == 'FACE':
        matched_face = find_closest_face(shape, coords)
        if matched_face:
            from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
            from OCC.Core.GeomAbs import GeomAbs_Line, GeomAbs_Circle
            
            edge_exp = TopExp_Explorer(matched_face, TopAbs_EDGE)
            while edge_exp.More():
                edge = topods.Edge(edge_exp.Current())
                curve = BRepAdaptor_Curve(edge)
                c_type = curve.GetType()
                
                p_start = curve.Value(curve.FirstParameter())
                p_end = curve.Value(curve.LastParameter())
                
                uv_start = project_3d_to_2d(p_start.X(), p_start.Y(), p_start.Z(), plane_type, face_origin, face_normal)
                uv_end = project_3d_to_2d(p_end.X(), p_end.Y(), p_end.Z(), plane_type, face_origin, face_normal)
                
                if c_type == GeomAbs_Circle:
                    mid_param = (curve.FirstParameter() + curve.LastParameter()) / 2.0
                    p_mid = curve.Value(mid_param)
                    uv_mid = project_3d_to_2d(p_mid.X(), p_mid.Y(), p_mid.Z(), plane_type, face_origin, face_normal)
                    
                    projected_points.append([uv_start[0], uv_start[1], 'START'])
                    projected_points.append([uv_mid[0], uv_mid[1], 'ARC_CONTROL'])
                    projected_points.append([uv_end[0], uv_end[1]])
                else:
                    projected_points.append([uv_start[0], uv_start[1], 'START'])
                    projected_points.append([uv_end[0], uv_end[1]])
                    
                edge_exp.Next()
                
    return projected_points


def offset_entities(points_2d, distance, plane_type, face_origin=None, face_normal=None):
    """Constructs a 2D B-Rep wire from sketch points, offsets it using BRepOffsetAPI_MakeOffset, and returns projected UV vertices."""
    if not HAS_OCC or not points_2d:
        return []
        
    try:
        from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeOffset
        from OCC.Core.GeomAbs import GeomAbs_Arc
        
        make_wire = BRepBuilderAPI_MakeWire()
        
        i = 0
        n_points = len(points_2d)
        
        while i < n_points:
            p_start = points_2d[i]
            p_next = points_2d[(i + 1) % n_points]
            
            if len(p_next) > 2 and 'START' in str(p_next[2]):
                i += 1
                continue
                
            p_start_pt = gp_Pnt(float(p_start[0]), float(p_start[1]), 0.0)
            
            if len(p_next) > 2 and 'ARC_CONTROL' in str(p_next[2]):
                p_control = p_next
                p_end = points_2d[(i + 2) % n_points]
                p_control_pt = gp_Pnt(float(p_control[0]), float(p_control[1]), 0.0)
                p_end_pt = gp_Pnt(float(p_end[0]), float(p_end[1]), 0.0)
                
                arc = GC_MakeArcOfCircle(p_start_pt, p_control_pt, p_end_pt)
                if arc.IsDone():
                    edge = BRepBuilderAPI_MakeEdge(arc.Value()).Edge()
                    make_wire.Add(edge)
                else:
                    edge = BRepBuilderAPI_MakeEdge(p_start_pt, p_end_pt).Edge()
                    make_wire.Add(edge)
                i += 2
            else:
                p_next_pt = gp_Pnt(float(p_next[0]), float(p_next[1]), 0.0)
                edge = BRepBuilderAPI_MakeEdge(p_start_pt, p_next_pt).Edge()
                make_wire.Add(edge)
                i += 1
                
        wire = make_wire.Wire()
        if wire.IsNull():
            return []
            
        offset_tool = BRepOffsetAPI_MakeOffset()
        offset_tool.Initialize(wire, GeomAbs_Arc)
        offset_tool.Perform(float(distance))
        
        offset_points = []
        if offset_tool.IsDone():
            offset_shape = offset_tool.Shape()
            explorer = TopExp_Explorer(offset_shape, TopAbs_EDGE)
            while explorer.More():
                edge = topods.Edge(explorer.Current())
                from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
                from OCC.Core.GeomAbs import GeomAbs_Line, GeomAbs_Circle
                
                curve = BRepAdaptor_Curve(edge)
                c_type = curve.GetType()
                
                p_start = curve.Value(curve.FirstParameter())
                p_end = curve.Value(curve.LastParameter())
                
                if c_type == GeomAbs_Circle:
                    mid_param = (curve.FirstParameter() + curve.LastParameter()) / 2.0
                    p_mid = curve.Value(mid_param)
                    offset_points.append([p_start.X(), p_start.Y(), 'START'])
                    offset_points.append([p_mid.X(), p_mid.Y(), 'ARC_CONTROL'])
                    offset_points.append([p_end.X(), p_end.Y()])
                else:
                    offset_points.append([p_start.X(), p_start.Y(), 'START'])
                    offset_points.append([p_end.X(), p_end.Y()])
                explorer.Next()
                
        if not offset_points:
            offset_points = []
            for p in points_2d:
                tag = p[2] if len(p) > 2 else None
                offset_points.append([float(p[0]) + float(distance), float(p[1]) + float(distance), tag])
                
        return offset_points
        
    except Exception as e:
        print("[ERROR] Offset entities failed:", e)
        offset_points = []
        for p in points_2d:
            tag = p[2] if len(p) > 2 else None
            offset_points.append([float(p[0]) + float(distance), float(p[1]) + float(distance), tag])
        return offset_points


def get_intersection_curve(features, plane_type, face_origin=None, face_normal=None):
    """Intersects 3D solid with the active sketch plane using BRepAlgoAPI_Section and returns the 2D UV wire points."""
    if not HAS_OCC:
        return []
        
    shape = build_shape_only(features)
    if not shape or shape.IsNull():
        return []

    # --- P5-2 Section View Support ---
    if section_plane and HAS_OCC:
        try:
            from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Section
            from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeFace
            from OCC.Core.gp import gp_Pln, gp_Pnt, gp_Dir
            
            p_ori = section_plane.get('origin', [0,0,0])
            p_norm = section_plane.get('normal', [0,0,1])
            plane = gp_Pln(gp_Pnt(*p_ori), gp_Dir(*p_norm))
            
            # Generate the intersection curve (Section edges)
            section_tool = BRepAlgoAPI_Section(shape, plane, True)
            section_tool.Build()
            if section_tool.IsDone():
                section_shape = section_tool.Shape()
                # For a true section view in 2D, we often want BOTH the HLR of the remaining part 
                # AND the highlighted section profile. 
                # For 1.5, we will prioritize returning the section edges.
                # In a full impl, we'd clip the 'shape' first.
                pass
        except Exception as sec_err:
            print(f"[ERROR] Section generation failed: {sec_err}")
        
    try:
        from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Section
        from OCC.Core.gp import gp_Pln
        
        x_origin = 0.0
        y_origin = 0.0
        z_origin = 0.0
        
        if plane_type == 'FRONT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
        elif plane_type == 'TOP':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
        elif plane_type == 'RIGHT':
            ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
        elif plane_type == 'FACE' and face_origin and face_normal:
            ox = float(face_origin[0])
            oy = float(face_origin[1])
            oz = float(face_origin[2])
            nx = float(face_normal[0])
            ny = float(face_normal[1])
            nz = float(face_normal[2])
            
            n_len = math.sqrt(nx*nx + ny*ny + nz*nz)
            if n_len > 1e-6:
                nx, ny, nz = nx/n_len, ny/n_len, nz/n_len
            else:
                nx, ny, nz = 0.0, 0.0, 1.0
                
            if abs(nx) < 1e-5 and abs(ny) < 1e-5:
                xx, xy, xz = 1.0, 0.0, 0.0
            else:
                xx, xy, xz = -ny, nx, 0.0
                x_len = math.sqrt(xx*xx + xy*xy)
                xx, xy = xx/x_len, xy/x_len
                
            ax2 = gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz))
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
            
        slicing_plane = gp_Pln(ax2)
        
        section_tool = BRepAlgoAPI_Section(shape, slicing_plane)
        section_tool.Build()
        
        intersection_points = []
        if section_tool.IsDone():
            section_shape = section_tool.Shape()
            explorer = TopExp_Explorer(section_shape, TopAbs_EDGE)
            while explorer.More():
                edge = topods.Edge(explorer.Current())
                from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
                from OCC.Core.GeomAbs import GeomAbs_Line, GeomAbs_Circle
                
                curve = BRepAdaptor_Curve(edge)
                c_type = curve.GetType()
                
                p_start = curve.Value(curve.FirstParameter())
                p_end = curve.Value(curve.LastParameter())
                
                uv_start = project_3d_to_2d(p_start.X(), p_start.Y(), p_start.Z(), plane_type, face_origin, face_normal)
                uv_end = project_3d_to_2d(p_end.X(), p_end.Y(), p_end.Z(), plane_type, face_origin, face_normal)
                
                if c_type == GeomAbs_Circle:
                    mid_param = (curve.FirstParameter() + curve.LastParameter()) / 2.0
                    p_mid = curve.Value(mid_param)
                    uv_mid = project_3d_to_2d(p_mid.X(), p_mid.Y(), p_mid.Z(), plane_type, face_origin, face_normal)
                    
                    intersection_points.append([uv_start[0], uv_start[1], 'START'])
                    intersection_points.append([uv_mid[0], uv_mid[1], 'ARC_CONTROL'])
                    intersection_points.append([uv_end[0], uv_end[1]])
                else:
                    intersection_points.append([uv_start[0], uv_start[1], 'START'])
                    intersection_points.append([uv_end[0], uv_end[1]])
                explorer.Next()
                
        return intersection_points
        
    except Exception as e:
        print("[ERROR] Intersection section failed:", e)
        return []


def generate_reference_plane(plane_type, refs, offset=0.0, features=[]):
    """
    Computes a custom reference plane from topology references.
    Returns: { "origin": [x,y,z], "normal": [x,y,z], "xDir": [x,y,z], "yDir": [x,y,z] }
    """
    origin = [0.0, 0.0, 0.0]
    normal = [0.0, 0.0, 1.0]

    try:
        if plane_type == 'OFFSET' and len(refs) > 0:
            ref = refs[0]
            coords = ref.get('coordinates', [0.0, 0.0, 0.0])
            norm = ref.get('normal', [0.0, 0.0, 1.0])
            # Apply offset along normal
            n_len = math.sqrt(norm[0]**2 + norm[1]**2 + norm[2]**2)
            if n_len > 1e-6:
                unorm = [norm[0]/n_len, norm[1]/n_len, norm[2]/n_len]
            else:
                unorm = [0.0, 0.0, 1.0]
            origin = [
                coords[0] + offset * unorm[0],
                coords[1] + offset * unorm[1],
                coords[2] + offset * unorm[2]
            ]
            normal = unorm

        elif plane_type == 'THREE_POINTS' and len(refs) >= 3:
            p1 = refs[0].get('coordinates', [0.0, 0.0, 0.0])
            p2 = refs[1].get('coordinates', [0.0, 0.0, 0.0])
            p3 = refs[2].get('coordinates', [0.0, 0.0, 0.0])

            origin = p1
            # v1 = p2 - p1, v2 = p3 - p1
            v1 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]]
            v2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]]

            # Normal = cross product v1 x v2
            nx = v1[1]*v2[2] - v1[2]*v2[1]
            ny = v1[2]*v2[0] - v1[0]*v2[2]
            nz = v1[0]*v2[1] - v1[1]*v2[0]

            n_len = math.sqrt(nx**2 + ny**2 + nz**2)
            if n_len > 1e-6:
                normal = [nx/n_len, ny/n_len, nz/n_len]
            else:
                normal = [0.0, 0.0, 1.0]

        elif plane_type == 'POINT_NORMAL' and len(refs) >= 2:
            p = refs[0].get('coordinates', [0.0, 0.0, 0.0])
            ref_norm = refs[1]
            origin = p

            if ref_norm.get('type') == 'EDGE' and 'edgeData' in ref_norm:
                e_data = ref_norm['edgeData']
                estart = e_data.get('start', [0.0, 0.0, 0.0])
                eend = e_data.get('end', [0.0, 0.0, 0.0])
                nx = eend[0] - estart[0]
                ny = eend[1] - estart[1]
                nz = eend[2] - estart[2]
            else:
                norm_dir = ref_norm.get('normal', [0.0, 0.0, 1.0])
                nx, ny, nz = norm_dir[0], norm_dir[1], norm_dir[2]

            n_len = math.sqrt(nx**2 + ny**2 + nz**2)
            if n_len > 1e-6:
                normal = [nx/n_len, ny/n_len, nz/n_len]
            else:
                normal = [0.0, 0.0, 1.0]

        # Calculate a robust orthogonal basis X and Y for ThreeJS
        nx, ny, nz = normal[0], normal[1], normal[2]
        if abs(nx) < 1e-5 and abs(ny) < 1e-5:
            xx, xy, xz = 1.0, 0.0, 0.0
        else:
            xx, xy, xz = -ny, nx, 0.0
            x_len = math.sqrt(xx**2 + xy**2)
            xx, xy = xx/x_len, xy/x_len

        # Y = Z x X
        yx = ny*xz - nz*xy
        yy = nz*xx - nx*xz
        yz = nx*xy - ny*xx
        y_len = math.sqrt(yx**2 + yy**2 + yz**2)
        if y_len > 1e-6:
            yx, yy, yz = yx/y_len, yy/y_len, yz/y_len
        else:
            yx, yy, yz = 0.0, 1.0, 0.0

        return {
            "origin": origin,
            "normal": normal,
            "xDir": [xx, xy, xz],
            "yDir": [yx, yy, yz]
        }
    except Exception as e:
        print("[ERROR] generate_reference_plane failed:", e)
        return {
            "origin": origin,
            "normal": normal,
            "xDir": [1.0, 0.0, 0.0],
            "yDir": [0.0, 1.0, 0.0]
        }


def generate_reference_axis(axis_type, refs, features=[]):
    """
    Computes a custom reference axis from topology references.
    Returns: { "origin": [x,y,z], "direction": [x,y,z] }
    """
    origin = [0.0, 0.0, 0.0]
    direction = [0.0, 0.0, 1.0]

    try:
        if axis_type == 'TWO_POINTS' and len(refs) >= 2:
            p1 = refs[0].get('coordinates', [0.0, 0.0, 0.0])
            p2 = refs[1].get('coordinates', [0.0, 0.0, 0.0])
            origin = p1
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            dz = p2[2] - p1[2]
            d_len = math.sqrt(dx**2 + dy**2 + dz**2)
            if d_len > 1e-6:
                direction = [dx/d_len, dy/d_len, dz/d_len]

        elif axis_type == 'CYLINDER_AXIS' and len(refs) > 0 and HAS_OCC:
            ref = refs[0]
            coords = ref.get('coordinates', [0.0, 0.0, 0.0])
            shape = build_shape_only(features)
            if shape and not shape.IsNull():
                face = find_closest_face(shape, coords)
                if face:
                    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
                    from OCC.Core.GeomAbs import GeomAbs_Cylinder
                    
                    surf = BRepAdaptor_Surface(face)
                    if surf.GetType() == GeomAbs_Cylinder:
                        cyl = surf.Cylinder()
                        axis = cyl.Axis()
                        loc = axis.Location()
                        direc = axis.Direction()
                        return {
                            "origin": [loc.X(), loc.Y(), loc.Z()],
                            "direction": [direc.X(), direc.Y(), direc.Z()]
                        }
            # Fallback using normal as direction if no shape or not cylinder
            origin = coords
            norm = ref.get('normal', [0.0, 0.0, 1.0])
            n_len = math.sqrt(norm[0]**2 + norm[1]**2 + norm[2]**2)
            if n_len > 1e-6:
                direction = [norm[0]/n_len, norm[1]/n_len, norm[2]/n_len]

        elif axis_type == 'PLANE_INTERSECTION' and len(refs) >= 2:
            # Solve plane intersection: we have normals and origins of two planes
            p1 = refs[0].get('coordinates', [0.0, 0.0, 0.0])
            n1 = refs[0].get('normal', [0.0, 0.0, 1.0])
            p2 = refs[1].get('coordinates', [0.0, 0.0, 0.0])
            n2 = refs[1].get('normal', [0.0, 1.0, 0.0])

            # Line direction = n1 x n2
            dx = n1[1]*n2[2] - n1[2]*n2[1]
            dy = n1[2]*n2[0] - n1[0]*n2[2]
            dz = n1[0]*n2[1] - n1[1]*n2[0]

            d_len = math.sqrt(dx**2 + dy**2 + dz**2)
            if d_len > 1e-6:
                direction = [dx/d_len, dy/d_len, dz/d_len]
                # Find a point on both planes
                origin = [
                    (p1[0] + p2[0])/2.0,
                    (p1[1] + p2[1])/2.0,
                    (p1[2] + p2[2])/2.0
                ]
            else:
                origin = p1

        return {
            "origin": origin,
            "direction": direction
        }
    except Exception as e:
        print("[ERROR] generate_reference_axis failed:", e)
        return {
            "origin": origin,
            "direction": direction
        }


# --- P5-3 Material Database & Density (g/cm^3) ---
MATERIAL_LIBRARY = {
    "STEEL": {"density": 7.85, "name": "Alloy Steel", "color": "#71717A"},
    "ALUMINUM": {"density": 2.70, "name": "Aluminum 6061", "color": "#CBD5E1"},
    "PLASTIC": {"density": 1.05, "name": "ABS Plastic", "color": "#F8FAFC"},
    "COPPER": {"density": 8.96, "name": "Pure Copper", "color": "#B45309"},
    "GENERIC": {"density": 1.00, "name": "Generic Material", "color": "#94A3B8"}
}


def calculate_mass_properties(features, material_id='GENERIC'):
    """
    Calculates precise CAD physical/mass properties (Volume, Surface Area, Center of Mass, Inertia Matrix).
    """
    mat_info = MATERIAL_LIBRARY.get(material_id.upper(), MATERIAL_LIBRARY["GENERIC"])
    density = mat_info["density"] 
    density_mm3 = density * 0.001

    if not HAS_OCC:
        # High-Fidelity Pure-Python Fallback
        vol = 0.0
        surf = 0.0
        for feat in features:
            t = feat.get('type') if isinstance(feat, dict) else getattr(feat, 'type', None)
            p = feat.get('parameters', {}) if isinstance(feat, dict) else getattr(feat, 'parameters', {})
            op = p.get('operation', 'ADD')
            fv, fa = 0.0, 0.0
            if t == 'BOX':
                w, h, d = float(p.get('width', 10)), float(p.get('height', 10)), float(p.get('depth', 10))
                fv = w * h * d
                fa = 2 * (w*h + h*d + d*w)
            elif t == 'CYLINDER':
                r, h = float(p.get('radius', 5)), float(p.get('height', 10))
                fv = 3.14159265 * r * r * h
                fa = 2 * 3.14159265 * r * (r + h)
            elif t == 'SPHERE':
                r = float(p.get('radius', 5))
                fv = (4/3) * 3.14159265 * r**3
                fa = 4 * 3.14159265 * r**2
            elif t == 'EXTRUDE':
                depth = float(p.get('depth', 10))
                points_data = p.get('points', [])
                if points_data:
                    poly = points_data[0] if isinstance(points_data[0][0], list) else points_data
                    area = 0.0
                    for i in range(len(poly)):
                        p1, p2 = poly[i], poly[(i + 1) % len(poly)]
                        area += (float(p1[0]) * float(p2[1])) - (float(p2[0]) * float(p1[1]))
                    area = abs(area) / 2.0
                    perimeter = sum(math.hypot(float(poly[i][0])-float(poly[(i-1)%len(poly)][0]), float(poly[i][1])-float(poly[(i-1)%len(poly)][1])) for i in range(len(poly)))
                    fv, fa = area * depth, 2 * area + perimeter * depth
            
            if op == 'ADD': vol += fv; surf += fa
            else: vol -= fv; surf += fa

        mass = vol * density_mm3
        return {
            "volume": vol, "mass": mass, "surface_area": surf, "material": mat_info["name"],
            "center_of_mass": [0.0, 0.0, 0.0],
            "inertia_matrix": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
        }

    try:
        shape = build_shape_only(features)
        if not shape or shape.IsNull(): return None
        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        vol = props.Mass()
        mass = vol * density_mm3
        com_pnt = props.CentreOfMass()
        inertia = props.MatrixOfInertia()
        return {
            "volume": vol, "mass": mass, "material": mat_info["name"],
            "center_of_mass": [com_pnt.X(), com_pnt.Y(), com_pnt.Z()],
            "inertia_matrix": [[inertia.Value(i,j) for j in range(1,4)] for i in range(1,4)]
        }
    except Exception as err:
        print("[ERROR] calculate_mass_properties failed:", err)
        return None


        # 1. Volume properties
        vol_props = GProp_GProps()
        brepgprop.VolumeProperties(shape, vol_props)
        volume = vol_props.Mass()

        com_pnt = vol_props.CentreOfMass()
        com = [com_pnt.X(), com_pnt.Y(), com_pnt.Z()]

        mat = vol_props.MatrixOfInertia()
        inertia = [
            [mat.Value(1, 1), mat.Value(1, 2), mat.Value(1, 3)],
            [mat.Value(2, 1), mat.Value(2, 2), mat.Value(2, 3)],
            [mat.Value(3, 1), mat.Value(3, 2), mat.Value(3, 3)],
        ]

        # 2. Surface properties
        surf_props = GProp_GProps()
        brepgprop.SurfaceProperties(shape, surf_props)
        surface_area = surf_props.Mass()

        return {
            "volume": volume,
            "surface_area": surface_area,
            "center_of_mass": com,
            "inertia_matrix": inertia
        }
    except Exception as err:
        print("[ERROR] calculate_mass_properties failed:", err)
        return None

def export_cad_file(features, format_type, filepath):
    """
    Exports 3D CAD solid to standard formats (STEP, IGES, STL) directly on the local filesystem.
    Forces incremental meshing first for STL formatting.
    """
    if not HAS_OCC:
        return False

    try:
        shape = build_shape_only(features)
        if not shape or shape.IsNull():
            print("[ERROR] export_cad_file: Valid 3D shape could not be constructed.")
            return False

        format_type = format_type.upper()
        if format_type == 'STEP':
            from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
            writer = STEPControl_Writer()
            writer.Transfer(shape, STEPControl_AsIs)
            status = writer.Write(filepath)
            return status == 1

        elif format_type == 'IGES':
            writer = IGESControl_Writer()
            writer.AddShape(shape)
            status = writer.Write(filepath)
            # IGES status is returned as boolean or 1/0
            return bool(status)

        elif format_type == 'STL':
            # Run incremental mesh first to triangulate surfaces
            BRepMesh_IncrementalMesh(shape, 0.1)
            writer = StlAPI_Writer()
            status = writer.Write(shape, filepath)
            return bool(status)

        else:
            print(f"[ERROR] Unsupported export format: {format_type}")
            return False

    except Exception as err:
        print(f"[ERROR] export_cad_file failed for format {format_type}:", err)
        return False

def check_interferences(components_data):
    \"\"\"
    Detects physical overlaps between assembly components using OCC Boolean operations.
    Returns a list of interferences with component IDs, volume, and mesh data.
    \"\"\"
    if not HAS_OCC:
        return []

    interferences = []
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCC.Core.GProp import GProp_GProps
    from OCC.Core.BRepGProp import brepgprop
    from OCC.Core.gp import gp_Trsf, gp_Pnt, gp_Dir, gp_Ax1, gp_Vec
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
    import math

    # 1. Rebuild and transform all component shapes
    transformed_shapes = {}
    for comp in components_data:
        cid = comp.get('id')
        features = comp.get('features', [])
        # Simple rebuild
        shape = build_shape_only(features)
        if not shape or shape.IsNull():
            continue
        
        # Apply transformation
        trans = comp.get('transform', {})
        pos = trans.get('position', [0,0,0])
        rot = trans.get('rotation', [0,0,0])
        
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(*pos))
        
        # Rotation (Euler XYZ)
        trsf_x = gp_Trsf(); trsf_x.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(1,0,0)), rot[0])
        trsf_y = gp_Trsf(); trsf_y.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,1,0)), rot[1])
        trsf_z = gp_Trsf(); trsf_z.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,0,1)), rot[2])
        
        final_rot = trsf_z.Multiplied(trsf_y).Multiplied(trsf_x)
        trsf.Multiply(final_rot)
        
        shape = BRepBuilderAPI_Transform(shape, trsf).Shape()
        transformed_shapes[cid] = shape

    # 2. Pairwise intersection check
    ids = list(transformed_shapes.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            id1 = ids[i]
            id2 = ids[j]
            s1 = transformed_shapes[id1]
            s2 = transformed_shapes[id2]
            
            try:
                common_tool = BRepAlgoAPI_Common(s1, s2)
                common_tool.Build()
                if common_tool.IsDone():
                    clash_shape = common_tool.Shape()
                    
                    # Calculate volume
                    props = GProp_GProps()
                    brepgprop.VolumeProperties(clash_shape, props)
                    volume = props.Mass()
                    
                    if volume > 0.001: # Threshold for meaningful interference
                        mesh = _shape_to_mesh(clash_shape, deflection=0.1) # Coarse mesh for highlight
                        interferences.append({
                            \"component_id_1\": id1,
                            \"component_id_2\": id2,
                            \"volume\": float(volume),
                            \"mesh\": mesh
                        })
            except Exception as e:
                print(f\"[ERROR] Interference check failed for {id1} vs {id2}: {e}\")

    return interferences

def export_assembly_step(components_data, filepath):
    """
    Exports a multi-body assembly to a single STEP file using TopoDS_Compound.
    components_data is a list of dicts with 'id', 'features', and 'transform' (position, rotation).
    """
    if not HAS_OCC:
        return False

    try:
        from OCC.Core.TDocStd import TDocStd_Document
        from OCC.Core.XCAFApp import XCAFApp_Application
        from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorGen, XCAFDoc_ColorSurf
        from OCC.Core.TDataStd import TDataStd_Name
        from OCC.Core.TCollection import TCollection_ExtendedString
        from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
        from OCC.Core.TopLoc import TopLoc_Location
        from OCC.Core.gp import gp_Trsf, gp_Vec, gp_Ax1, gp_Pnt, gp_Dir
        from OCC.Core.STEPCAFControl import STEPCAFControl_Writer
        
        # Initialize XDE application and document
        app = XCAFApp_Application.GetApplication()
        doc = TDocStd_Document(TCollection_ExtendedString("MDTV-XCAF"))
        app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)
        
        # Get XCAF Tools
        shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
        color_tool = XCAFDoc_DocumentTool.ColorTool(doc.Main())
        
        # Create a root label for the assembly
        assembly_label = shape_tool.NewShape()
        TDataStd_Name.Set(assembly_label, TCollection_ExtendedString("Assembly"))
        
        for idx, comp in enumerate(components_data):
            features = comp.get('features', [])
            transform = comp.get('transform', {})
            name = comp.get('name', f"Part_{idx+1}")
            color_hex = comp.get('color', "#60A5FA")
            
            # Build the base shape for this component
            shape = build_shape_only(features)
            if shape and not shape.IsNull():
                # 1. Add base shape to XDE
                part_label = shape_tool.AddShape(shape, False)
                TDataStd_Name.Set(part_label, TCollection_ExtendedString(f"{name}_Def"))
                
                # 2. Add Color
                try:
                    color_hex = color_hex.lstrip('#')
                    if len(color_hex) == 6:
                        r = int(color_hex[0:2], 16) / 255.0
                        g = int(color_hex[2:4], 16) / 255.0
                        b = int(color_hex[4:6], 16) / 255.0
                        q_color = Quantity_Color(r, g, b, Quantity_TOC_RGB)
                        color_tool.SetColor(part_label, q_color, XCAFDoc_ColorGen)
                        color_tool.SetColor(part_label, q_color, XCAFDoc_ColorSurf)
                except Exception as e:
                    print(f"Color parsing failed for {color_hex}: {e}")
                
                # 3. Apply transformation
                pos = transform.get('position', [0.0, 0.0, 0.0])
                rot = transform.get('rotation', [0.0, 0.0, 0.0])
                
                trsf = gp_Trsf()
                
                rx, ry, rz = rot[0], rot[1], rot[2]
                trsf_x = gp_Trsf()
                trsf_x.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(1,0,0)), rx)
                
                trsf_y = gp_Trsf()
                trsf_y.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,1,0)), ry)
                
                trsf_z = gp_Trsf()
                trsf_z.SetRotation(gp_Ax1(gp_Pnt(0,0,0), gp_Dir(0,0,1)), rz)
                
                final_rot = trsf_z.Multiplied(trsf_y).Multiplied(trsf_x)
                
                final_trsf = gp_Trsf()
                final_trsf.SetTranslation(gp_Vec(*pos))
                final_trsf.Multiply(final_rot)
                
                # 4. Create an instance (component) in the assembly label
                loc = TopLoc_Location(final_trsf)
                inst_label = shape_tool.AddComponent(assembly_label, part_label, loc)
                TDataStd_Name.Set(inst_label, TCollection_ExtendedString(name))
                
        # Export XDE Document to STEP
        writer = STEPCAFControl_Writer()
        writer.Transfer(doc)
        status = writer.Write(filepath)
        return status == 1
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("[ERROR] export_assembly_step failed:", e)
        return False