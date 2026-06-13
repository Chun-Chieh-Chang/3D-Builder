# Task Plan: Sprint ASM-2 & ASM-3 (Advanced Mechanical Simulation)

## Goal
Finalize Phase 4 by implementing professional-grade mechanical joint mapping and interactive "Drag to Animate" simulation, achieving 100% Roadmap completion.

## Phases

### Phase 1: Advanced Joint Mapping (Sprint ASM-2)
- [ ] Refine `src/services/AssemblyPhysicsService.ts` to support:
  - CONCENTRIC -> Revolute (Hinge) Joint along the hole/axis direction.
  - COINCIDENT (Faces) -> Prismatic (Slider) Joint if combined with other constraints, or simple planar constraint.
  - DISTANCE -> Impulse-based offset constraint.
- [ ] Implement local coordinate system (LCS) extraction for precise joint anchoring.
- Status: `not_started`

### Phase 2: Drag to Animate & Interaction (Sprint ASM-3)
- [ ] Implement "Mouse-Body" interaction: Allow users to click and drag components while the physics simulation is running.
- [ ] Use `RAPIER.ImpulseJoint.mouse_joint` or equivalent spring-based forces to pull bodies towards the cursor.
- [ ] Finalize Collision detection for all component meshes (using convex hull for performance).
- Status: `not_started`

### Phase 3: Gear & Cam Engagement (Bonus/Parity)
- [ ] Map GEAR mates to Rapier's ratio-based joints.
- [ ] Verify mechanical transmission (driving one part rotates the other).
- Status: `not_started`

### Phase 4: Final Asset Delivery & Roadmap Completion
- [ ] Update `gap-checklist.md` to 100/100 SCS.
- [ ] Update `PROJECT_ROADMAP.md` to 100% Overall Completion.
- [ ] Synchronize `DEV_LOG.md`.
- [ ] Execute `save_checkpoint.py`.
- Status: `not_started`
