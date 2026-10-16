import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FileContent } from '@flygit/shared';
import { useTree, useFile, useReadme, useBranches } from '../repositories/api';
import { useT } from '../../i18n/i18n';
import { FileIcon } from './FileIcon';

/**
 * Code browsing tab: branch picker, breadcrumb, file tree, blob viewer, README.
 * Path/ref are kept in the query string (`?ref=&path=`) so links are shareable.
 */
export function CodeTab({ owner, repo, defaultBranch }: { owner: string; repo: string; defaultBranch: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const ref = params.get('ref') || defaultBranch;
  const path = params.get('path') || '';

  const { data: branches } = useBranches(owner, repo);
  const { data: tree, isLoading } = useTree(owner, repo, ref, path);
  const { data: file, isLoading: fileLoading } = useFile(owner, repo, path, ref);
  const { data: readme } = useReadme(owner, repo, ref);

  const isFile = useMemo(() => {
    if (!path) return false;
    return tree?.entries.find((e) => e.path === path)?.type === 'file';
  }, [path, tree]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="text-sm">
        <select
          value={ref}
          onChange={(e) => setParam('ref', e.target.value)}
          className="mb-3 w-full rounded-[var(--radius)] border border-border bg-bg-subtle px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          aria-label={t('repo.branch')}
        >
          {(branches ?? []).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
          {!branches?.length && <option value={ref}>{ref}</option>}
        </select>

        {path ? (
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-text-muted">
            <button onClick={() => setParam('path', parentPath(path))} className="hover:text-text">
              {repo}
            </button>
            <Breadcrumbs path={path} onNavigate={setParam} />
          </nav>
        ) : (
          <div className="mb-3 text-xs text-text-muted">{t('repo.branch')}: {ref}</div>
        )}
      </aside>

      <div className="min-w-0">
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
          <div className="border-b border-border bg-surface px-3 py-2 text-xs text-text-muted">
            {path || '/'}
          </div>
          {isLoading ? (
            <p className="px-3 py-6 text-sm text-text-muted">{t('common.loading')}</p>
          ) : isFile ? (
            <FileView loading={fileLoading} file={file} />
          ) : (
            <ul className="divide-y divide-border">
              {path ? (
                <li>
                  <button
                    onClick={() => setParam('path', parentPath(path))}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <FileIcon type="dir" />
                    <span className="text-text-muted">..</span>
                  </button>
                </li>
              ) : null}
              {tree?.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    onClick={() => setParam('path', entry.type === 'dir' ? entry.path : entry.path)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <FileIcon type={entry.type} />
                    <span className={entry.type === 'dir' ? 'text-accent' : ''}>{entry.name}</span>
                    {entry.type === 'file' ? (
                      <span className="ml-auto text-xs text-text-faint">{formatSize(entry.size)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {!tree?.entries.length ? (
                <li className="px-3 py-6 text-center text-sm text-text-muted">{t('common.empty')}</li>
              ) : null}
            </ul>
          )}
        </div>

        {!path && readme?.content ? (
          <section className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-border">
            <div className="border-b border-border bg-surface px-3 py-2 text-sm font-medium">
              {readme.content.name}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">
              {readme.content.content}
            </pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function FileView({ loading, file }: { loading: boolean; file?: FileContent }) {
  const t = useT();
  if (loading) return <p className="px-3 py-6 text-sm text-text-muted">{t('common.loading')}</p>;
  if (!file) return <p className="px-3 py-6 text-sm text-text-muted">{t('common.empty')}</p>;
  if (file.isBinary) {
    return (
      <div className="px-3 py-6 text-sm text-text-muted">
        {t('common.empty')} · {formatSize(file.size)}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {file.content.split('\n').map((line, i) => (
            <tr key={i} className="align-top">
              <td className="w-12 select-none border-r border-border px-2 text-right text-xs text-text-faint">
                {i + 1}
              </td>
              <td className="px-3 font-mono whitespace-pre">{line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (key: string, value: string | null) => void;
}) {
  const segments = path.split('/');
  return (
    <>
      {segments.map((seg, i) => {
        const partial = segments.slice(0, i + 1).join('/');
        const last = i === segments.length - 1;
        return (
          <span key={partial} className="flex items-center gap-1">
            <span className="text-text-faint">/</span>
            {last ? (
              <span className="text-text">{seg}</span>
            ) : (
              <button onClick={() => onNavigate('path', partial)} className="hover:text-text">
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </>
  );
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
