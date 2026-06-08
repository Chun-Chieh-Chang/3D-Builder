import { solveConstraints } from '../../src/utils/geometry/ConstraintSolver';
import { SketchNode, SketchEdge, SketchConstraint } from '../../src/store/useCadStore';

/**
 * Verification for Line-to-Circle Distance with Arc Conditions
 */
function testLineToCircle() {
  console.log('--- Starting Line-to-Circle Distance Test ---');

  // 1. Setup: Circle at (0,0) with radius 10
  // Line segment from (30, -10) to (30, 10) - a vertical line at x=30
  const nodes: Record<string, SketchNode> = {
    c_center: { id: 'c_center', x: 0, y: 0, isFixed: true },
    c_rim:    { id: 'c_rim', x: 10, y: 0, isFixed: true },
    l_p1:     { id: 'l_p1', x: 30, y: -10, isFixed: false },
    l_p2:     { id: 'l_p2', x: 30, y: 10, isFixed: false }
  };

  const edges: Record<string, SketchEdge> = {
    circle: { id: 'circle', type: 'CIRCLE', nodeIds: ['c_center', 'c_rim'] },
    line:   { id: 'line',   type: 'LINE',   nodeIds: ['l_p1', 'l_p2'] }
  };

  // Test Case 1: MIN condition
  // Vertical line at x=30, Circle center at (0,0), radius 10.
  // Distance to MIN (edge) is 30 - 10 = 20.
  // If we set DISTANCE constraint to 5 (MIN), line should move to x=15.
  const constraintsMin: Record<string, SketchConstraint> = {
    c1: {
      id: 'c1',
      type: 'DISTANCE',
      edgeIds: ['line', 'circle'],
      value: 5,
      arcCondition: 'MIN'
    }
  };

  console.log('Testing MIN condition: Line should move to x=15 (radius=10, dist=5)...');
  const resultMin = solveConstraints(nodes, edges, constraintsMin, 100);
  console.log(`Line P1 x: ${resultMin.l_p1.x.toFixed(2)} (Expected 15.00)`);
  console.log(`Line P2 x: ${resultMin.l_p2.x.toFixed(2)} (Expected 15.00)`);

  // Test Case 2: MAX condition
  // If we set DISTANCE constraint to 50 (MAX), line should move to x=40 (radius=10).
  const constraintsMax: Record<string, SketchConstraint> = {
    c1: {
      id: 'c1',
      type: 'DISTANCE',
      edgeIds: ['line', 'circle'],
      value: 50,
      arcCondition: 'MAX'
    }
  };

  console.log('\nTesting MAX condition: Line should move to x=40 (radius=10, dist=50)...');
  const resultMax = solveConstraints(nodes, edges, constraintsMax, 100);
  console.log(`Line P1 x: ${resultMax.l_p1.x.toFixed(2)} (Expected 40.00)`);
  console.log(`Line P2 x: ${resultMax.l_p2.x.toFixed(2)} (Expected 40.00)`);

  // Test Case 3: CENTER condition
  // If we set DISTANCE constraint to 10 (CENTER), line should move to x=10.
  const constraintsCenter: Record<string, SketchConstraint> = {
    c1: {
      id: 'c1',
      type: 'DISTANCE',
      edgeIds: ['line', 'circle'],
      value: 10,
      arcCondition: 'CENTER'
    }
  };

  console.log('\nTesting CENTER condition: Line should move to x=10 (dist=10)...');
  const resultCenter = solveConstraints(nodes, edges, constraintsCenter, 100);
  console.log(`Line P1 x: ${resultCenter.l_p1.x.toFixed(2)} (Expected 10.00)`);
  console.log(`Line P2 x: ${resultCenter.l_p2.x.toFixed(2)} (Expected 10.00)`);
}

testLineToCircle();
