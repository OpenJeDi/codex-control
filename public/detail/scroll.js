function isNearBottom(el, threshold = 220) {
  if (!el) return false;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function createDetailScrollController({ detailElement, getRequestSeq }) {
  let scrollStabilitySeq = 0;
  let programmaticScrollUntil = 0;

  const currentRequestSeq = () => Number(getRequestSeq?.() ?? 0);
  const currentScroller = () => detailElement?.querySelector('.detail-shell .detail') ?? null;

  function markProgrammaticScroll(duration = 450) {
    programmaticScrollUntil = Math.max(programmaticScrollUntil, Date.now() + duration);
  }

  function markUserScrollIntent() {
    if (Date.now() > programmaticScrollUntil) scrollStabilitySeq += 1;
  }

  function updateJumpBottomButton(scroller = currentScroller()) {
    const button = detailElement?.querySelector('.jump-bottom');
    if (!button || !scroller) return;
    const canScroll = scroller.scrollHeight > scroller.clientHeight + 1;
    const atBottom = isNearBottom(scroller);
    const shouldShowButton = canScroll && !atBottom;
    button.hidden = !shouldShowButton;
    button.disabled = !shouldShowButton;
  }

  function scrollElementToBottom(scroller, {
    smooth = false,
    requestSeq = currentRequestSeq(),
    stabilitySeq = scrollStabilitySeq,
  } = {}) {
    if (!scroller) return;
    const apply = (behavior = 'auto') => {
      if (requestSeq !== currentRequestSeq() || stabilitySeq !== scrollStabilitySeq) return;
      markProgrammaticScroll();
      scroller.scrollTo({ top: scroller.scrollHeight + scroller.clientHeight, behavior });
      updateJumpBottomButton(scroller);
    };
    apply(smooth ? 'smooth' : 'auto');
    requestAnimationFrame(() => apply());
    requestAnimationFrame(() => requestAnimationFrame(() => apply()));
    scroller.querySelectorAll('img, video').forEach((media) => {
      const loaded = media.tagName === 'IMG' ? media.complete : media.readyState >= 1;
      if (loaded) return;
      media.addEventListener('load', () => apply(), { once: true });
      media.addEventListener('loadedmetadata', () => apply(), { once: true });
    });
  }

  function scrollDetailToBottom({ smooth = false } = {}) {
    const scroller = currentScroller();
    if (!scroller) return;
    const stabilitySeq = ++scrollStabilitySeq;
    scrollElementToBottom(scroller, { smooth, stabilitySeq });
  }

  function captureScrollAnchor(scroller) {
    if (!scroller) return null;
    const turns = [...scroller.querySelectorAll('.turn[data-turn-id]')];
    const top = scroller.getBoundingClientRect().top;
    let best = null;
    for (const turn of turns) {
      const rect = turn.getBoundingClientRect();
      if (rect.bottom < top) continue;
      best = {
        turnId: turn.dataset.turnId,
        offset: rect.top - top,
      };
      break;
    }
    return best;
  }

  function restoreScrollAnchor(scroller, anchor, fallbackScrollTop = 0) {
    if (!scroller) return;
    if (!anchor?.turnId) {
      markProgrammaticScroll();
      scroller.scrollTop = fallbackScrollTop;
      return;
    }
    const target = scroller.querySelector(`.turn[data-turn-id="${CSS.escape(anchor.turnId)}"]`);
    if (!target) {
      markProgrammaticScroll();
      scroller.scrollTop = fallbackScrollTop;
      return;
    }
    const top = scroller.getBoundingClientRect().top;
    const rect = target.getBoundingClientRect();
    markProgrammaticScroll();
    scroller.scrollTop += rect.top - top - anchor.offset;
  }

  function restoreState(scroller, {
    anchor,
    fallbackScrollTop = 0,
    followBottom = false,
    requestSeq = currentRequestSeq(),
    stabilitySeq = scrollStabilitySeq,
  } = {}) {
    if (!scroller) return;
    if (followBottom) scrollElementToBottom(scroller, { requestSeq, stabilitySeq });
    else restoreScrollAnchor(scroller, anchor, fallbackScrollTop);
    updateJumpBottomButton(scroller);
  }

  function stabilizeAfterMediaLayout(scroller, requestSeq, anchor, fallbackScrollTop, stabilitySeq) {
    if (!scroller || !anchor?.turnId) return;
    const restore = () => {
      if (requestSeq !== currentRequestSeq()) return;
      if (stabilitySeq !== scrollStabilitySeq) return;
      restoreState(scroller, { anchor, fallbackScrollTop, requestSeq, stabilitySeq });
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
    scroller.querySelectorAll('img, video').forEach((media) => {
      media.addEventListener('load', restore, { once: true });
      media.addEventListener('loadedmetadata', restore, { once: true });
    });
  }

  function bindControls() {
    const scroller = currentScroller();
    const button = detailElement?.querySelector('.jump-bottom');
    if (!scroller || !button) return;
    scroller.addEventListener('scroll', () => updateJumpBottomButton(scroller), { passive: true });
    scroller.addEventListener('wheel', markUserScrollIntent, { passive: true });
    scroller.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    scroller.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    scroller.addEventListener('keydown', markUserScrollIntent);
    button.addEventListener('click', () => scrollDetailToBottom());
    updateJumpBottomButton(scroller);
    requestAnimationFrame(() => updateJumpBottomButton(scroller));
  }

  return {
    get stabilitySeq() {
      return scrollStabilitySeq;
    },
    isNearBottom,
    captureScrollAnchor,
    restoreState,
    stabilizeAfterMediaLayout,
    bindControls,
  };
}
