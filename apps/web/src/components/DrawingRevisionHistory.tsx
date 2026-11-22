import { useState } from 'react';
import { t } from '@3db/i18n';
import { DRAWING_REVISION_FIELDS, DRAWING_REVISION_LIMITS, drawingRevisionDate, type DrawingCommand, type DrawingRevision } from '@3db/model';

export function DrawingRevisionHistory({ entries = [], drafter, execute }: {
  entries?: readonly DrawingRevision[];
  drafter?: string;
  execute: (command: DrawingCommand) => boolean;
}) {
  const [editing, setEditing] = useState<{ previousRevision?: string; entry: DrawingRevision } | null>(null);
  const update = (field: keyof DrawingRevision, value: string) => {
    setEditing((last) => last && ({ ...last, entry: { ...last.entry, [field]: value } }));
  };

  return (
    <section className="drawing-revisions" aria-label={t('drawing.revisions.title')}>
      <h3>{t('drawing.revisions.title')}</h3>
      {!editing && <button type="button" className="pm-button" onClick={() => setEditing({ entry: {
        revision: '', date: drawingRevisionDate(), description: '', author: drafter ?? '', changeOrder: '',
      } })}>{t('drawing.revisions.add')}</button>}
      {editing && (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (execute({ type: 'saveRevision', ...editing })) setEditing(null);
        }}>
          {DRAWING_REVISION_FIELDS.map((field) => (
            <label key={field}>
              <span>{t(`drawing.revisions.${field}`)}</span>
              {field === 'description'
                ? <textarea rows={3} maxLength={DRAWING_REVISION_LIMITS[field]} value={editing.entry[field]} onChange={(e) => update(field, e.currentTarget.value)} />
                : <input type={field === 'date' ? 'date' : 'text'} required={field === 'revision' || field === 'date'} maxLength={DRAWING_REVISION_LIMITS[field]}
                    value={editing.entry[field] ?? ''} onChange={(e) => update(field, e.currentTarget.value)} />}
            </label>
          ))}
          <div className="drawing-revision-actions">
            <button type="submit" className="pm-button">{t('drawing.revisions.save')}</button>
            <button type="button" className="pm-button" onClick={() => setEditing(null)}>{t('drawing.revisions.cancel')}</button>
          </div>
        </form>
      )}
      {entries.length > 0 && (
        <ol>
          {[...entries].reverse().map((entry) => (
            <li key={entry.revision}>
              <strong>{entry.revision}</strong> <time dateTime={entry.date}>{entry.date}</time>
              <p>{entry.description}</p>
              <div>{entry.author}{entry.changeOrder && <> · {entry.changeOrder}</>}</div>
              {!editing && <div className="drawing-revision-actions">
                <button type="button" className="pm-button" onClick={() => setEditing({ previousRevision: entry.revision, entry })}>{t('drawing.revisions.edit')}</button>
                <button type="button" className="pm-button danger" onClick={() => execute({ type: 'deleteRevision', revision: entry.revision })}>{t('drawing.revisions.delete')}</button>
              </div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
