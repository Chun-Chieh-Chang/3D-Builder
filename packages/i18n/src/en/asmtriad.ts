/** asmtriad: Move with Triad (ADR 0179). */
export const asmtriad = {
  'act.moveWithTriad': 'Move with Triad',
  'triad.hint': 'Drag an arrow to move along its axis, a square to move in its plane, a ring to turn about its axis; right-click a ring to turn 90° or 180°, the centre ball to type coordinates. Esc ends it.',
  'triad.steps': 'Triad steps',
  'triad.moveStep': 'Move step (mm, 0 does not snap)',
  'triad.turnStep': 'Turn step (°, 0 does not snap)',
  'triad.moveStepInvalid': 'The move step must be 0 or a positive finite number (mm)',
  'triad.turnStepInvalid': 'The turn step must be 0 or a positive finite number (degrees)',
  'triad.turn': 'Turn {angle}° about {axis}',
  'triad.moveTo': 'Move to XYZ…',
  'triad.pickComponent': 'Select the component to move first (in the graphics area or the tree)',
  'triad.limited': '"{name}" cannot move that way: its mates do not allow it',
  'triad.failed': 'The move failed: {why}',
  'triad.close': 'End Move with Triad',
} as const;
