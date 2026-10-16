import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { PixelPersona } from '../shared/PixelPersona';
import { personaCatalog } from '../shared/feedback-persona';
import { t } from './i18n/locale';

// Preserve the three familiar cover characters, then show every other type once.
const order = [0, 3, 30, ...personaCatalog.map((_, i) => i).filter((i) => ![0, 3, 30].includes(i))];
export const personaCarouselPages = Math.ceil(order.length / 3);
export function personaCarouselGroup(page: number) {
  const normalized = ((page % personaCarouselPages) + personaCarouselPages) % personaCarouselPages;
  return Array.from({ length: 3 }, (_, slot) => order[(normalized * 3 + slot) % order.length]);
}

export function VBTIPersonaCarousel() {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    const visibility = () => setHidden(document.hidden);
    motion();
    visibility();
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const playing = !paused && !hovered && !focused && !hidden && !reducedMotion;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setPage((value) => (value + 1) % personaCarouselPages),
      8000,
    );
    return () => window.clearInterval(timer);
  }, [playing, page]);
  const move = (delta: number) => {
    setPaused(true);
    setPage((value) => (value + delta + personaCarouselPages) % personaCarouselPages);
  };
  return (
    <section
      className="vbti-hero-art vbti-persona-carousel"
      aria-label="VBTI 角色轮播"
      aria-roledescription={t('轮播')}
      data-playing={playing}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="vbti-hero-orbit" aria-hidden="true" />
      <div className="vbti-pixel-cloud cloud-one" aria-hidden="true" />
      <div className="vbti-pixel-cloud cloud-two" aria-hidden="true" />
      <span className="vbti-spark spark-one" aria-hidden="true">
        ✦
      </span>
      <span className="vbti-spark spark-two" aria-hidden="true">
        +
      </span>
      <div className="vbti-character-platform" aria-hidden="true" />
      <div className="vbti-hero-speech">32 种画风，你是哪一种？</div>
      <div className="vbti-carousel-cards" aria-live="off">
        {personaCarouselGroup(page).map((index, slot) => {
          const [code, name, line] = personaCatalog[index];
          return (
            <article className={`vbti-persona-card persona-slot-${slot}`} key={slot}>
              <div className="vbti-persona-card-content" key={code}>
                <div className="vbti-persona-card-id">
                  <span>#{String(index + 1).padStart(2, '0')}</span>
                  <b>{code}</b>
                  <span aria-hidden="true">✦</span>
                </div>
                <div className="vbti-persona-portrait">
                  <PixelPersona index={index} />
                </div>
                <h2>{name}</h2>
                <p>{line}</p>
              </div>
            </article>
          );
        })}
      </div>
      <div className="vbti-carousel-controls">
        <button type="button" aria-label="上一组角色" onClick={() => move(-1)}>
          <ChevronLeft size={16} />
        </button>
        <span
          className="vbti-carousel-counter"
          aria-label={t(`第 ${page + 1} 组，共 ${personaCarouselPages} 组`)}
        >
          <b>{String(page + 1).padStart(2, '0')}</b>
          <span>/ {personaCarouselPages}</span>
        </span>
        <button type="button" aria-label="下一组角色" onClick={() => move(1)}>
          <ChevronRight size={16} />
        </button>
        {!reducedMotion && (
          <button
            className="vbti-carousel-pause"
            type="button"
            aria-label={paused ? '播放轮播' : '暂停轮播'}
            aria-pressed={paused}
            onClick={() => {
              setPaused((value) => !value);
              setFocused(false);
              setHovered(false);
            }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
        <span className="vbti-carousel-total">32 TYPES</span>
      </div>
    </section>
  );
}
