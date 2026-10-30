import type { Translation } from '../index';

/** library: the standard parts library (F6.1). */
export const library: Translation = {
  'library.kind.setScrew': 'Hex Socket Set Screw (Cup Point)',
  'library.kind.socketScrew': 'Socket Head Cap Screw',
  'library.kind.dowelPin': 'Dowel Pin',
  'library.kind.washer': 'Plain Washer',
  'library.folder': 'Standard Parts',
  'library.title': 'Standard Parts Library',
  'library.kind': 'Type',
  'library.size': 'Size',
  'library.length': 'Length',
  'library.add': 'Make and Choose',
  'library.hint': 'The part file is made in the "Standard Parts" folder of the project folder (its dimensions are variables, which can be edited later); a vendor\'s STEP files in the project folder appear in the list above.',
  'library.made': 'Made the standard part {name}',
  'library.failed': 'Could not make the standard part: {why}',
  'library.badSize': 'There is no such size: {kind} {size}',
  'library.badLength': 'The length has to be a positive number: {length}',
};
