import type { Translation } from '../index';

/** patterns: component patterns and mirrors in an assembly (C15.13). */
export const patterns: Translation = {
  'pattern.noPlane': 'Choose the mirror plane',
  'pattern.badKind': 'Unknown pattern type: {kind}',
  'pattern.noAxis': 'Choose the direction or axis of the pattern',
  'pattern.badCount': 'The number of instances must be a whole number of 2 or more',
  'pattern.circularOneAxis': 'A circular pattern has one axis',
  'pattern.tooMany': 'A pattern makes at most {max} instances',
  'pattern.badSpacing': 'The spacing or angle must be greater than 0',
  'pattern.badSkip': 'There is no instance to skip: "{label}"',
  'pattern.derivedNoMate': 'An instance of a pattern or mirror follows its seed and cannot be mated; pick an element of the seed instead',
  'pattern.axisNotFound': "The pattern's direction or axis cannot be found (its component or element is gone)",
  'pattern.noSeed': 'The seed component of the pattern is not there: {id}',
  'pattern.nameEmpty': 'The name cannot be empty',
  'pattern.idInUse': 'The ID is already in use: {id}',
  'pattern.notFound': 'The pattern is not there: {id}',
  'pattern.seedLeftOut': 'The seed "{name}" is suppressed, so the instances of its pattern are not there',
};
