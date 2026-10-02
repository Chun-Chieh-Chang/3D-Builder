import type { Translation } from '../index';
import { datums } from './datums';
import { edit } from './edit';
import { equations } from './equations';
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

/** The English catalog (D9.1). Same keys as the source catalog (`zh-TW`); a key left out shows in `zh-TW`. */
export const en: Translation = { ...ui, ...model, ...expr, ...equations, ...edit, ...sketch, ...features, ...datums, ...output, ...app, ...viewport, ...tree, ...pmpanels, ...dialogs, ...storemsg, ...sketchtools, ...core, ...lowlevel, ...subassembly };
