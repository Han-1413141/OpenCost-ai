// OECD FORD 2015 Table 2.2: subject coverage, not an AI difficulty scale.
export const workSubjectCatalogue = {
  version: 'work-subjects-ford-2015-1',
  source:
    'https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf',
  sourceLocation: 'Table 2.2, printed page 59',
  purpose: 'subject_coverage_only',
  difficultyScale: false,
  exhaustiveAiUseClaims: false,
  finerExtensions: 'versioned_review_required; do_not_guess_unregistered_subjects',
  groups: [
    {
      id: '1',
      label: '自然科学',
      fields: [
        ['1.1', '数学'],
        ['1.2', '计算机与信息科学'],
        ['1.3', '物理科学'],
        ['1.4', '化学科学'],
        ['1.5', '地球与环境科学'],
        ['1.6', '生物科学'],
        ['1.7', '其他自然科学'],
      ],
    },
    {
      id: '2',
      label: '工程与技术',
      fields: [
        ['2.1', '土木工程'],
        ['2.2', '电气、电子与信息工程'],
        ['2.3', '机械工程'],
        ['2.4', '化学工程'],
        ['2.5', '材料工程'],
        ['2.6', '医学工程'],
        ['2.7', '环境工程'],
        ['2.8', '环境生物技术'],
        ['2.9', '工业生物技术'],
        ['2.10', '纳米技术'],
        ['2.11', '其他工程与技术'],
      ],
    },
    {
      id: '3',
      label: '医学与健康科学',
      fields: [
        ['3.1', '基础医学'],
        ['3.2', '临床医学'],
        ['3.3', '健康科学'],
        ['3.4', '医学生物技术'],
        ['3.5', '其他医学科学'],
      ],
    },
    {
      id: '4',
      label: '农业与兽医科学',
      fields: [
        ['4.1', '农业、林业与渔业'],
        ['4.2', '畜牧与乳业科学'],
        ['4.3', '兽医科学'],
        ['4.4', '农业生物技术'],
        ['4.5', '其他农业科学'],
      ],
    },
    {
      id: '5',
      label: '社会科学',
      fields: [
        ['5.1', '心理学与认知科学'],
        ['5.2', '经济与商业'],
        ['5.3', '教育'],
        ['5.4', '社会学'],
        ['5.5', '法律'],
        ['5.6', '政治学'],
        ['5.7', '社会与经济地理'],
        ['5.8', '媒体与传播'],
        ['5.9', '其他社会科学'],
      ],
    },
    {
      id: '6',
      label: '人文与艺术',
      fields: [
        ['6.1', '历史与考古'],
        ['6.2', '语言与文学'],
        ['6.3', '哲学、伦理与宗教'],
        ['6.4', '艺术、艺术史、表演艺术与音乐'],
        ['6.5', '其他人文学科'],
      ],
    },
  ],
  useContexts: ['occupational', 'education', 'personal', 'unknown'],
  classificationAxes: ['work_activity', 'subject', 'use_context'],
  boundaries: [
    '工作活动说明做什么，学科说明材料和问题涉及什么；学科代码不提高难度',
    '日常生活、服务和组织活动不必属于研发；未确定学科保持 unknown',
    '材料支持、模拟、数字操作与实物动作分开；没有执行证据不声明完成实物工作',
    '目录覆盖和文献覆盖分别报告；没有直接研究的子类型登记研究缺口',
  ],
} as const;
export const workSubjects = workSubjectCatalogue.groups.flatMap((g) =>
  g.fields.map(([id, label]) => ({ id, label, group: g.id })),
);
export const workSubjectIds = workSubjects.map((s) => s.id) as [string, ...string[]];
