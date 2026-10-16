import type { PersonalFeedback } from './personal-feedback.js';

export const personaCatalog = [
  [
    'BOSS',
    '赛博包工头',
    '活可以不亲自干，但子代理得交作业。',
    '至少 3 个代理参与，且存在父子代理层级',
  ],
  ['CHECK', '细节判官', 'AI 说做完了？先把证据端上来。', '任务要求形式验证'],
  ['FIX', '报错驱魔师', '报错可以吓人，但今天谁也别想装没看见。', '任务要求诊断分析'],
  ['DIG', '资料囤囤鼠', '再存一篇，真的就最后一篇。', '任务要求检索，或记录了已完成的研究工作'],
  ['DATA', '表格炼金师', '给我一堆数，还你一点眉目。', '任务要求统计推断'],
  ['SPEED', '性能榨汁机', '还能快一点？那就再挤一滴。', '任务要求优化，或包含性能约束'],
  ['SIM', '平行宇宙导演', '现实只活一次，仿真先跑十种剧情。', '任务要求仿真'],
  ['BRIDGE', '接口和事佬', '你俩别吵了，先把数据格式对上。', '任务要求跨系统集成'],
  [
    'ART',
    '脑洞施工队',
    '别人说有个想法，你已经开始上色。',
    '任务要求多模态对齐，或记录了已完成的视觉创作',
  ],
  ['WRITE', '文案气氛组', '这段话差点意思？我给它加点人味。', '记录了已完成的写作、编辑或翻译工作'],
  ['BUILD', '从零起楼侠', '文件夹空空，脑子里已经封顶。', '任务要求构建，或记录了已完成的开发工作'],
  ['LEGO', '需求拆迁队', '大需求先别慌，拆开之后逐个安排。', '已记录至少 4 个任务组成部分'],
  ['SHIELD', '漏洞守门员', '这道门想进可以，先过我的规矩。', '任务包含安全约束'],
  ['REF', '出处追债人', '话说得挺好，出处呢？', '任务要求来源可追溯'],
  ['FORMAT', '格式驯兽师', '内容随便跑，格式必须站整齐。', '任务要求转换，或包含格式约束'],
  [
    'PATCH',
    '兼容性端水大师',
    '新老系统都是家人，一个也不能掉队。',
    '任务要求适配已有方案，或包含兼容性约束',
  ],
  ['CLASH', '需求劝架大师', '两条需求打起来了，先让我劝劝。', '记录中明确存在需求冲突'],
  ['LOST', '材料失踪案侦探', '线索少一半，案子还得往下办。', '记录中明确存在材料缺失'],
  ['NOISE', '杂音过滤仙人', '材料叽叽喳喳，重点自己站出来。', '记录中明确存在材料噪声'],
  ['NEW', '祖传方案终结者', '以前都这么做？今天试试别的。', '任务要求构造新方案'],
  ['REUSE', '模板续命大师', '祖传模板别扔，还能再战一轮。', '任务明确复用已知方案或模板'],
  ['DEEP', '论文深海潜水员', '资料区太浅，往研究深处游一会儿。', '任务明确要求研究性知识'],
  ['EXPERT', '专业课代表', '通用答案先等等，这题得上专业的。', '任务明确要求专业知识'],
  ['CHAIN', '思路十八弯', '不是绕远路，是这题真得拐几个弯。', '任务明确要求多步推理'],
  ['PROOF', '证明题钉子户', '看起来对还不行，逻辑得走到最后。', '任务明确要求形式化论证'],
  ['OPEN', '脑洞不打烊', '标准答案没营业？那就自己开一家。', '任务明确要求开放式推断'],
  ['BUDGET', '算力铁算盘', '资源有上限，算盘没有下班时间。', '任务包含资源上限约束'],
  ['CLOCK', '截止日特种兵', '时间写进需求，行动立刻进入倒计时。', '任务包含截止时间约束'],
  ['ACCESS', '全民通关设计师', '别把门槛做成关卡，让大家都能进来。', '任务包含无障碍约束'],
  ['CHAT', '对话连续剧主演', '这段对话还有下一集，而且你是主演。', '记录了至少 10 轮用户对话'],
  ['TOOL', '工具箱八爪鱼', '手里没点工具，都不好意思接这活。', '记录了至少 10 次工具调用'],
  ['NEST', '代理套娃厂长', '我找个代理，代理说它也找了个代理。', '记录的代理最大层级至少为 2'],
] as const;
export type PersonaCode = (typeof personaCatalog)[number][0];
export type WorkPersona = {
  code: PersonaCode;
  name: string;
  line: string;
  rule: string;
  sprite: number;
  evidence: string[];
};
export type PersonaInput = Pick<PersonalFeedback, 'metrics' | 'work' | 'taskProfile'>;
/** Independent rules; several types can match. Spending never implies ability. */
export function feedbackPersonas(report: PersonaInput): WorkPersona[] {
  const metric = (id: string) => report.metrics.find((m) => m.id === id)?.value ?? null;
  const work = report.work.filter((w) => (w.completed ?? 0) > 0);
  const count = (field: string, value: string) =>
    report.taskProfile?.requirements.find((r) => r.field === field && r.value === value)?.tasks ??
    0;
  const hits = new Map<PersonaCode, number>();
  let evaluating: PersonaCode | null = null;
  const has = (field: string, value: string) => {
    const n = count(field, value);
    if (evaluating) hits.set(evaluating, Math.max(hits.get(evaluating) ?? 0, n));
    return n > 0;
  };
  const any = (...values: boolean[]) => values.some(Boolean);
  const method = (value: string) => has('methodFamilies', value),
    constraint = (value: string) => has('constraintKinds', value);
  const label = (pattern: RegExp) => {
    const n = work.filter((w) => pattern.test(w.label)).length;
    if (evaluating) hits.set(evaluating, Math.max(hits.get(evaluating) ?? 0, n));
    return n > 0;
  };
  const agents = metric('agents'),
    depth = metric('depth'),
    turns = metric('turns') ?? metric('user_turns'),
    tools = metric('tool_calls'),
    roots = metric('root_agents'),
    children =
      agents !== null && roots !== null && roots >= 1 && roots <= agents ? agents - roots : null,
    parts =
      report.taskProfile?.componentMaximum ??
      (report.taskProfile?.components.known === 1 ? report.taskProfile.components.value : null);
  const match = (code: PersonaCode, evaluate: () => boolean) => {
    evaluating = code;
    const result = evaluate();
    evaluating = null;
    return result;
  };
  const matches: Record<PersonaCode, boolean> = {
    BOSS: depth !== null && (depth >= 2 || (depth >= 1 && children !== null && children >= 2)),
    CHECK: match('CHECK', () => method('formal_verification')),
    FIX: match('FIX', () => method('diagnosis')),
    DIG: match('DIG', () => any(method('retrieval'), label(/研究|调研|检索/))),
    DATA: match('DATA', () => method('statistical_inference')),
    SPEED: match('SPEED', () => any(method('optimization'), constraint('performance'))),
    SIM: match('SIM', () => method('simulation')),
    BRIDGE: match('BRIDGE', () => method('cross_system_integration')),
    ART: match('ART', () => any(method('multimodal_alignment'), label(/视觉|图像|视频|音频|设计/))),
    WRITE: match('WRITE', () => label(/写作|编辑|翻译|文案/)),
    BUILD: match('BUILD', () => any(method('construction'), label(/开发|功能/))),
    LEGO: match('LEGO', () => parts !== null && parts >= 4),
    SHIELD: match('SHIELD', () => constraint('security')),
    REF: match('REF', () => constraint('source_traceability')),
    FORMAT: match('FORMAT', () => any(method('transformation'), constraint('format'))),
    PATCH: match('PATCH', () =>
      any(has('solutionNovelty', 'adaptation'), constraint('compatibility')),
    ),
    CLASH: match('CLASH', () => has('clarity', 'conflicting')),
    LOST: match('LOST', () => has('inputCondition', 'missing')),
    NOISE: match('NOISE', () => has('inputCondition', 'noisy')),
    NEW: match('NEW', () => has('solutionNovelty', 'new_solution')),
    REUSE: match('REUSE', () =>
      any(has('solutionNovelty', 'repeat'), has('contextReuse', 'template_based')),
    ),
    DEEP: match('DEEP', () => has('knowledge', 'research')),
    EXPERT: match('EXPERT', () => has('knowledge', 'specialist')),
    CHAIN: match('CHAIN', () => has('reasoning', 'multi_step')),
    PROOF: match('PROOF', () => has('reasoning', 'formal')),
    OPEN: match('OPEN', () => has('reasoning', 'open_ended')),
    BUDGET: match('BUDGET', () => constraint('resource_limit')),
    CLOCK: match('CLOCK', () => constraint('deadline')),
    ACCESS: match('ACCESS', () => constraint('accessibility')),
    CHAT: turns !== null && turns >= 10,
    TOOL: tools !== null && tools >= 10,
    NEST: depth !== null && depth >= 2,
  };
  const evidence: Partial<Record<PersonaCode, string[]>> = {
    BOSS: [`记录了 ${agents} 次代理参与，最大层级 ${depth}`],
    LEGO: [`单项任务最多包含 ${parts} 个组成部分`],
    CHAT: [`已记录 ${turns} 轮用户对话`],
    TOOL: [`已记录 ${tools} 次工具调用`],
    NEST: [`最大代理层级 ${depth}`],
  };
  const priority: PersonaCode[] = [
    'NEST',
    'BOSS',
    'CHECK',
    'FIX',
    'DATA',
    'SPEED',
    'SIM',
    'BRIDGE',
    'ART',
    'WRITE',
    'DIG',
    'NEW',
    'CLASH',
    'LOST',
    'NOISE',
    'PROOF',
    'OPEN',
    'REF',
    'SHIELD',
    'FORMAT',
    'LEGO',
    'BUILD',
    'PATCH',
    'REUSE',
    'DEEP',
    'EXPERT',
    'CHAIN',
    'BUDGET',
    'CLOCK',
    'ACCESS',
    'CHAT',
    'TOOL',
  ];
  const denominators = Math.max(3, report.taskProfile?.totalTasks ?? report.work.length);
  const support = (code: PersonaCode) => {
    if (code === 'NEST') return Math.min(1, (depth ?? 0) / 4);
    if (code === 'BOSS')
      return children !== null && agents ? children / agents : Math.min(1, (depth ?? 0) / 4);
    if (code === 'LEGO') return (report.taskProfile?.decompositionIndex ?? 0) / 100;
    if (code === 'CHAT') return turns === null ? 0 : turns / (turns + 20);
    if (code === 'TOOL') {
      const density = turns && tools !== null ? tools / turns : 0;
      return density / (density + 4);
    }
    return (hits.get(code) ?? 0) / denominators;
  };
  return personaCatalog
    .flatMap(([code, name, line, rule], sprite) =>
      matches[code]
        ? [
            {
              code,
              name,
              line,
              rule,
              sprite,
              evidence: evidence[code] ?? [rule, `相关特征出现于 ${hits.get(code) ?? 0} 项记录`],
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        support(b.code) - support(a.code) || priority.indexOf(a.code) - priority.indexOf(b.code),
    );
}
export const feedbackPersona = (report: PersonaInput) => feedbackPersonas(report)[0] ?? null;
