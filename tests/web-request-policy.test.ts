import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ApiError, api } from '../web/api.js';
import { PageRequests, resolveExploreSource, usesExplorePage } from '../web/request-policy.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('仅榜单页面需要 explore，预览必须由服务端明确开放', () => {
  for (const page of ['method', 'connect', 'contribute', 'workspace', 'aa'])
    assert.equal(usesExplorePage(page), false, page);
  for (const page of [
    'overview',
    'compare',
    'ranking',
    'plans',
    'harness',
    'process',
    'trends',
    'recommend',
  ])
    assert.equal(usesExplorePage(page), true, page);
  assert.equal(resolveExploreSource('?preview=1', true), 'demo');
  for (const status of [false, undefined, null, 'true', 1])
    assert.equal(resolveExploreSource('?preview=1', status), 'community');
  assert.equal(resolveExploreSource('', true), 'community');
});

test('榜单跨页面复用同一结果，显式刷新才增加请求', async () => {
  let calls = 0;
  const requests = new PageRequests(async (path) => ({ path, version: ++calls }));
  const path = '/api/explore?source=community&evidence=verified';
  const first = await requests.read(path);
  for (const page of ['compare', 'plans', 'trends', 'ranking']) {
    assert.equal(usesExplorePage(page), true);
    assert.equal(await requests.read(path), first);
  }
  requests.cancel();
  assert.equal(await requests.read(path), first, '离开页面后仍保留成功结果');
  assert.equal(calls, 1);
  requests.invalidate(path);
  assert.equal((await requests.read(path)).version, 2);
  assert.equal(calls, 2);
});

test('AA 和目录只按选择请求，返回已读 tab 复用，刷新不牵连另一来源', async () => {
  const calls: string[] = [];
  const requests = new PageRequests(async (path) => {
    calls.push(path);
    return { path, version: calls.length };
  }, 2);
  const aa = await requests.read('/api/aa');
  assert.deepEqual(calls, ['/api/aa']);
  const catalog = await requests.read('/api/catalog');
  requests.cancel(); // history owns a separate, paginated request.
  assert.equal(await requests.read('/api/aa'), aa);
  assert.equal(await requests.read('/api/catalog'), catalog);
  assert.deepEqual(calls, ['/api/aa', '/api/catalog']);
  requests.invalidate('/api/catalog');
  assert.notEqual(await requests.read('/api/catalog'), catalog);
  assert.equal(await requests.read('/api/aa'), aa);
  assert.deepEqual(calls, ['/api/aa', '/api/catalog', '/api/catalog']);
});

test('相同页面的并发读取只发一个请求', async () => {
  let calls = 0;
  const response = deferred<string>();
  const requests = new PageRequests(async () => {
    calls++;
    return response.promise;
  });
  const first = requests.read('/api/aa');
  const second = requests.read('/api/aa');
  assert.equal(first, second);
  assert.equal(requests.busy, true);
  await Promise.resolve();
  assert.equal(calls, 1);
  response.resolve('saved');
  assert.equal(await first, 'saved');
  assert.equal(requests.busy, false);
});

test('切换页面取消旧请求，迟到响应不能缓存，也不能释放新请求状态', async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  const seen: { path: string; signal: AbortSignal }[] = [];
  const requests = new PageRequests((path, signal) => {
    seen.push({ path, signal });
    return seen.length === 1 ? old.promise : current.promise;
  }, 2);
  const first = requests.read('/api/aa');
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await Promise.resolve();
  requests.cancel();
  const second = requests.read('/api/catalog');
  await Promise.resolve();
  assert.equal(seen[0].signal.aborted, true);
  old.resolve('late');
  await rejected;
  assert.equal(requests.busy, true);
  current.resolve('current');
  assert.equal(await second, 'current');
  assert.equal(await requests.read('/api/aa'), 'current');
  assert.equal(seen.length, 3, '被取消的旧数据没有写入缓存');
});

test('尚未发出就取消，不产生请求；失败结果不会阻止用户重试', async () => {
  let calls = 0;
  const requests = new PageRequests(async () => {
    calls++;
    if (calls === 1) throw new Error('temporary');
    return 'ready';
  });
  const cancelled = requests.read('/api/aa');
  requests.cancel();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(requests.read('/api/aa'), /temporary/);
  assert.equal(requests.busy, false);
  assert.equal(await requests.read('/api/aa'), 'ready');
  assert.equal(calls, 2);
});

test('单份榜单缓存不会混用来源，缓存数量有明确上限', async () => {
  let calls = 0;
  const requests = new PageRequests(async (path) => ({ path, version: ++calls }));
  const community = await requests.read('community');
  const demo = await requests.read('demo');
  assert.notEqual(demo, community);
  assert.equal(demo.path, 'demo');
  assert.equal((await requests.read('community')).version, 3);
  assert.throws(() => new PageRequests(async () => '', 0));
  assert.throws(() => new PageRequests(async () => '', 3));
});

test('已有外部 signal 仍执行 15 秒截止时间，并移除取消监听', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    signal = options.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const pending = api('/api/aa', { signal: caller.signal });
  const rejected = assert.rejects(pending, { name: 'TimeoutError', message: /15/ });
  assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(caller.signal.aborted, false);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('公开聚合与个人反馈 GET 含查询参数均使用 35 秒截止，不提前取消或自动重试', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    calls++;
    signal = options.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const paths = [
    '/api/explore',
    '/api/rankings',
    '/api/comparisons',
    '/api/summaries',
    '/api/feedback',
    '/api/feedback/mine',
  ];
  for (const path of paths) {
    for (const query of ['', '?source=community&evidence=verified']) {
      const before = calls;
      const caller = new AbortController();
      const pending = api(path + query, { signal: caller.signal, method: 'GET' });
      const rejected = assert.rejects(pending, { name: 'TimeoutError', message: /35/ });
      t.mock.timers.tick(15000);
      assert.equal(signal.aborted, false, path + query);
      t.mock.timers.tick(19999);
      assert.equal(signal.aborted, false, path + query);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(caller.signal.aborted, false);
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
      t.mock.timers.runAll();
      assert.equal(calls, before + 1, '超时不会自动重试');
    }
  }
});

test('其他请求及聚合路径 POST 仍使用 15 秒截止，路径前缀不扩大范围', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    signal = options.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const requests = [
    { path: '/api/aa' },
    { path: '/api/catalog?refresh=1' },
    { path: '/api/contributions/index' },
    { path: '/api/explore/other' },
    { path: '/api/feedback/mine/other' },
    ...[
      '/api/explore',
      '/api/rankings',
      '/api/comparisons',
      '/api/summaries',
      '/api/feedback',
      '/api/feedback/mine',
    ].map((path) => ({ path: path + '?source=community', method: 'POST' })),
  ];
  for (const request of requests) {
    const pending = api(request.path, { method: 'method' in request ? request.method : 'GET' });
    const rejected = assert.rejects(pending, { name: 'TimeoutError', message: /15/ });
    t.mock.timers.tick(14999);
    assert.equal(signal.aborted, false, request.path);
    t.mock.timers.tick(1);
    await rejected;
  }
});

test('超时覆盖响应正文读取，收到响应头不会提前清除 deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reading = deferred<void>();
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => ({
    ok: true,
    json: () => {
      reading.resolve();
      return new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      });
    },
  }));
  const pending = api('/api/aa');
  const rejected = assert.rejects(pending, { name: 'TimeoutError' });
  await reading.promise;
  t.mock.timers.tick(15000);
  await rejected;
});

test('聚合 GET 收到响应头后，正文仍受 35 秒截止约束', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reading = deferred<void>();
  let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    signal = options.signal!;
    return {
      ok: true,
      status: 200,
      json: () => {
        reading.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    };
  });
  const pending = api('/api/explore?source=community');
  const rejected = assert.rejects(pending, { name: 'TimeoutError', message: /35/ });
  await reading.promise;
  t.mock.timers.tick(34999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
});

test('外部取消立即终止，清除定时器并保留取消原因', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  const reason = new Error('leave page');
  t.mock.method(
    globalThis,
    'fetch',
    async (_path: unknown, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      }),
  );
  const rejected = assert.rejects(
    api('/api/explore?source=community', { signal: caller.signal }),
    (error) => error === reason,
  );
  caller.abort(reason);
  await rejected;
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  t.mock.timers.runAll();
});

test('成功及正文解析失败都释放 deadline 和外部监听器', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  const caller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    signals.push(options.signal!);
    return signals.length === 1 ? Response.json({ ready: true }) : new Response('broken json');
  });
  assert.deepEqual(await api('/api/aa', { signal: caller.signal }), { ready: true });
  await assert.rejects(api('/api/catalog', { signal: caller.signal }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.code, 'invalid_response');
    assert.doesNotMatch(error.message, /broken json|SyntaxError/);
    return true;
  });
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  t.mock.timers.runAll();
  assert.equal(
    signals.every((signal) => !signal.aborted),
    true,
  );
});

test('JSON 服务错误保留 HTTP 状态、代码及可重试标记，不自动发起重试', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let response = {
    error: '统计结果超过容量限制',
    code: 'aggregation_capacity',
    retryable: false,
  };
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json(response, { status: 503 });
  });
  for (const retryable of [false, true]) {
    response = { ...response, retryable };
    const before = calls;
    await assert.rejects(api('/api/explore'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'aggregation_capacity');
      assert.equal(error.retryable, retryable);
      assert.equal(error.message, response.error);
      return true;
    });
    t.mock.timers.runAll();
    assert.equal(calls, before + 1, '可重试标记只供界面判断，不触发自动重试');
  }
});

test('非 JSON 服务错误使用固定中文提示并保留状态，不展示代理 HTML', async (t) => {
  const messages: string[] = [];
  let response = '<html><body>private-proxy-debug-marker</body></html>';
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(response, { status: 502, headers: { 'Content-Type': 'text/html' } }),
  );
  for (const body of [response, '<h1>another-upstream-error-marker</h1>']) {
    response = body;
    await assert.rejects(api('/api/explore'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.match(error.message, /[\u4e00-\u9fff]/);
      assert.doesNotMatch(error.message, /<|>|private-proxy|another-upstream|SyntaxError/);
      messages.push(error.message);
      return true;
    });
  }
  assert.equal(messages[0], messages[1], '提示不依赖上游错误页面内容');
});

test('缺少结构化错误字段时保持缺省，不推断服务错误是否可重试', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: '没有访问权限' }, { status: 403 }),
  );
  await assert.rejects(api('/api/feedback/mine'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, undefined);
    assert.equal(error.retryable, undefined);
    assert.equal(error.message, '没有访问权限');
    return true;
  });
});

test('预取消不会调用 fetch', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({});
  });
  const caller = new AbortController();
  caller.abort();
  await assert.rejects(api('/api/aa', { signal: caller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});
