import type { FileEntry } from '@flygit/shared';

const ICONS: Record<FileEntry['type'], string> = {
  file: '📄',
  dir: '📁',
  symlink: '🔗',
  submodule: '📦',
};

export function FileIcon({ type }: { type: FileEntry['type'] }) {
  return (
    <span aria-hidden className="text-sm leading-none">
      {ICONS[type]}
    </span>
  );
}
