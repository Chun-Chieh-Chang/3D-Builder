import type { Translation } from '../index';

/** Interface wording of the equations and file-properties dialogs (B5.2, B5.3, B8.3). */
export const equations: Translation = {
  'action.equations': 'Equations',
  'action.properties': 'File Properties',
  'tab.tools': 'Tools',

  'eq.title': 'Equations',
  'eq.hint': 'Variables and expressions: + − × ÷ ^, parentheses, functions such as sin cos sqrt min max if, and units such as mm, in, deg. A dimension is "name@sketch"; a file property is read with property(\'name\').',
  'eq.variables': 'Global Variables',
  'eq.dimensions': 'Sketch Dimensions',
  'eq.name': 'Name',
  'eq.expression': 'Expression',
  'eq.value': 'Value',
  'eq.add': 'Add',
  'eq.delete': 'Delete',
  'eq.newName': 'Name of the new variable',
  'eq.newExpr': 'Expression, for example 20 or w*2',
  'eq.none': '(no global variables yet)',
  'eq.noDimensions': '(no dimensions in the sketches yet)',
  'eq.dimensionName': 'Dimension name: {name}',
  'eq.close': 'Close',

  'props.title': 'File Properties',
  'props.hint': 'Custom properties (vendor, part number …) are saved with the file, and a number can be read in an expression with property(\'name\').',
  'props.name': 'Property name',
  'props.value': 'Value',
  'props.add': 'Add',
  'props.delete': 'Delete',
  'props.none': '(no properties yet)',
  'props.newName': 'Name of the new property',
  'props.newValue': 'Value',
  'props.vendor': 'Vendor',
  'props.partNumber': 'Part Number',
  'props.description': 'Description',

  'value.expression': 'Value of the expression: {value}',
};
