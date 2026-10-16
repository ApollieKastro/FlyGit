import { useSearchParams } from 'react-router-dom';
import type { FileDiff, DiffLine } from '@flygit/shared';
import { useBranches } from '../repositories/api';
import { useCompare } from '../repo-content/api';
import { useT } from '../../i18n/i18n';

/** Compare tab: pick two refs, list commits and a line-by-line diff. */
export function CompareTab({ owner, repo, defaultBranch }: { owner: string; repo: string; defaultBranch: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || '';
  const to = params.get('to') || defaultBranch;
  const { data: branches } = useBranches(owner, repo);
  const { data, isLoading, isError } = useCompare(owner, repo, from, to);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const refs = (branches ?? []).map((b) => b.name);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('compare.base')}</label>
          <select
            value={from}
            onChange={(e) => setParam('from', e.target.value)}
            className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="">{t('compare.selectRef')}</option>
            {refs.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <span className="pb-2 text-text-muted">←</span>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('compare.head')}</label>
          <select
            value={to}
            onChange={(e) => setParam('to', e.target.value)}
            className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            {refs.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!from ? (
        <p className="mt-6 text-sm text-text-muted">{t('compare.pickBase')}</p>
      ) : isLoading ? (
        <p className="mt-6 text-sm text-text-muted">{t('common.loading')}</p>
      ) : isError || !data ? (
        <p className="mt-6 text-sm text-danger">{t('common.error')}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-text-muted">
            {data.commits.length} {t('compare.commits').toLowerCase()} · +{data.totalAdditions} −{data.totalDeletions}
          </p>

          {data.commits.length ? (
            <ul className="mt-3 divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {data.commits.map((c) => (
                <li key={c.sha} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <code className="shrink-0 text-xs text-text-muted">{c.shortSha}</code>
                  <span className="min-w-0 flex-1 truncate">{c.message}</span>
                  <span className="shrink-0 text-xs text-text-muted">{c.author?.name}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {data.files.length ? (
            <div className="mt-6 flex flex-col gap-4">
              {data.files.map((f) => (
                <DiffView key={f.path} file={f} />
              ))}
            </div>
          ) : (
            <p className="mt-6 text-sm text-text-muted">{t('compare.noChanges')}</p>
          )}
        </>
      )}
    </div>
  );
}

function DiffView({ file }: { file: FileDiff }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-sm">
        <StatusBadge status={file.status} />
        <code className="min-w-0 flex-1 truncate">{file.path}</code>
        <span className="shrink-0 text-xs text-success">+{file.additions}</span>
        <span className="shrink-0 text-xs text-danger">−{file.deletions}</span>
      </div>
      {file.binary ? (
        <p className="px-3 py-3 text-sm text-text-muted">Binary file</p>
      ) : (
        <pre className="overflow-x-auto text-xs leading-relaxed">
          {file.hunks.flatMap((hunk) => [
            <div key={hunk.header} className="bg-bg-subtle px-3 py-1 text-text-muted">
              {hunk.header}
            </div>,
            ...hunk.lines.map((line, i) => <DiffRow key={`${hunk.header}-${i}`} line={line} />),
          ])}
        </pre>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const bg =
    line.type === 'add' ? 'bg-success/10' : line.type === 'del' ? 'bg-danger/10' : line.type === 'meta' ? 'bg-bg-subtle text-text-muted' : '';
  const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
  return (
    <div className={`flex ${bg}`}>
      <span className="w-10 shrink-0 select-none px-2 text-right text-text-faint">{line.oldNumber ?? ''}</span>
      <span className="w-10 shrink-0 select-none px-2 text-right text-text-faint">{line.newNumber ?? ''}</span>
      <span className="w-4 shrink-0 select-none">{sign}</span>
      <code className="whitespace-pre">{line.content}</code>
    </div>
  );
}

function StatusBadge({ status }: { status: FileDiff['status'] }) {
  const map = {
    added: 'text-success',
    deleted: 'text-danger',
    modified: 'text-warning',
    renamed: 'text-text-muted',
  } as const;
  return <span className={`shrink-0 text-xs font-medium ${map[status]}`}>{status}</span>;
}
