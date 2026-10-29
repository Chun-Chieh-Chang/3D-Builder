/// <reference lib="webworker" />
/**
 * A worker used once and thrown away (F2.2): it reads an IGES file before the file is put in the document. OCCT's IGES reader loops for ever on some
 * broken files (an entity whose record ends before its parameters do, such as `108,0.;`), and OCCT cannot be interrupted, so the page gives this worker
 * a time limit and terminates it after, whatever happened. A file that passes here is read the same way by the kernel worker's rebuild.
 */
import * as Comlink from 'comlink';
import { setLocale } from '@3db/i18n';
import occtWasm from 'libcascade/single/wasm?url';
import { Kernel } from '@3db/kernel';
import type { ProbeApi } from './protocol';

const api: ProbeApi = {
  async probeIges(data, locale) {
    setLocale(locale);
    const kernel = await Kernel.load({ wasmUrl: occtWasm });
    kernel.release(kernel.importIges(data).shape);
  },
};

Comlink.expose(api);
