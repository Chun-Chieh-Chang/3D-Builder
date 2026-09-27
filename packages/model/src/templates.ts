import { countersFor } from './ids';
import { SCHEMA_VERSION, SKETCH_ORIGIN, type PartDoc } from './schema';
import { idsInUse } from './sketch-rules';

export function createEmptyPart(): PartDoc {
  return {
    kind: 'part',
    schemaVersion: SCHEMA_VERSION,
    displayUnits: { length: 'mm', angle: 'deg' },
    variables: [],
    features: [],
    rollbackIndex: null,
    properties: {},
    appearances: [],
    blobs: [],
    idCounters: {},
  };
}

/**
 * Phase 0 walking-skeleton part: a fully defined rectangle on the Top plane,
 * extruded, with one edge filleted. The fillet references its edge by persistent name only.
 */
export function createDemoPart(): PartDoc {
  const doc = createEmptyPart();
  doc.properties = { 零件名稱: '行走骨架示範件' };
  doc.features = [
    {
      id: 'sketch1',
      type: 'sketch',
      name: '草圖1',
      suppressed: false,
      plane: { kind: 'datum', name: 'plane:top' },
      entities: [
        { id: 'p1', type: 'point', x: 0, y: 0 },
        { id: 'p2', type: 'point', x: 20, y: 0 },
        { id: 'p3', type: 'point', x: 20, y: 10 },
        { id: 'p4', type: 'point', x: 0, y: 10 },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' },
        { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' },
        { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' },
      ],
      constraints: [
        { id: 'c1', type: 'coincident', a: 'p1', b: SKETCH_ORIGIN },
        { id: 'c2', type: 'horizontal', a: 'l1' },
        { id: 'c3', type: 'horizontal', a: 'l3' },
        { id: 'c4', type: 'vertical', a: 'l2' },
        { id: 'c5', type: 'vertical', a: 'l4' },
        { id: 'd1', type: 'distance', a: 'l1', value: '20', label: '寬度' },
        { id: 'd2', type: 'distance', a: 'l2', value: '10', label: '高度' },
      ],
    },
    {
      id: 'extrude1',
      type: 'extrude',
      name: '伸長1',
      suppressed: false,
      sketch: 'sketch1',
      op: 'boss',
      dir1: { type: 'blind', depth: '5' },
    },
    {
      id: 'fillet1',
      type: 'fillet',
      name: '圓角1',
      suppressed: false,
      radius: '2',
      edges: [
        {
          kind: 'edge',
          name: '{extrude1:cap:end|extrude1:side:sketch1.l2}',
          fingerprint: { type: 'line', size: 10, center: [20, 5, -5], dir: [0, 0, -1] },
        },
      ],
    },
  ];
  doc.idCounters = countersFor(idsInUse(doc));
  return doc;
}
