import type { Translation } from '../index';
import { datums } from './datums';
import { edit } from './edit';
import { equations } from './equations';
import { expr } from './expr';
import { features } from './features';
import { model } from './model';
import { output } from './output';
import { sketch } from './sketch';
import { ui } from './ui';

/** The English catalog (D9.1). Same keys as the source catalog (`zh-TW`); a key left out shows in `zh-TW`. */
export const en: Translation = { ...ui, ...model, ...expr, ...equations, ...edit, ...sketch, ...features, ...datums, ...output };
