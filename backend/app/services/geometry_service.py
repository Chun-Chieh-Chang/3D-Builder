import math

try:
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_EDGE, TopAbs_VERTEX
    from OCC.Core.BRep import BRep_Tool
    from OCC.Core.gp import gp_Trsf, gp_Vec, gp_Pnt, gp_Dir, gp_Ax2, gp_Ax3, gp_Ax1
    from OCC.Core.TopLoc import TopLoc_Location
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
    from OCC.Core.GC import GC_MakeArcOfCircle
    from OCC.Core.TopoDS import topods
    from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet, BRepFilletAPI_MakeChamfer
    HAS_OCC = True
except ImportError:
    HAS_OCC = False


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

def find_matching_edge(shape, target_start, target_end):
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
        
    if min_dist < 5.0:
        return best_edge
    return None

def process_features(features):
    """
    The Core CAD Kernel: Processes a sequence of parametric features to build a B-Rep model.
    Implements the 'Sketch -> Extrude' workflow with Datum Plane support.
    Supports BOX, CYLINDER, SPHERE, and EXTRUDE features.
    """
    if not HAS_OCC:
        return {"type": "mesh", "data": generate_mock_mesh(features)}

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
        
        if f_type == 'FILLET':
            if final_shape is not None:
                radius = float(params.get('radius', 2.0))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end)
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

        elif f_type == 'CHAMFER':
            if final_shape is not None:
                distance = float(params.get('distance', 1.5))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end)
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

        if f_type == 'SKETCH_POLYLINE' or f_type == 'EXTRUDE':
            # Support both explicit Sketch and the unified Extrude
            plane_type = params.get('plane', 'FRONT')
            depth = float(params.get('depth', 10.0))
            points_2d = params.get('points', []) # Expected list of [u, v]
            
            # Robust pre-processing: filter out consecutive duplicate points (Zero-Length Edge Prevention)
            filtered_points = []
            for pt in points_2d:
                if not pt:
                    continue
                if not filtered_points:
                    filtered_points.append(pt)
                else:
                    prev = filtered_points[-1]
                    dist = math.hypot(float(pt[0]) - float(prev[0]), float(pt[1]) - float(prev[1]))
                    if dist > 1e-4:
                        filtered_points.append(pt)
            
            # Remove trailing point if it duplicates the start point
            if len(filtered_points) > 1:
                first = filtered_points[0]
                last = filtered_points[-1]
                dist = math.hypot(float(first[0]) - float(last[0]), float(first[1]) - float(last[1]))
                if dist < 1e-4:
                    filtered_points.pop()
            
            points_2d = filtered_points

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

            try:
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
            except Exception as sketch_err:
                print(f"[ERROR] Failed to construct sketch/prism wire: {sketch_err}")
                current_feat_shape = None

        elif f_type == 'REVOLVE':
            plane_type = params.get('plane', 'FRONT')
            angle = float(params.get('angle', 360.0)) * math.pi / 180.0
            points_2d = params.get('points', [])
            
            filtered_points = []
            for pt in points_2d:
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
            
            points_2d = filtered_points

            if not points_2d or len(points_2d) < 3:
                # Default half bottle sketch profile
                points_2d = [
                    [0, 0], [15, 0], [17.5, 10], [13.0, 35], [17.5, 60], [8.5, 85], [8.5, 120], [0, 120]
                ]

            x_origin = float(params.get('x', 0.0))
            y_origin = float(params.get('y', 0.0))
            z_origin = float(params.get('z', 0.0))

            if plane_type == 'FRONT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0))
            elif plane_type == 'TOP':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0))
            elif plane_type == 'RIGHT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
            else:
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0))

            try:
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
                    
                    if len(p_next) > 2 and p_next[2] == 'ARC_CONTROL':
                        p_control = p_next
                        p_end = points_2d[(i + 2) % n_points]
                        
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

                wire = make_wire.Wire()
                face = BRepBuilderAPI_MakeFace(wire).Face()

                trsf = gp_Trsf()
                trsf.SetTransformation(gp_Ax3(ax2))
                face.Move(TopLoc_Location(trsf))
                ax1.Transform(trsf)
                
                current_feat_shape = BRepPrimAPI_MakeRevol(face, ax1, angle).Shape()
            except Exception as e:
                print(f"[ERROR] Revolve failed inside process_features: {e}")
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

def build_shape_only(features):
    """Processes features and returns the raw OCCT TopoDS_Shape."""
    final_shape = None
    
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
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end)
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

        elif f_type == 'CHAMFER':
            if final_shape is not None:
                distance = float(params.get('distance', 1.5))
                edge_start = params.get('edge_start')
                edge_end = params.get('edge_end')
                if edge_start and edge_end:
                    matched_edge = find_matching_edge(final_shape, edge_start, edge_end)
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

        if f_type == 'SKETCH_POLYLINE' or f_type == 'EXTRUDE':
            plane_type = params.get('plane', 'FRONT')
            depth = float(params.get('depth', 10.0))
            points_2d = params.get('points', [])
            
            filtered_points = []
            for pt in points_2d:
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
            
            points_2d = filtered_points

            if not points_2d or len(points_2d) < 3:
                w = float(params.get('width', 10.0))
                h = float(params.get('height', 10.0))
                points_2d = [[0, 0], [w, 0], [w, h], [0, h]]

            x_origin = float(params.get('x', 0.0))
            y_origin = float(params.get('y', 0.0))
            z_origin = float(params.get('z', 0.0))

            if plane_type == 'FRONT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
                vec = gp_Vec(0, 0, depth)
            elif plane_type == 'TOP':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
                vec = gp_Vec(0, depth, 0)
            elif plane_type == 'RIGHT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
                vec = gp_Vec(depth, 0, 0)
            else:
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
                vec = gp_Vec(0, 0, depth)

            try:
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
                    
                    if len(p_next) > 2 and p_next[2] == 'ARC_CONTROL':
                        p_control = p_next
                        p_end = points_2d[(i + 2) % n_points]
                        
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

                wire = make_wire.Wire()
                face = BRepBuilderAPI_MakeFace(wire).Face()

                trsf = gp_Trsf()
                trsf.SetTransformation(gp_Ax3(ax2))
                face.Move(TopLoc_Location(trsf))
                vec.Transform(trsf)
                
                current_feat_shape = BRepPrimAPI_MakePrism(face, vec).Shape()
            except Exception:
                current_feat_shape = None

        elif f_type == 'REVOLVE':
            plane_type = params.get('plane', 'FRONT')
            angle = float(params.get('angle', 360.0)) * math.pi / 180.0
            points_2d = params.get('points', [])
            
            filtered_points = []
            for pt in points_2d:
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
            
            points_2d = filtered_points

            if not points_2d or len(points_2d) < 3:
                points_2d = [
                    [0, 0], [15, 0], [17.5, 10], [13.0, 35], [17.5, 60], [8.5, 85], [8.5, 120], [0, 120]
                ]

            x_origin = float(params.get('x', 0.0))
            y_origin = float(params.get('y', 0.0))
            z_origin = float(params.get('z', 0.0))

            if plane_type == 'FRONT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0))
            elif plane_type == 'TOP':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0))
            elif plane_type == 'RIGHT':
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
            else:
                ax2 = gp_Ax2(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 0, 1))
                ax1 = gp_Ax1(gp_Pnt(x_origin, y_origin, z_origin), gp_Dir(0, 1, 0))

            try:
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
                    
                    if len(p_next) > 2 and p_next[2] == 'ARC_CONTROL':
                        p_control = p_next
                        p_end = points_2d[(i + 2) % n_points]
                        
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

                wire = make_wire.Wire()
                face = BRepBuilderAPI_MakeFace(wire).Face()

                trsf = gp_Trsf()
                trsf.SetTransformation(gp_Ax3(ax2))
                face.Move(TopLoc_Location(trsf))
                ax1.Transform(trsf)
                
                current_feat_shape = BRepPrimAPI_MakeRevol(face, ax1, angle).Shape()
            except Exception as e:
                print(f"[ERROR] Revolve failed inside build_shape_only: {e}")
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



