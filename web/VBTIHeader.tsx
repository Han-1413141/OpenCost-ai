import { LanguageSelector } from './i18n/LanguageSelector';
import { VBTIMark } from './VBTIEntry';
import { vbtiRoutes, type VbtiPage } from './vbti-navigation';
import { GithubLoginButton } from './GithubAccount';

export function VBTIHeader({ page }: { page: VbtiPage }) {
  return (
    <header className="vbti-site-header">
      <a className="vbti-home-link" href="/vbti/" aria-label="VBTI 活动首页">
        <VBTIMark />
        <span>by OpenCost</span>
      </a>
      <nav aria-label="VBTI 导航">
        {(
          [
            ['vbti', '活动首页'],
            ['vbti-test', '开始测试'],
            ['vbti-result', '我的类型'],
          ] as const
        ).map(([id, label]) => (
          <a key={id} href={vbtiRoutes[id]} aria-current={page === id ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div className="vbti-header-tools">
        <GithubLoginButton vbti />
        <LanguageSelector />
        <a className="vbti-return" href="/#overview">
          ← OpenCost
        </a>
      </div>
    </header>
  );
}
