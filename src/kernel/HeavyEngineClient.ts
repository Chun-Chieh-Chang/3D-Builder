export interface MeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
}

export interface CADFeature {
  id: string;
  type: string;
  parameters: any;
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

  /**
   * Request a parametric box mesh from the heavy engine.
   */
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

  /**
   * Request an assembly rebuild from the heavy engine.
   */
  public async rebuild(features: CADFeature[]): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/rebuild`, {
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
      console.error('[HeavyEngineClient] Failed to rebuild assembly:', error);
      throw error;
    }
  }

  /**
   * Health check for the backend engine.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:8400/');
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Request a 2D projection of the 3D model.
   */
  public async project(features: CADFeature[], plane: string = 'FRONT'): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/project`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ features, plane }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to project:', error);
      return [];
    }
  }

  /**
   * Convert 3D entities (edges/faces) into 2D sketch points projected on the active plane.
   */
  public async convertEntities(
    features: CADFeature[],
    selectedTopology: any,
    activePlane: string,
    faceOrigin?: number[] | null,
    faceNormal?: number[] | null
  ): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/convert_entities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          features,
          selectedTopology,
          activePlane,
          activeFaceOrigin: faceOrigin,
          activeFaceNormal: faceNormal,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to convert entities:', error);
      return [];
    }
  }

  /**
   * Offset 2D sketch points or reference entities by a given distance.
   */
  public async offsetEntities(
    points: any[],
    distance: number,
    planeType: string,
    faceOrigin?: number[] | null,
    faceNormal?: number[] | null
  ): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/offset_entities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          points,
          distance,
          planeType,
          activeFaceOrigin: faceOrigin,
          activeFaceNormal: faceNormal,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to offset entities:', error);
      return [];
    }
  }

  /**
   * Slice 3D solid with the active sketch plane to get the intersection curve.
   */
  public async getIntersectionCurve(
    features: CADFeature[],
    activePlane: string,
    faceOrigin?: number[] | null,
    faceNormal?: number[] | null
  ): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/intersection_curve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          features,
          activePlane,
          activeFaceOrigin: faceOrigin,
          activeFaceNormal: faceNormal,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to get intersection curve:', error);
      return [];
    }
  }

  /**
   * Create a custom reference plane based on 3D topologies and offset.
   */
  public async createRefPlane(
    planeType: string,
    refs: any[],
    offset: number,
    features: CADFeature[]
  ): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/ref_plane`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planeType,
          refs,
          offset,
          features,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to create reference plane:', error);
      return null;
    }
  }

  /**
   * Create a custom reference axis based on 3D topologies.
   */
  public async createRefAxis(
    axisType: string,
    refs: any[],
    features: CADFeature[]
  ): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/ref_axis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          axisType,
          refs,
          features,
        }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to create reference axis:', error);
      return null;
    }
  }

  /**
   * Request precise mass/physical properties from the heavy engine.
   */
  public async calculateMassProperties(features: CADFeature[]): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/mass_properties`, {
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
      console.error('[HeavyEngineClient] Failed to calculate mass properties:', error);
      throw error;
    }
  }

  /**
   * Export the 3D solid to STEP, IGES, or STL on the local filesystem.
   */
  public async exportCadFile(
    features: CADFeature[],
    format: 'STEP' | 'IGES' | 'STL',
    filepath: string
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ features, format, filepath }),
      });

      if (!response.ok) {
        throw new Error(`Engine error: ${response.statusText}`);
      }

      const res = await response.json();
      return res.status === 'SUCCESS';
    } catch (error) {
      console.error('[HeavyEngineClient] Failed to export CAD file:', error);
      return false;
    }
  }
}
