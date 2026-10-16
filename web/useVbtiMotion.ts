import { useEffect, useRef } from 'react';

/** Optional presentation effects; no listeners or animation loop on the original page. */
export function useVbtiMotion(enabled: boolean, paused: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = root.current;
    if (!enabled || !page) return;
    const scene = page.querySelector<HTMLElement>('.vbti-hero');
    if (!scene) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let running = false;
    let sceneVisible = true;
    let x = 0;
    let y = 0;
    const render = () => {
      frame = 0;
      scene.style.setProperty('--scene-x', x.toFixed(3));
      scene.style.setProperty('--scene-y', y.toFixed(3));
      scene.style.setProperty('--light-x', `${50 + x * 40}%`);
      scene.style.setProperty('--light-y', `${50 + y * 40}%`);
    };
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      x = y = 0;
      render();
    };
    const update = () => {
      running = !paused && !reduced.matches && !document.hidden;
      page.dataset.motionRunning = String(running);
      scene.dataset.sceneRunning = String(running && sceneVisible);
      if (!running) reset();
    };
    const move = (event: PointerEvent) => {
      if (!running || !sceneVisible || !pointer.matches) return;
      const rect = scene.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      if (!frame) frame = requestAnimationFrame(render);
    };
    const revealElements = [
      ...page.querySelectorAll<HTMLElement>(
        '.vbti-quest-steps, .vbti-section-heading, .vbti-benefits article, .vbti-character-grid button, .vbti-bottom-cta',
      ),
    ];
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.motionRevealed = 'true';
            reveal.unobserve(entry.target);
          }
      },
      { threshold: 0.08, rootMargin: '0px 0px -18px 0px' },
    );
    revealElements.forEach((element, index) => {
      element.dataset.motionReveal = 'true';
      element.style.setProperty('--reveal-delay', `${(index % 5) * 50}ms`);
      if (element.getBoundingClientRect().top < window.innerHeight) {
        element.dataset.motionRevealed = 'true';
      } else reveal.observe(element);
    });
    const visibility = new IntersectionObserver(([entry]) => {
      sceneVisible = entry.isIntersecting;
      update();
    });
    visibility.observe(scene);
    scene.addEventListener('pointermove', move, { passive: true });
    scene.addEventListener('pointerleave', reset);
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      reset();
      reveal.disconnect();
      visibility.disconnect();
      scene.removeEventListener('pointermove', move);
      scene.removeEventListener('pointerleave', reset);
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      revealElements.forEach((element) => {
        delete element.dataset.motionReveal;
        delete element.dataset.motionRevealed;
        element.style.removeProperty('--reveal-delay');
      });
      delete page.dataset.motionRunning;
      delete scene.dataset.sceneRunning;
    };
  }, [enabled, paused]);
  return root;
}
