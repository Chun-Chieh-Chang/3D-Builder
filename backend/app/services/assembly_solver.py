import numpy as np
from scipy.optimize import least_squares
import math
import json

def solve_assembly_mates(components_dict, mates_list):
    """
    3D Rigid Body Constraint Solver for Assemblies.
    """
    comp_ids = sorted(components_dict.keys())
    # Component status check
    variable_comps = [cid for cid in comp_ids if not components_dict[cid].get('isFixed', False)]
    comp_to_idx = {cid: i for i, cid in enumerate(variable_comps)}
    
    x0 = []
    for cid in variable_comps:
        c = components_dict[cid]
        t = c.get('transform', {})
        pos = t.get('position', [0, 0, 0])
        rot = t.get('rotation', [0, 0, 0])
        x0.extend(pos)
        x0.extend(rot)
    
    x0 = np.array(x0, dtype=float)
    if len(x0) == 0:
        return components_dict, {"status": "ALL_FIXED", "residual": 0}

    def get_rotation_matrix(rx, ry, rz):
        cx, sx = math.cos(rx), math.sin(rx)
        cy, sy = math.cos(ry), math.sin(ry)
        cz, sz = math.cos(rz), math.sin(rz)
        return np.array([
            [cy*cz, sz*cy, -sy],
            [cz*sx*sy - sz*cx, sx*sy*sz + cz*cx, cy*sx],
            [cz*cx*sy + sz*sx, cx*sy*sz - cz*sx, cy*cx]
        ])

    def residual_func(x_vars):
        residuals = []
        for m in mates_list:
            m_type = m.get('type')
            ent1 = m.get('entity1', {})
            ent2 = m.get('entity2', {})
            params = m.get('parameters', {})
            offset = float(params.get('offset', 0))
            
            def get_world_geom(ent):
                cid = ent.get('componentId')
                lo = ent.get('localOrigin', [0,0,0])
                ln = ent.get('localNormal', [0,0,1])
                if cid in comp_to_idx:
                    idx = comp_to_idx[cid]
                    v = x_vars[idx*6 : idx*6+6]
                    R = get_rotation_matrix(*v[3:])
                    w_pos = R @ np.array(lo) + np.array(v[:3])
                    w_norm = R @ np.array(ln)
                else:
                    c = components_dict[cid]
                    pos = c['transform']['position']
                    rot = c['transform']['rotation']
                    R = get_rotation_matrix(*rot)
                    w_pos = R @ np.array(lo) + np.array(pos)
                    w_norm = R @ np.array(ln)
                return w_pos, w_norm

            p1, n1 = get_world_geom(ent1)
            p2, n2 = get_world_geom(ent2)

            if m_type == 'COINCIDENT':
                # Orientations match (anti-parallel)
                residuals.extend(np.cross(n1, n2))
                # Position matches (project onto normal)
                residuals.append(np.dot(p2 - p1, n1) - offset)
            elif m_type == 'CONCENTRIC':
                dist_vec = p2 - p1
                residuals.extend(dist_vec - np.dot(dist_vec, n1) * n1)
                residuals.extend(np.cross(n1, n2))
            elif m_type == 'DISTANCE':
                residuals.append(np.linalg.norm(p2 - p1) - offset)
        
        # Soft spring
        for i, cid in enumerate(variable_comps):
            orig = components_dict[cid]['transform']
            residuals.extend((x_vars[i*6:i*6+3] - np.array(orig['position'])) * 0.001)
            residuals.extend((x_vars[i*6+3:i*6+6] - np.array(orig['rotation'])) * 0.001)
            
        return np.array(residuals)

    res = least_squares(residual_func, x0, method='lm')
    solved_components = json.loads(json.dumps(components_dict))
    for i, cid in enumerate(variable_comps):
        v = res.x[i*6 : i*6+6]
        solved_components[cid]['transform']['position'] = [float(v[0]), float(v[1]), float(v[2])]
        solved_components[cid]['transform']['rotation'] = [float(v[3]), float(v[4]), float(v[5])]
    return solved_components, {"status": "SOLVED" if res.success else "FAILED", "residual": float(np.sum(res.fun**2))}
