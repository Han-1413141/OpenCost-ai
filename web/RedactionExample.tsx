export function RedactionExample() {
  return (
    <figure className="vbti-redaction" aria-label="脱敏前后示例">
      <figcaption>
        <b>脱敏摘要示例</b>
      </figcaption>
      <div className="vbti-redaction-before">
        <div className="vbti-mini-window">
          <i />
          <i />
          <i />
          <span>你的 Harness</span>
        </div>
        <div className="vbti-redaction-line">
          <span>项目名称</span>
          <i className="redacted wide" />
          <b>不上传</b>
        </div>
        <div className="vbti-redaction-line">
          <span>原始对话</span>
          <i className="redacted" />
          <b>不上传</b>
        </div>
        <div className="vbti-redaction-line">
          <span>源码 / 路径</span>
          <i className="redacted wide" />
          <b>不上传</b>
        </div>
        <div className="vbti-redaction-line">
          <span>账号 / 密钥</span>
          <i className="redacted" />
          <b>不上传</b>
        </div>
      </div>
      <div className="vbti-redaction-arrow">
        <span aria-hidden="true">↓</span>
        <b>在你的 Harness 中整理</b>
      </div>
      <div className="vbti-redaction-after">
        <div className="vbti-mini-window">
          <span>OpenCost 收到的摘要</span>
          <b>✓</b>
        </div>
        <dl>
          <div>
            <dt>工作类别</dt>
            <dd>问题修复</dd>
          </div>
          <div>
            <dt>完成记录</dt>
            <dd>1</dd>
          </div>
          <div>
            <dt>输入 Token</dt>
            <dd>2,400</dd>
          </div>
          <div>
            <dt>输出 Token</dt>
            <dd>800</dd>
          </div>
        </dl>
      </div>
      <div className="vbti-redaction-confirm">
        <span aria-hidden="true">✓</span>
        <b>预览确认后上传</b>
      </div>
    </figure>
  );
}
