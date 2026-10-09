import { Fragment, type ReactNode } from 'react';
import { t } from '@3db/i18n';
import { ACTIONS, shortcutOf } from '../actions';
import { topicOf, topics } from '../help/context';
import { closeHelp, goBack, setQuery, showContents, showTopic, useHelp } from '../help/state';
import { contents, searchTopics, type HelpTopic } from '../help/topics';
import { AUTHOR_CREDIT } from '../credit';

/** A paragraph of a topic's text: lines starting with 「- 」 are a list, the rest run together. */
function paragraph(text: string, key: number): ReactNode {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length > 0) out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>);
    list = [];
  };
  let run: string[] = [];
  const endRun = () => {
    if (run.length > 0) out.push(<p key={`p${out.length}`}>{run.join(' ')}</p>);
    run = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      endRun();
      list.push(line.slice(2));
    } else {
      flush();
      run.push(line);
    }
  }
  endRun();
  flush();
  return <Fragment key={key}>{out}</Fragment>;
}

function Link({ id }: { id: string }) {
  const topic = topicOf(id);
  if (!topic) return null;
  return (
    <button className="help-link" onClick={() => showTopic(id)}>
      {topic.title}
    </button>
  );
}

function TopicView({ topic }: { topic: HelpTopic }) {
  const action = ACTIONS.find((a) => a.id === topic.id);
  const key = action ? shortcutOf(action) : undefined;
  return (
    <article className="help-topic" data-topic={topic.id}>
      <h2>{topic.title}</h2>
      {key && <p className="help-shortcut">{t('helpui.shortcut', { key })}</p>}
      <p className="help-summary">{topic.summary}</p>
      {topic.body.length > 0 ? topic.body.map(paragraph) : <p className="help-empty">{t('helpui.noBody')}</p>}
      {topic.see.length > 0 && (
        <footer>
          <h3>{t('helpui.related')}</h3>
          {topic.see.map((id) => (
            <Link key={id} id={id} />
          ))}
        </footer>
      )}
    </article>
  );
}

/** The help window (docs/help-plan.md): contents, search and one topic; opened by the button, F1 and 「這是什麼？」. */
export function HelpPanel() {
  const h = useHelp();
  if (!h.open) return null;
  const all = topics();
  const found = h.query.trim() === '' ? null : searchTopics(all, h.query);
  const topic = h.topic ? topicOf(h.topic) : null;
  return (
    <aside className="help-panel" role="complementary" aria-label={t('helpui.title')}>
      <header>
        <strong>{t('helpui.title')}</strong>
        {(topic || found) && (
          <button onClick={() => (h.back.length > 0 ? goBack() : showContents())}>{h.back.length > 0 ? t('helpui.back') : t('helpui.contents')}</button>
        )}
        <button className="help-close" onClick={closeHelp} aria-label={t('helpui.close')} title={t('helpui.close')}>
          ✕
        </button>
      </header>
      <input className="help-search" type="search" value={h.query} placeholder={t('helpui.search')} onChange={(e) => setQuery(e.target.value)} />
      <div className="help-body">
        {found ? (
          found.length === 0 ? (
            <p className="help-empty">{t('helpui.noResult')}</p>
          ) : (
            <ul className="help-results">
              {found.map((x) => (
                <li key={x.id}>
                  <button className="help-link" onClick={() => showTopic(x.id)}>
                    {x.title}
                  </button>
                  <span>{x.summary}</span>
                </li>
              ))}
            </ul>
          )
        ) : topic ? (
          <TopicView topic={topic} />
        ) : (
          contents(all).map((g) => (
            <section key={g.group}>
              <h3>{g.title}</h3>
              <ul className="help-results">
                {g.topics.map((x) => (
                  <li key={x.id}>
                    <button className="help-link" onClick={() => showTopic(x.id)}>
                      {x.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <footer className="help-credit" data-credit>
        {AUTHOR_CREDIT}
      </footer>
    </aside>
  );
}
