import { LanguageSelector } from './i18n/LanguageSelector';
import { VBTIMark } from './VBTIEntry';
import { vbtiRoutes, type VbtiPage } from './vbti-navigation';
import { GithubLoginButton } from './GithubAccount';

export function VBTIHeader({ page }: { page: VbtiPage }) {
  return (
    <header className="vbti-site-header">
      <a className="vbti-home-link" href="/vbti/" aria-label="VBTI 活动首页">
        <img
          className="vbti-brand-icon"
          src="/brand/vbti-icon-96.png"
          alt=""
          width="36"
          height="36"
        />
        <VBTIMark />
        <span>by OpenCost-AI</span>
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
          <img src="/brand/opencost-ai-icon-32.png" alt="" width="20" height="20" /> OpenCost-AI
        </a>
      </div>
    </header>
  );
}

export function VBTIOpenCost() {
  return (
    <section className="vbti-opencost-promo" aria-label="发现 OpenCost-AI">
      <div className="vbti-opencost-intro">
        <img src="/brand/opencost-ai-icon-96.png" alt="" width="52" height="52" />
        <div>
          <span>VBTI 由 OpenCost-AI 出品</span>
          <h2>测出你的风格，也找到更划算的 AI。</h2>
        </div>
      </div>
      <p>
        用同一份脱敏摘要，查看模型与套餐的性价比建议，了解你的套餐额度有没有变化、和同套餐平均值差多少。
      </p>
      <div className="vbti-opencost-links">
        <a href="/#compare">
          <span>01</span>模型性价比 <b aria-hidden="true">↗</b>
        </a>
        <a href="/#plans">
          <span>02</span>套餐怎么选 <b aria-hidden="true">↗</b>
        </a>
        <a href="/#feedback">
          <span>03</span>我的额度与反馈 <b aria-hidden="true">↗</b>
        </a>
      </div>
      <a className="vbti-opencost-home" href="/#overview">
        去 OpenCost-AI 看看 →
      </a>
    </section>
  );
}
