import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ControlledAttachmentEvidence, ControlledAttachmentRef } from '@3db/drawing';

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

interface RawManifest {
  document?: unknown;
  revision?: unknown;
  source?: unknown;
  original_step_sha256?: unknown;
  regenerated_step_sha256?: unknown;
  members_sha256?: unknown;
}

interface RawFaceIndexRow {
  drawing_face_ref?: unknown;
  step_face?: unknown;
}

/**
 * Loads and cryptographically verifies a sibling controlled geometric attachment directory
 * (`<dirname(drawingPath)>/<ref.document>/`) against `manifest.json`, `members_sha256`,
 * `drawing-face-index.json`, and the loaded part's STEP blob SHA-256(s).
 *
 * Returns `null` if the attachment directory or `manifest.json` does not exist;
 * returns `ControlledAttachmentEvidence` with `integrityOk: false` and explicit `integrityErrors`
 * if any file, hash, or index entry is tampered, missing, or inconsistent.
 */
export function loadControlledAttachment(
  drawingPath: string,
  ref: ControlledAttachmentRef,
  partStepSha256s: readonly string[],
): ControlledAttachmentEvidence | null {
  if (!SAFE_SEGMENT_RE.test(ref.document) || ref.document === '.' || ref.document === '..') {
    return {
      document: ref.document,
      revision: ref.revision,
      source: '',
      integrityOk: false,
      integrityErrors: [`unsafe controlled attachment folder name "${ref.document}"`],
      faceIndex: new Map(),
    };
  }
  const dir = join(dirname(drawingPath), ref.document);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  const errors: string[] = [];
  let manifest: RawManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RawManifest;
  } catch (e) {
    return {
      document: ref.document,
      revision: ref.revision,
      source: '',
      integrityOk: false,
      integrityErrors: [`manifest.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
      faceIndex: new Map(),
    };
  }

  const document = typeof manifest.document === 'string' ? manifest.document.trim() : '';
  const revision = typeof manifest.revision === 'string' ? manifest.revision.trim() : '';
  const source = typeof manifest.source === 'string' ? manifest.source.trim() : '';
  const origSha = typeof manifest.original_step_sha256 === 'string' ? manifest.original_step_sha256.trim().toLowerCase() : '';
  const regenSha = typeof manifest.regenerated_step_sha256 === 'string' ? manifest.regenerated_step_sha256.trim().toLowerCase() : '';

  if (!SHA256_HEX_RE.test(origSha)) errors.push('manifest original_step_sha256 is missing or invalid');
  if (!SHA256_HEX_RE.test(regenSha)) errors.push('manifest regenerated_step_sha256 is missing or invalid');
  if (origSha && regenSha && origSha !== regenSha) {
    errors.push(`manifest original_step_sha256 !== regenerated_step_sha256`);
  }

  const normalizedPartShas = partStepSha256s.map((s) => s.trim().toLowerCase()).filter((s) => SHA256_HEX_RE.test(s));
  if (normalizedPartShas.length > 0 && origSha && !normalizedPartShas.includes(origSha)) {
    errors.push(`attachment STEP SHA-256 (${origSha.slice(0, 12)}…) does not match loaded part STEP blob`);
  }

  const members = manifest.members_sha256;
  if (!members || typeof members !== 'object' || Array.isArray(members)) {
    errors.push('manifest members_sha256 is missing or invalid');
  } else {
    const entries = Object.entries(members as Record<string, unknown>);
    if (entries.length === 0) errors.push('manifest members_sha256 is empty');
    if (!('drawing-face-index.json' in (members as Record<string, unknown>))) {
      errors.push('manifest members_sha256 must cover drawing-face-index.json');
    }
    for (const [name, expectedRaw] of entries) {
      if (!SAFE_SEGMENT_RE.test(name) || name === '.' || name === '..') {
        errors.push(`unsafe member filename "${name}" in manifest`);
        continue;
      }
      const expected = typeof expectedRaw === 'string' ? expectedRaw.trim().toLowerCase() : '';
      if (!SHA256_HEX_RE.test(expected)) {
        errors.push(`invalid SHA-256 for member "${name}"`);
        continue;
      }
      const full = join(dir, name);
      if (!existsSync(full)) {
        errors.push(`attachment member "${name}" is missing`);
        continue;
      }
      const actual = sha256File(full);
      if (actual !== expected) {
        errors.push(`SHA-256 mismatch for member "${name}"`);
      }
    }
  }

  const faceIndex = new Map<string, number>();
  const indexPath = join(dir, 'drawing-face-index.json');
  if (!existsSync(indexPath)) {
    errors.push('drawing-face-index.json is missing');
  } else {
    try {
      const rows = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown;
      if (!Array.isArray(rows)) {
        errors.push('drawing-face-index.json must be an array');
      } else {
        for (const row of rows as RawFaceIndexRow[]) {
          if (typeof row?.drawing_face_ref === 'string' && typeof row?.step_face === 'number' && Number.isSafeInteger(row.step_face) && row.step_face > 0) {
            faceIndex.set(row.drawing_face_ref, row.step_face);
          }
        }
      }
    } catch (e) {
      errors.push(`drawing-face-index.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    document,
    revision,
    source,
    integrityOk: errors.length === 0,
    ...(errors.length > 0 ? { integrityErrors: errors } : {}),
    faceIndex,
  };
}
