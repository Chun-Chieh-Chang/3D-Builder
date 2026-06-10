import { useCadStore, CADFeature } from '../../src/store/useCadStore';

// Mock localStorage for Zustand persist middleware
if (typeof global.localStorage === 'undefined') {
  (global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  };
}

/**
 * Verification for Feature Reordering Logic (SolidWorks Index 61 Parity)
 */
function testFeatureReordering() {
  console.log('--- Starting Feature Reordering Test ---');

  // 1. Initial State: Empty features
  useCadStore.setState({ features: [] });

  const feat1: CADFeature = { id: 'f1', name: 'Vertical Fillet', type: 'FILLET', parameters: {}, isSuppressed: false };
  const feat2: CADFeature = { id: 'f2', name: 'Horizontal Fillet', type: 'FILLET', parameters: {}, isSuppressed: false };
  const feat3: CADFeature = { id: 'f3', name: 'Shell', type: 'DUMB_SOLID', parameters: {}, isSuppressed: false };

  useCadStore.setState({ features: [feat1, feat2, feat3] });
  console.log('Initial Order:', useCadStore.getState().features.map(f => f.name).join(' -> '));

  // 2. Perform Reordering: Move feat3 (Shell) to the top (index 0)
  // reorderFeatures(oldIndex, newIndex)
  const { reorderFeatures } = useCadStore.getState();
  reorderFeatures(2, 0);

  let updatedFeatures = useCadStore.getState().features;
  console.log('Order after moving Shell to top:', updatedFeatures.map(f => f.name).join(' -> '));

  if (updatedFeatures[0].id === 'f3' && updatedFeatures[1].id === 'f1') {
    console.log('✅ Reordering Successful: Shell is now first.');
  } else {
    console.log('❌ Reordering Failed.');
  }

  // 3. Reverse Order: Vertical Fillet after Horizontal Fillet
  // feat1 is at index 1, feat2 is at index 2
  reorderFeatures(1, 2);
  updatedFeatures = useCadStore.getState().features;
  console.log('Order after swapping Fillets:', updatedFeatures.map(f => f.name).join(' -> '));

  if (updatedFeatures[1].id === 'f2' && updatedFeatures[2].id === 'f1') {
    console.log('✅ Fillet Swapping Successful.');
  } else {
    console.log('❌ Fillet Swapping Failed.');
  }
}

testFeatureReordering();
