import { solveConstraints } from '../../src/utils/geometry/ConstraintSolver';
import { SketchNode, SketchEdge, SketchConstraint } from '../../src/store/useCadStore';

function testArcCondition() {
  const nodes: Record<string, SketchNode> = {
    n1: { id: 'n1', x: 0, y: 0, isFixed: true }, // Circle center
    n2: { id: 'n2', x: 10, y: 0, isFixed: true }, // Circle rim (r=10)
    n3: { id: 'n3', x: 30, y: 0, isFixed: false } // Target node
  };

  const edges: Record<string, SketchEdge> = {
    e1: { id: 'e1', type: 'CIRCLE', nodeIds: ['n1', 'n2'] }
  };

  const constraintsMin: Record<string, SketchConstraint> = {
    c1: {
      id: 'c1',
      type: 'DISTANCE',
      nodeIds: ['n3'],
      edgeIds: ['e1'],
      value: 5, // distance to MIN should be 5
      arcCondition: 'MIN'
    }
  };

  console.log('Testing MIN condition (target=5)...');
  const resultMin = solveConstraints(nodes, edges, constraintsMin, 20);
  console.log(`Node 3 position (expect x=15): ${resultMin.n3.x.toFixed(2)}`);

  const constraintsMax: Record<string, SketchConstraint> = {
    c1: {
      id: 'c1',
      type: 'DISTANCE',
      nodeIds: ['n3'],
      edgeIds: ['e1'],
      value: 50, // distance to MAX should be 50
      arcCondition: 'MAX'
    }
  };

  console.log('Testing MAX condition (target=50)...');
  const resultMax = solveConstraints(nodes, edges, constraintsMax, 20);
  console.log(`Node 3 position (expect x=40): ${resultMax.n3.x.toFixed(2)}`);
}

testArcCondition();
