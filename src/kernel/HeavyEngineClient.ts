export interface FaceMetadata {
  id: string;
  area: number;
  v_count: number;
  curvature?: string;
  index_range: [number, number];
}

export interface MeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  face_metadata?: FaceMetadata[];
}

export interface CADFeature {
  id: string;
  type: string;
  parameters: any;
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
}

export class HeavyEngineClient {
  private static instance: HeavyEngineClient;
  private baseUrl: string = 'http://localhost:8400/api/v1/geometry';

  private constructor() {}

  public static getInstance(): HeavyEngineClient {
    if (!HeavyEngineClient.instance) {
      HeavyEngineClient.instance = new HeavyEngineClient();
    }
    return HeavyEngineClient.instance;
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/../health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Request physical measurements (Area, Volume) from the heavy engine.
   * Maps to calculate_properties in backend.
   */
  public async measure(features: CADFeature[]): Promise<{ area: number; volume: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/measure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ features }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to measure assembly:', error);
      throw error;
    }
  }

  public async rebuild(features: CADFeature[], deflection: number = 0.01): Promise<MeshData[]> {
    try {
      const response = await fetch(`${this.baseUrl}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, deflection }),
      });
      if (!response.ok) throw new Error('Rebuild failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Rebuild error:', error);
      return [];
    }
  }

  public async calculateMassProperties(features: CADFeature[], materialId: string = "GENERIC"): Promise<any> {  
    try {
      const response = await fetch(`${this.baseUrl}/mass_properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, materialId }),
      });
      if (!response.ok) throw new Error('Mass properties failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Mass properties error:', error);
      return null;
    }
  }

  public async project(features: CADFeature[], plane: string, sectionPlane?: any): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, plane, sectionPlane }),
      });
      if (!response.ok) throw new Error('Project failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Project error:', error);
      return [];
    }
  }

  public async exportCadFile(features: CADFeature[], format: string, filepath: string): Promise<boolean> {      
    try {
      const response = await fetch(`${this.baseUrl}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, format, filepath }),
      });
      const res = await response.json();
      return res.status === 'SUCCESS';
    } catch (error) {
      console.error('[HeavyEngineClient] Export error:', error);
      return false;
    }
  }

  public async solveSketch(nodes: any, edges: any, constraints: any): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/solve_sketch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, constraints }),
      });
      if (!response.ok) throw new Error('Solve sketch failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Solve sketch error:', error);
      throw error;
    }
  }

  public async solveAssembly(components: any, mates: any[]): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/solve_assembly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components, mates }),
      });
      if (!response.ok) throw new Error('Solve assembly failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Solve assembly error:', error);
      throw error;
    }
  }

  public async detectInterference(components: { id: string, features: CADFeature[] }[]): Promise<any[]> {       
    try {
      const response = await fetch(`${this.baseUrl}/detect_interference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components }),
      });
      if (!response.ok) throw new Error('Interference detection failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Interference detection error:', error);
      return [];
    }
  }

  public async createBox(params: BoxParams): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/box`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to create box:', error);
      throw error;
    }
  }
}
