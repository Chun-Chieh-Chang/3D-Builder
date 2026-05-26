import { CADComponent, CADMate } from '../store/useCadStore';
import { HeavyEngineClient } from './HeavyEngineClient';

export class AssemblyService {
  /**
   * Solve assembly mates using the backend Scipy solver.
   */
  public async solve(components: CADComponent[], mates: CADMate[]): Promise<CADComponent[]> {
    const client = HeavyEngineClient.getInstance();
    
    // Map components list to a dict for the solver
    const componentsDict: Record<string, any> = {};
    components.forEach(c => {
      componentsDict[c.id] = c;
    });

    try {
      const result = await client.solveAssembly(componentsDict, mates);
      if (result && result.components) {
        // Map back to array
        return components.map(c => result.components[c.id] || c);
      }
      return components;
    } catch (err) {
      console.error('[AssemblyService] Solver failed:', err);
      return components;
    }
  }
}