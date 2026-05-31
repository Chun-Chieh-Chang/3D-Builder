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
  colors?: number[];
  face_metadata?: FaceMetadata[];
}

export interface RebuildMeshPayload {
  type: string;
  data: MeshData;
  ref_geometry?: unknown[];
  warnings?: { feature?: string; code?: string; message: string }[];
}

export class RebuildError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'RebuildError';
  }
}

export interface CADFeature {
  id: string;
  type: string;
  parameters: any;
  color?: string;
}

export class HeavyEngineClient {
  private static instance: HeavyEngineClient;
  private baseUrl: string = 'http://127.0.0.1:8400/api/v1/geometry';

  private constructor() {}

  public static getInstance(): HeavyEngineClient {
    if (!HeavyEngineClient.instance) {
      HeavyEngineClient.instance = new HeavyEngineClient();
    }
    return HeavyEngineClient.instance;
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch("http://127.0.0.1:8400/api/v1/health");
      return response.ok;
    } catch {
      return false;
    }
  }

  public async registerComponent(id: string, features: CADFeature[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/register_component`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, features }),
      });
      return response.ok;
    } catch (error) {
      console.error('[HeavyEngineClient] Register component error:', error);
      return false;
    }
  }

  public async rebuild(
    features: CADFeature[],
    deflection: number = 0.01,
    signal?: AbortSignal,
    options?: { fromFeatureIndex?: number; featureFingerprint?: string },
  ): Promise<RebuildMeshPayload[]> {
    try {
      const response = await fetch(`${this.baseUrl}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features,
          deflection,
          fromFeatureIndex: options?.fromFeatureIndex ?? 0,
          featureFingerprint: options?.featureFingerprint,
        }),
        signal,
      });
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body);
        } catch {
          detail = await response.text().catch(() => '');
        }
        throw new RebuildError(detail || `Rebuild failed (${response.status})`, detail);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof RebuildError) throw error;
      if ((error as Error).name === 'AbortError') throw error;
      console.error('[HeavyEngineClient] Rebuild error:', error);
      throw new RebuildError((error as Error).message || 'Rebuild failed');
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

  public async projectAssembly(components: any[], plane: string): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/project_assembly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components, plane }),
      });
      if (!response.ok) throw new Error('Project assembly failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Project assembly error:', error);
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

  public async checkInterferences(components: any[]): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/check_interferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components }),
      });
      if (!response.ok) throw new Error('Interference check failed');
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] Interference detection error:', error);
      return [];
    }
  }

  public async exportAssemblyStep(components: any[], filename: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/export_assembly/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components, filename }),
      });
      if (!response.ok) throw new Error('Export assembly failed');
      const res = await response.json();
      return res.status === 'SUCCESS';
    } catch (error) {
      console.error('[HeavyEngineClient] Export assembly error:', error);
      return false;
    }
  }

  public async uploadStepFile(file: File): Promise<{ filepath: string }> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${this.baseUrl}/upload_step`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload STEP file');
      }
      return await response.json();
    } catch (error) {
      console.error('[HeavyEngineClient] STEP upload error:', error);
      throw error;
    }
  }

  public async convertEntities(features: CADFeature[], topology: any, planeType: string, faceOrigin?: number[], faceNormal?: number[]): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/convert_entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, topology, planeType, faceOrigin, faceNormal }),
      });
      if (!response.ok) throw new Error('Convert entities failed');
      const data = await response.json();
      return data.points || [];
    } catch (error) {
      console.error('[HeavyEngineClient] Convert entities error:', error);
      throw error;
    }
  }

  public async offsetEntities(points2D: number[][], distance: number, planeType: string, faceOrigin?: number[], faceNormal?: number[]): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/offset_entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points2D, distance, planeType, faceOrigin, faceNormal }),
      });
      if (!response.ok) throw new Error('Offset entities failed');
      const data = await response.json();
      return data.points || [];
    } catch (error) {
      console.error('[HeavyEngineClient] Offset entities error:', error);
      throw error;
    }
  }
}
