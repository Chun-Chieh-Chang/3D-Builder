import math
import sys
import os

# Mocking the behavior of current TrimTool.ts
# In the current implementation, Trim deletes the entire edge if clicked.

class MockSketchState:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
    
    def add_node(self, id, x, y):
        self.nodes[id] = {'x': x, 'y': y}
    
    def add_edge(self, id, node_ids, type='LINE'):
        self.edges[id] = {'node_ids': node_ids, 'type': type}

    def trim_click(self, edge_id):
        # Current behavior: delete entire edge
        if edge_id in self.edges:
            print(f"[TRIM] Deleting entire edge {edge_id}")
            del self.edges[edge_id]

def test_trim_intersection_failure():
    print("[START] Testing current Trim behavior (Intersection Splitting)...")
    state = MockSketchState()
    
    # Create two intersecting lines
    # Line 1: (0, 50) to (100, 50) - Horizontal
    state.add_node('n1', 0, 50)
    state.add_node('n2', 100, 50)
    state.add_edge('e1', ['n1', 'n2'])
    
    # Line 2: (50, 0) to (50, 100) - Vertical
    state.add_node('n3', 50, 0)
    state.add_node('n4', 50, 100)
    state.add_edge('e2', ['n3', 'n4'])
    
    # Simulate trimming Line 1 on the left side of the intersection
    # Intersection is at (50, 50)
    # Target behavior (SolidWorks): e1 should be split at (50, 50), and only the left half deleted.
    # Current behavior: e1 is deleted entirely.
    
    print("Pre-trim edges count:", len(state.edges))
    state.trim_click('e1')
    print("Post-trim edges count:", len(state.edges))
    
    if len(state.edges) == 1:
        print("[FAILURE] Trim deleted the entire edge instead of splitting at intersection.")
    else:
        print("[SUCCESS] Trim logic supports splitting (not expected in current version).")

if __name__ == "__main__":
    test_trim_intersection_failure()
