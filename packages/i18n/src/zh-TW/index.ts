import { edit } from './edit';
import { equations } from './equations';
import { datums } from './datums';
import { expr } from './expr';
import { features } from './features';
import { model } from './model';
import { output } from './output';
import { sketch } from './sketch';
import { app } from './app';
import { viewport } from './viewport';
import { tree } from './tree';
import { pmpanels } from './pmpanels';
import { dialogs } from './dialogs';
import { storemsg } from './storemsg';
import { sketchtools } from './sketchtools';
import { core } from './core';
import { lowlevel } from './lowlevel';
import { ui } from './ui';
import { subassembly } from './subassembly';
import { patterns } from './patterns';

/**
 * The source catalog. Keys are `<area>.<name>` and say what the text is for, never what it says, so
 * rewording or translating a message never renames its key. Values are templates: `{name}` is filled by
 * `t(key, { name })`, and the compiler checks the names (see `t`). One file per owner of the messages.
 */
export const zhTW = { ...ui, ...model, ...expr, ...equations, ...edit, ...sketch, ...features, ...datums, ...output, ...app, ...viewport, ...tree, ...pmpanels, ...dialogs, ...storemsg, ...sketchtools, ...core, ...lowlevel, ...subassembly, ...patterns } as const;
