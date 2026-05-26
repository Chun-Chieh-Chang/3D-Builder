from app.services import solver_service
import json

nodes = {
    "n1": {"id": "n1", "x": 0, "y": 0, "isFixed": True},
    "n2": {"id": "n2", "x": 8, "y": 2}
}
edges = {
    "e1": {"id": "e1", "type": "LINE", "nodeIds": ["n1", "n2"]}
}
constraints = {
    "c1": {"id": "c1", "type": "HORIZONTAL", "edgeIds": ["e1"]},
    "c2": {"id": "c2", "type": "DISTANCE", "edgeIds": ["e1"], "value": 10.0}
}

solved, report = solver_service.solve_sketch_constraints(nodes, edges, constraints)
print(f"Report: {report}")
print(f"Solved n2: {solved['n2']}")
