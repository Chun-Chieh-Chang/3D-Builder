import type { Translation } from '../index';

/** Messages of the expression language (B5.2, B5.3): why an expression cannot be evaluated. */
export const expr: Translation = {
  'expr.countHasUnit': 'A count is a whole number without a unit; it cannot be written as a length or an angle',
  'expr.syntax': 'The expression is wrong near character {pos} ("{near}")',
  'expr.incomplete': 'The expression is incomplete: "{expr}"',
  'expr.unknownVariable': 'Variable "{name}" not found',
  'expr.unknownDimension': 'Dimension "{name}@{owner}" not found',
  'expr.ambiguousOwner': 'More than one feature is named "{owner}"; "{name}@{owner}" does not say which',
  'expr.dimensionNotDriving': '"{name}@{owner}" is a reference dimension and cannot be used',
  'expr.unknownFunction': 'The function "{name}" is not supported',
  'expr.arity': 'The function {name} takes {count} argument(s)',
  'expr.needsString': 'The argument of {name} is a name in single quotes, for example {name}(\'name\')',
  'expr.unitMismatch': 'Units do not match: {left} cannot be added to, subtracted from or compared with {right}',
  'expr.expectedLength': 'A length is needed, got {got}',
  'expr.expectedAngle': 'An angle is needed, got {got}',
  'expr.expectedNumber': 'A number without a unit is needed, got {got}',
  'expr.badPower': 'A number with a unit can only be raised to a whole power',
  'expr.notFinite': 'The result is not a finite number: "{expr}"',
  'expr.duplicateVariable': 'The variable name "{name}" is used twice',
  'expr.cycle': 'Circular reference: {path}',
  'expr.propertyMissing': 'File property "{name}" not found',
  'expr.propertyNotNumber': 'File property "{name}" is not a number: "{value}"',
  'expr.dim.none': 'a number without a unit',
  'expr.dim.length': 'a length',
  'expr.dim.angle': 'an angle',
  'expr.dim.other': 'length^{l}·angle^{a}',
};
