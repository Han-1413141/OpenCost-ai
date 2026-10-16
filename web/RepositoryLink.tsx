import { Code2 } from 'lucide-react';

export function RepositoryLink({ repository }: { repository: string | null }) {
  const content = (
    <>
      <Code2 size={15} aria-hidden="true" />
      <span className="repository-label">查看源码</span>
      <span className="repository-label-short">源码</span>
    </>
  );
  return (
    <a
      className="repository-link"
      href={repository ?? 'https://github.com/Han-1413141/OpenCost-ai'}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="查看用户端源码（GitHub）"
      title="网页、桌面应用、上传工具与 Skills"
    >
      {content}
    </a>
  );
}
