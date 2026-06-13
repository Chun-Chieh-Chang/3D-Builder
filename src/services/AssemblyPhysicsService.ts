/**
 * AssemblyPhysicsService.ts
 * Bridge between CAD Assembly structure and Rapier3D physics engine.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { CADComponent, CADMate } from '../store/useCadStore';

export class AssemblyPhysicsService {
  private static instance: AssemblyPhysicsService;
  private world: RAPIER.World | null = null;
  private rigidBodies: Map<string, RAPIER.RigidBody> = new Map();
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): AssemblyPhysicsService {
    if (!AssemblyPhysicsService.instance) {
      AssemblyPhysicsService.instance = new AssemblyPhysicsService();
    }
    return AssemblyPhysicsService.instance;
  }

  public async init() {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    this.initialized = true;
    console.log('[Physics] Rapier3D World Initialized.');
  }

  public reset() {
    if (!this.world) return;
    this.world.free();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    this.rigidBodies.clear();
  }

  public syncAssembly(components: CADComponent[], mates: CADMate[]) {
    if (!this.world) return;
    this.reset();

    // 1. Create Rigid Bodies
    components.forEach(comp => {
      if (!comp.visible) return;

      const bodyDesc = comp.isFixed 
        ? RAPIER.RigidBodyDesc.fixed() 
        : RAPIER.RigidBodyDesc.dynamic();
      
      bodyDesc.setTranslation(comp.transform.position[0], comp.transform.position[1], comp.transform.position[2]);
      // Note: Rotation conversion would go here (Quaternion)
      
      const body = this.world!.createRigidBody(bodyDesc);
      
      // Add a simple box collider based on bounding box (or placeholder)
      const colliderDesc = RAPIER.ColliderDesc.cuboid(10, 10, 10); // Default placeholder
      this.world!.createCollider(colliderDesc, body);
      
      this.rigidBodies.set(comp.id, body);
    });

    // 2. Map Mates to Joints
    mates.forEach(mate => {
      const body1 = this.rigidBodies.get(mate.entity1.componentId);
      const body2 = this.rigidBodies.get(mate.entity2.componentId);

      if (!body1 || !body2) return;

      const anchor1 = mate.entity1.localOrigin ? { x: mate.entity1.localOrigin[0], y: mate.entity1.localOrigin[1], z: mate.entity1.localOrigin[2] } : { x: 0, y: 0, z: 0 };
      const anchor2 = mate.entity2.localOrigin ? { x: mate.entity2.localOrigin[0], y: mate.entity2.localOrigin[1], z: mate.entity2.localOrigin[2] } : { x: 0, y: 0, z: 0 };

      if (mate.type === 'CONCENTRIC') {
        // Revolute (Hinge) Joint: Fixed axis of rotation
        const axis1 = mate.entity1.localNormal ? { x: mate.entity1.localNormal[0], y: mate.entity1.localNormal[1], z: mate.entity1.localNormal[2] } : { x: 0, y: 0, z: 1 };
        const axis2 = mate.entity2.localNormal ? { x: mate.entity2.localNormal[0], y: mate.entity2.localNormal[1], z: mate.entity2.localNormal[2] } : { x: 0, y: 0, z: 1 };
        
        const params = RAPIER.JointData.revolute(anchor1, anchor2, axis1);
        this.world!.createImpulseJoint(params, body1, body2, true);
      } else if (mate.type === 'COINCIDENT') {
        // Point-to-Point (Spherical) Joint
        const params = RAPIER.JointData.spherical(anchor1, anchor2);
        this.world!.createImpulseJoint(params, body1, body2, true);
      } else if (mate.type === 'DISTANCE') {
        // Distance constraint
        const targetDist = mate.parameters?.offset || 0;
        const params = RAPIER.JointData.fixed(anchor1, { x: 0, y: 0, z: 0, w: 1 }, anchor2, { x: 0, y: 0, z: 0, w: 1 });
        // Rapier doesn't have a direct "distance" impulse joint in the same way, 
        // we'd typically use a prismatic with limits or a custom force.
        // For MVP, we fix them at the offset position.
        this.world!.createImpulseJoint(params, body1, body2, true);
      } else if (mate.type === 'GEAR') {
        // Mechanical Transmission
        const ratio = mate.parameters?.ratio || 1.0;
        // In Rapier, Gear joints are often simulated via motor/ratio on revolutes.
        // This is a simplified mapping for MVP.
        const params = RAPIER.JointData.revolute(anchor1, anchor2, { x: 0, y: 0, z: 1 });
        this.world!.createImpulseJoint(params, body1, body2, true);
      }
    });
  }

  public step() {
    if (!this.world) return;
    this.world.step();
  }

  public getTransform(componentId: string) {
    const body = this.rigidBodies.get(componentId);
    if (!body) return null;
    return {
      position: body.translation(),
      rotation: body.rotation()
    };
  }

  public applyDragForce(componentId: string, targetPosition: { x: number, y: number, z: number }) {
    const body = this.rigidBodies.get(componentId);
    if (!body || body.bodyType() === RAPIER.RigidBodyType.Fixed) return;

    const currentPos = body.translation();
    const vec = {
      x: (targetPosition.x - currentPos.x) * 100,
      y: (targetPosition.y - currentPos.y) * 100,
      z: (targetPosition.z - currentPos.z) * 100
    };

    body.setLinearVelocity(vec, true);
    // Add some damping when close
    body.setAngularVelocity({ x: 0, y: 0, z: 0 }, true);
  }
}
