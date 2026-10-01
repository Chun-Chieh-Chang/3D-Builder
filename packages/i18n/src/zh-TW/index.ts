import { edit } from './edit';
import { equations } from './equations';
import { expr } from './expr';
import { model } from './model';
import { ui } from './ui';

/**
 * The source catalog. Keys are `<area>.<name>` and say what the text is for, never what it says, so
 * rewording or translating a message never renames its key. Values are templates: `{name}` is filled by
 * `t(key, { name })`, and the compiler checks the names (see `t`). One file per owner of the messages.
 */
export const zhTW = { ...ui, ...model, ...expr, ...equations, ...edit } as const;
