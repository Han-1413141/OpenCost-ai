import { useEffect, useState } from 'react';
import type { VbtiCommunity } from '../shared/vbti-community.js';
import { api } from './api.js';
let cached: { at: number; data: VbtiCommunity } | null = null;
let pending: Promise<VbtiCommunity> | null = null;
function read() {
  if (cached && Date.now() - cached.at < (cached.data.status === 'ready' ? 30000 : 1000))
    return Promise.resolve(cached.data);
  if (!pending)
    pending = api('/api/vbti/unlocks')
      .then(async (value) => {
        const { VbtiCommunitySchema } = await import('../shared/vbti-community.js');
        const data = VbtiCommunitySchema.parse(value);
        cached = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}
export function useVbtiCommunity(enabled = true) {
  const [data, setData] = useState<VbtiCommunity | null>(null);
  useEffect(() => {
    if (!enabled || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
    let active = true,
      attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      void read()
        .then((value) => {
          if (!active) return;
          setData(value);
          if (value.status === 'updating' && ++attempts < 6) timer = setTimeout(run, 5000);
        })
        .catch(() => {
          /* Unknown stays unknown, never display fabricated zero users. */
        });
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return data;
}
