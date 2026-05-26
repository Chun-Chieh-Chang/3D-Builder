import { HeavyEngineClient, CADFeature } from './HeavyEngineClient';

export class DocumentManager {
  private features: CADFeature[] = [];
  private engine: HeavyEngineClient;

  constructor() {
    this.engine = HeavyEngineClient.getInstance();
  }

  /**
   * Adds a new feature to the design tree and triggers a rebuild.
   */
  public async addFeature(feature: CADFeature) {
    this.features.push(feature);
    return await this.rebuild();
  }

  /**
   * Updates an existing feature and triggers a rebuild.
   */
  public async updateFeature(id: string, parameters: any) {
    const feature = this.features.find(f => f.id === id);
    if (feature) {
      feature.parameters = { ...feature.parameters, ...parameters };
      return await this.rebuild();
    }
    return null;
  }

  /**
   * The "Rebuild" process (Sequential Feature Processing)
   * Now delegates to the Python Heavy Engine for the entire assembly.
   */
  public async rebuild() {
    console.log('[DocumentManager] Requesting rebuild from Heavy Engine for', this.features.length, 'features');
    
    if (this.features.length === 0) return [];
    
    try {
      return await this.engine.rebuild(this.features);
    } catch (error) {
      console.error('[DocumentManager] Rebuild failed:', error);
      return null;
    }
  }

  public getFeatures() {
    return this.features;
  }

  public setFeatures(features: CADFeature[]) {
    this.features = features;
  }
}

