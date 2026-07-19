(function(){
'use strict';

/* â”€â”€ Scroll reveal â”€â”€ */
var io=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}
  })
},{threshold:.08,rootMargin:'0px 0px -20px 0px'});
document.querySelectorAll('[data-r]').forEach(function(el){io.observe(el)});

/* â”€â”€ Nav border on scroll â”€â”€ */
var nav=document.getElementById('js-nav');
var raf=false;
window.addEventListener('scroll',function(){
  if(raf)return;
  requestAnimationFrame(function(){
    nav.style.borderBottomColor=
      window.scrollY>60?'rgba(200,168,75,.16)':'rgba(255,255,255,.055)';
    raf=false
  });
  raf=true
},{passive:true});

/* â”€â”€ Scroll delegation â”€â”€ */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-scroll-to]');
  if(!el)return;
  var dest=document.querySelector(el.dataset.scrollTo);
  if(dest){e.preventDefault();dest.scrollIntoView({behavior:'smooth'})}
});

/* â”€â”€ Word scramble â”€â”€ */
var wordEl=document.getElementById('js-word');
if(wordEl){
  var words=['experiences','brands','stories','presence','impact','culture'];
  var idx=0,running=false;
  var chars='abcdefghijklmnopqrstuvwxyz';
  function scramble(target){
    if(running)return;running=true;
    var f=0,total=target.length*2+5;
    var t=setInterval(function(){
      wordEl.textContent=target.split('').map(function(c,i){
        return f>i*2?c:chars[Math.floor(Math.random()*chars.length)]
      }).join('');
      if(++f>=total){wordEl.textContent=target;clearInterval(t);running=false}
    },34);
  }
  setInterval(function(){idx=(idx+1)%words.length;scramble(words[idx])},2000);
}

/* â”€â”€ Audience cards â”€â”€ */
document.querySelectorAll('.aud-card').forEach(function(card){
  function select(){
    document.querySelectorAll('.aud-card').forEach(function(c){
      c.setAttribute('aria-checked','false');
      c.style.borderColor='';c.style.boxShadow='';
      var r=c.querySelector('.aud-card__radio');
      r.style.background='';r.style.borderColor='';
    });
    card.setAttribute('aria-checked','true');
    card.style.borderColor='#7C3AED';
    card.style.boxShadow='0 3px 16px rgba(109,40,217,.1)';
    var r=card.querySelector('.aud-card__radio');
    r.style.background='#7C3AED';r.style.borderColor='#7C3AED';
  }
  card.addEventListener('click',select);
  card.addEventListener('keydown',function(e){
    if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}
  });
});

/* â”€â”€ Calendar date selection â”€â”€ */
document.querySelectorAll('.cal__date:not(.cal__date--empty)').forEach(function(d){
  d.addEventListener('click',function(){
    document.querySelectorAll('.cal__date--today').forEach(function(x){
      x.classList.remove('cal__date--today')
    });
    d.classList.add('cal__date--today');
  });
});

/* â”€â”€ Book session â”€â”€ */
var bookBtn=document.getElementById('js-book');
if(bookBtn){
  bookBtn.addEventListener('click',function(){
    window.location.href='mailto:info@e4la.org?subject=Book%20a%20Session'
  });
}

/* â”€â”€ Newsletter â”€â”€ */
var nlForm=document.getElementById('js-nl');
if(nlForm){
  nlForm.addEventListener('submit',function(e){
    e.preventDefault();
    var inp=document.getElementById('nl-email');
    var sub=nlForm.querySelector('.footer__submit');
    if(!inp.value)return;
    sub.textContent='âœ“';sub.disabled=true;inp.value='';
    setTimeout(function(){sub.textContent='Go';sub.disabled=false},3000);
  });
}

}());

/* FINAL SERVICES 3D TILT — REVERSED. Cards now auto-wobble on their
   own continuously at rest (a slow, gentle, desynced drift per
   card), and freeze to perfectly flat/static the moment the card is
   hovered — the exact opposite of the original mouse-tracking-tilt-
   on-hover behavior. No more pointermove tracking at all: hovering
   just means "hold still," it doesn't drive the tilt angle anymore. */
(() => {
  const section = document.querySelector('.sec-services');
  if (!section) return;

  const cards = Array.from(section.querySelectorAll('.svc-card'));
  if (!cards.length) return;

  const canTilt = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 0.09;      // easing for both drift and freeze

  // Distinct per-card motion "personality" — different frequency
  // RATIOS (not just a time-shift of the same wave), so each card
  // traces its own genuinely different Lissajous-style path instead
  // of all 5 looking like copies of one wave offset in time. Cycled
  // by index so it also holds up if more/fewer cards are ever added.
  /* Amplitudes roughly halved from the original 3.5-4.5deg range —
     the full-strength drift read as too much motion at rest; the
     halved range keeps the alive feel but stays subtle. */
  const personalities = [
    { fx: 1.00, fy: 0.83, phase: 0.0,  amp: 2    },
    { fx: 0.64, fy: 1.21, phase: 1.7,  amp: 1.75 },
    { fx: 1.35, fy: 0.58, phase: 3.4,  amp: 2.25 },
    { fx: 0.82, fy: 1.46, phase: 5.0,  amp: 1.9  },
    { fx: 1.18, fy: 0.71, phase: 2.4,  amp: 2.1  }
  ];

  const states = new WeakMap();

  function writeVars(card, state) {
    card.style.setProperty('--svc-rx', state.currentX.toFixed(3) + 'deg');
    card.style.setProperty('--svc-ry', state.currentY.toFixed(3) + 'deg');
    card.style.setProperty('--svc-scale', state.currentScale.toFixed(4));
    card.style.setProperty('--svc-lift', state.currentLift.toFixed(2) + 'px');
  }

  function animate(card) {
    const state = states.get(card);
    if (!state) return;

    if (reduceMotion.matches || !canTilt.matches) {
      // Motion disabled/no fine pointer: stay perfectly flat, no pop.
      state.targetX = 0;
      state.targetY = 0;
      state.targetScale = 1;
      state.targetLift = 0;
    } else if (state.hovering) {
      // Hovered: ease to flat (no tilt) but pop the card outward —
      // a bit larger and lifted up, instead of just freezing flat.
      state.targetX = 0;
      state.targetY = 0;
      state.targetScale = 1.021;
      state.targetLift = -6;
    } else {
      // Idle: slow autonomous drift, each card on its own frequency
      // ratio + phase so no two ever move the same way at once.
      state.t += 0.02625;
      const p = state.personality;
      state.targetX = Math.sin(state.t * p.fx + p.phase) * p.amp;
      state.targetY = Math.cos(state.t * p.fy + p.phase) * p.amp;
      state.targetScale = 1;
      state.targetLift = 0;
    }

    state.currentX += (state.targetX - state.currentX) * ease;
    state.currentY += (state.targetY - state.currentY) * ease;
    state.currentScale += (state.targetScale - state.currentScale) * ease;
    state.currentLift += (state.targetLift - state.currentLift) * ease;

    writeVars(card, state);
    state.raf = requestAnimationFrame(() => animate(card));
  }

  function start(card) {
    const state = states.get(card);
    if (state && !state.raf) {
      state.raf = requestAnimationFrame(() => animate(card));
    }
  }

  cards.forEach((card, i) => {
    const state = {
      raf: 0,
      hovering: false,
      t: 0,
      personality: personalities[i % personalities.length],
      currentX: 0,
      currentY: 0,
      currentScale: 1,
      currentLift: 0,
      targetX: 0,
      targetY: 0,
      targetScale: 1,
      targetLift: 0
    };

    states.set(card, state);
    card.classList.remove('is-active');
    card.setAttribute('aria-expanded', 'false');
    writeVars(card, state);
    start(card);

    card.addEventListener('pointerenter', () => {
      state.hovering = true;
      card.classList.add('is-hovering');
    });
    card.addEventListener('focus', () => {
      state.hovering = true;
      card.classList.add('is-hovering');
    });
    card.addEventListener('pointerleave', () => {
      state.hovering = false;
      card.classList.remove('is-hovering');
    });
    card.addEventListener('blur', () => {
      state.hovering = false;
      card.classList.remove('is-hovering');
    });
  });

  function hardReset() {
    cards.forEach((card) => {
      const state = states.get(card);
      if (!state) return;
      if (reduceMotion.matches) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        state.currentX = state.targetX = 0;
        state.currentY = state.targetY = 0;
        state.currentScale = state.targetScale = 1;
        writeVars(card, state);
      } else {
        start(card);
      }
    });
  }

  canTilt.addEventListener?.('change', hardReset);
  reduceMotion.addEventListener?.('change', hardReset);
})();

/* FINAL MOBILE NAV MENU TOGGLE */
(() => {
  var burger = document.getElementById('js-nav-burger');
  var panel = document.getElementById('js-nav-mobile');
  if (!burger || !panel) return;

  function closeMenu() {
    burger.setAttribute('aria-expanded', 'false');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('nav-open');
  }

  function openMenu() {
    burger.setAttribute('aria-expanded', 'true');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('nav-open');
  }

  burger.addEventListener('click', function () {
    var isOpen = burger.getAttribute('aria-expanded') === 'true';
    if (isOpen) { closeMenu(); } else { openMenu(); }
  });

  panel.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  var mq = window.matchMedia('(min-width: 701px)');
  mq.addEventListener?.('change', function () {
    if (mq.matches) closeMenu();
  });
})();

/* FINAL CTA TRACING BEAM + BADGE SIZING.

   Badge sizing: the left palm circle's diameter must equal EACH
   button's own real rendered height exactly (different CTAs on this
   site have different heights, so this can't be one shared fixed
   size), flush against the left edge.

   It can NOT be read from btn.offsetHeight while the badge is at its
   real, final size — that's circular: setting the badge bigger grows
   the button (auto height), which re-fires the ResizeObserver, which
   reads the new bigger height and grows the badge again, unbounded
   (this happened once already and produced a giant badge covering
   most of the page).

   Fix: for each button, temporarily zero out the badge's own box,
   read btn.offsetHeight (now driven only by that button's real label
   + padding + whatever else the cascade applies to it — this
   stylesheet has many override layers, so this measures the true
   value directly instead of assuming which rule wins), then restore
   the badge and compute from that reading. A negative vertical
   margin equal to exactly the visual overshoot keeps the button's
   own offsetHeight unchanged no matter how large the visual badge
   is, so nothing here can feed back into itself. */
(() => {
  var buttons = document.querySelectorAll('.cta-neon');
  if (!buttons.length) return;

  var STROKE_W = 2;
  var PEAK_COUNT = 3; // exactly 3 bright spots around the full perimeter
  var SHIMMER_DUR = '2.6s';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Blend a #rrggbb color toward white by `amt` (0-1) — used to make
     the bright "shine" stops a lighter tint of the button's own neon
     color, instead of plain white. */
  function lighten(hex, amt) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return hex;
    var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* Builds (once per button) a repeating linearGradient used as the
     beam rect's stroke. Stops form ONE period (dim -> bright shine ->
     dim, a single peak, not two) and spreadMethod="repeat" tiles it
     around the whole stroke. The period length is set to exactly
     perimeter/PEAK_COUNT (updated on every layout pass, since it
     depends on that button's real measured perimeter), so there are
     always exactly PEAK_COUNT bright spots evenly spaced around the
     loop — not a dense sea-wave of many small ripples. A native SVG
     <animateTransform> continuously translates the gradient by
     exactly one period, which loops seamlessly and makes the 3
     spots appear to travel together around the border. */
  function ensureGradient(beam, idx) {
    var defs = beam.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      beam.insertBefore(defs, beam.firstChild);
    }
    var grad = defs.querySelector('linearGradient');
    if (grad) return grad;

    grad = document.createElementNS(SVG_NS, 'linearGradient');
    var gid = 'cta-beam-grad-' + idx;
    grad.setAttribute('id', gid);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('spreadMethod', 'repeat');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('y2', '0');

    [0, 50, 100].forEach(function (off) {
      var stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('offset', off + '%');
      stop.setAttribute('class', off === 50 ? 'cta-beam-stop-hi' : 'cta-beam-stop-lo');
      grad.appendChild(stop);
    });

    defs.appendChild(grad);
    beam.querySelector('rect').setAttribute('stroke', 'url(#' + gid + ')');
    return grad;
  }

  /* Sets the gradient's period to exactly perimeter/PEAK_COUNT and
     (re)creates its <animateTransform> so the change takes effect
     immediately (SMIL animations don't reliably pick up attribute
     edits on an already-running element, so this recreates it fresh
     each time the period actually changes — cheap and only happens
     on load/resize, not every frame). */
  function updateGradientPeriod(grad, period) {
    if (grad._period === period) return;
    grad._period = period;

    grad.setAttribute('x2', period.toFixed(2));

    var oldAnim = grad.querySelector('animateTransform');
    if (oldAnim) grad.removeChild(oldAnim);

    if (!reduceMotion) {
      var anim = document.createElementNS(SVG_NS, 'animateTransform');
      anim.setAttribute('attributeName', 'gradientTransform');
      anim.setAttribute('type', 'translate');
      anim.setAttribute('from', '0 0');
      anim.setAttribute('to', period.toFixed(2) + ' 0');
      anim.setAttribute('dur', SHIMMER_DUR);
      anim.setAttribute('repeatCount', 'indefinite');
      grad.appendChild(anim);
    }
  }

  function tintGradient(btn, grad) {
    var neon = getComputedStyle(btn).getPropertyValue('--neon').trim() || '#C8A84B';
    var hi = lighten(neon, 0.55);
    grad.querySelectorAll('.cta-beam-stop-lo').forEach(function (s) {
      s.setAttribute('stop-color', neon);
      s.setAttribute('stop-opacity', '.45');
    });
    grad.querySelectorAll('.cta-beam-stop-hi').forEach(function (s) {
      s.setAttribute('stop-color', hi);
      s.setAttribute('stop-opacity', '1');
    });
  }

  function layoutBadge(btn) {
    var badge = btn.querySelector('.cta-neon__badge, .btn-play__ring');
    if (!badge) return;

    /* Measure this SPECIFIC button's true natural height directly,
       with the badge's own box temporarily zeroed out first. This is
       more robust than deriving height from the label's line-height +
       assumed padding: this stylesheet has many override layers
       accumulated over a long editing history, and a per-button
       assumption (e.g. "the label always defines the flex line
       height") can silently be wrong for some buttons if something
       else in the cascade (a min-height, a different line-height,
       etc.) is actually in control for that one. Zeroing the badge
       and reading btn.offsetHeight sidesteps all of that: whatever
       actually determines this button's real height, this reads it
       directly and correctly, per button, every time. */
    var prevW = badge.style.width;
    var prevH = badge.style.height;
    var prevMinW = badge.style.minWidth;
    var prevMinH = badge.style.minHeight;
    var prevMargin = badge.style.margin;

    badge.style.width = '0px';
    badge.style.height = '0px';
    badge.style.minWidth = '0px';
    badge.style.minHeight = '0px';
    badge.style.margin = '0px';

    var naturalH = btn.offsetHeight; // forced reflow; badge contributes ~0 here

    badge.style.width = prevW;
    badge.style.height = prevH;
    badge.style.minWidth = prevMinW;
    badge.style.minHeight = prevMinH;
    badge.style.margin = prevMargin;

    if (!naturalH) return;

    var cs = getComputedStyle(btn);
    var padTop = parseFloat(cs.paddingTop) || 0;
    var padBottom = parseFloat(cs.paddingBottom) || 0;
    var padLeft = parseFloat(cs.paddingLeft) || 0;
    var borderW = parseFloat(cs.borderTopWidth) || 0;

    /* badgeD = naturalH minus only the border (the exact padding-box
       height — flush to the inner edge of the border on all sides).
       marginY cancels exactly the badge's added height beyond the
       original content line, so re-applying the real badgeD can
       never change naturalH on a later pass — no feedback possible. */
    var badgeD = Math.max(naturalH - borderW * 2, 16);
    var contentLineH = naturalH - padTop - padBottom - borderW * 2;
    var marginY = -((badgeD - contentLineH) / 2);

    btn.style.setProperty('--badge-d', badgeD.toFixed(1) + 'px');
    btn.style.setProperty('--badge-my', marginY.toFixed(1) + 'px');
    btn.style.setProperty('--badge-ml', (-padLeft).toFixed(1) + 'px');
  }

  function layout(btn, idx) {
    layoutBadge(btn);

    var beam = btn.querySelector('.cta-neon__beam');
    var rect = beam && beam.querySelector('rect');
    if (!rect) return;

    var w = btn.offsetWidth;
    var h = btn.offsetHeight;
    if (!w || !h) return;

    beam.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    beam.setAttribute('width', w);
    beam.setAttribute('height', h);
    beam.setAttribute('preserveAspectRatio', 'none');

    var inset = STROKE_W / 2;
    var rw = Math.max(0, w - inset * 2);
    var rh = Math.max(0, h - inset * 2);
    var rx = Math.min(rw, rh) / 2;

    rect.setAttribute('x', inset);
    rect.setAttribute('y', inset);
    rect.setAttribute('width', rw);
    rect.setAttribute('height', rh);
    rect.setAttribute('rx', rx);
    rect.setAttribute('ry', rx);
    rect.setAttribute('stroke-width', STROKE_W);
    /* No stroke-dasharray at all: the stroke covers the FULL
       perimeter (its length == the button's own perimeter, per the
       request), the shimmering comes from the gradient below, not
       from on/off dashes. */

    var grad = ensureGradient(beam, idx);
    var perimeter = (rect.getTotalLength && rect.getTotalLength()) || (2 * (rw + rh));
    updateGradientPeriod(grad, Math.max(perimeter / PEAK_COUNT, 4));
    tintGradient(btn, grad);
  }

  function layoutAll() {
    buttons.forEach(function (btn, idx) { layout(btn, idx); });
  }

  layoutAll();
  window.addEventListener('load', layoutAll);

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { layoutAll(); });
    buttons.forEach(function (btn) { ro.observe(btn); });
  } else {
    var resizeRaf = false;
    window.addEventListener('resize', function () {
      if (resizeRaf) return;
      resizeRaf = true;
      requestAnimationFrame(function () {
        layoutAll();
        resizeRaf = false;
      });
    });
  }
})();

/* FINAL — APPROACH TIMELINE AUTO-CYCLE. Lights up each step (01..06)
   in sequence automatically, one at a time, forever — no hover
   needed. Reuses the exact same "lit" look already built for :hover
   (see .tstep--auto-active in style.css), just toggled by a timer
   instead of the mouse. Pauses while the tab is hidden so it doesn't
   keep animating (and burning battery) in a background tab, and
   respects prefers-reduced-motion by just lighting the first step
   and stopping. */
(() => {
  var steps = Array.from(document.querySelectorAll('.sec-approach .tstep'));
  if (!steps.length) return;

  var STEP_MS = 1100;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0;
  var timer = 0;

  function show(i) {
    steps.forEach(function (s, j) {
      s.classList.toggle('tstep--auto-active', j === i);
    });
  }

  function tick() {
    idx = (idx + 1) % steps.length;
    show(idx);
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, STEP_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  show(0);

  if (!reduceMotion) {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }
})();

/* FINAL v3 — SERVICE CARD VIDEO: always-on autoplay loop, not
   hover-triggered. Each clip starts playing as soon as it has enough
   data and just keeps looping (the <video> tags already carry the
   `loop` attribute) — no pointer listeners needed anymore. Still
   pauses when the tab is hidden and resumes when it's visible again,
   so 5 looping videos aren't burning CPU/battery in a background
   tab. Respects prefers-reduced-motion by leaving the clip on its
   first frame instead of autoplaying. */
(() => {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Rest-frame offset (seconds) for each card, in DOM order —
  // explicit values requested by the user.
  var REST_OFFSETS = [4.9, 4.3, 2.8, 2.4, 4];
  // No real hover on touch devices, so the mouseenter/mouseleave pair
  // below never fires there — the clip just sat on its rest frame
  // forever, which read as "no video at all" on mobile. On these
  // devices, play the clip once its card scrolls prominently into
  // view instead, and drop it back to rest once it scrolls back out.
  var isTouch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
  var cardIO = (isTouch && !reduceMotion && window.IntersectionObserver)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target._svcVideo;
          var rest = entry.target._svcGoToRest;
          if (!v || !rest) return;
          if (entry.isIntersecting) {
            var playPromise = v.play();
            if (playPromise && playPromise.catch) playPromise.catch(function () {});
          } else {
            rest();
          }
        });
      }, { threshold: 0.6 })
    : null;

  document.querySelectorAll('.svc-card').forEach(function (card, i) {
    var video = card.querySelector('.svc-icon__video');
    if (!video) return;

    var restTime = REST_OFFSETS[i % REST_OFFSETS.length];

    function goToRest() {
      video.pause();
      var d = video.duration;
      video.currentTime = (d && isFinite(d) && d > restTime) ? restTime : 0;
    }

    if (video.readyState >= 1) {
      goToRest();
    } else {
      video.addEventListener('loadedmetadata', goToRest, { once: true });
    }

    if (reduceMotion) return;

    if (isTouch) {
      card._svcVideo = video;
      card._svcGoToRest = goToRest;
      if (cardIO) cardIO.observe(card);
    } else {
      function play() {
        var playPromise = video.play();
        if (playPromise && playPromise.catch) playPromise.catch(function () {});
      }

      card.addEventListener('mouseenter', play);
      card.addEventListener('focus', play, true);
      card.addEventListener('mouseleave', goToRest);
      card.addEventListener('blur', goToRest, true);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) video.pause();
    });
  });
})();

/* FINAL — "HOW THE SESSION WORKS" TIMELINE AUTO-CYCLE. Same exact
   mechanism as the Approach timeline above: lights up each of the 5
   steps in sequence automatically, one at a time, forever, no hover
   needed, 2s per step. Toggles .is-ctime-active (see style.css for
   the per-step colored glow that class turns on). Pauses while the
   tab is hidden, and respects prefers-reduced-motion by just lighting
   the first step and stopping there. */
(() => {
  var steps = Array.from(document.querySelectorAll('#coaching .coaching__timeline li'));
  if (!steps.length) return;

  var STEP_MS = 2000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0;
  var timer = 0;

  function show(i) {
    steps.forEach(function (s, j) {
      s.classList.toggle('is-ctime-active', j === i);
    });
  }

  function tick() {
    idx = (idx + 1) % steps.length;
    show(idx);
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, STEP_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  show(0);

  if (!reduceMotion) {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }
})();

/* ── SERVICES DETAIL — pinned scroll-STEP controller (services.html) ──
   Discrete, locked steps rather than a continuous scroll-scrub: one wheel
   gesture = exactly one step forward or back (blob rises & settles -> each
   service holds fully in view, one at a time -> blob shrinks & exits), never
   less, never more. This is deliberate: a continuous 1:1 scrub let a fast
   scroll fling blow straight through a service without it ever fully
   settling on screen, and let a small scroll leave things half-transitioned.
   Locking to discrete steps (via wheel-event hijacking + preventDefault
   while "engaged") guarantees every service is fully shown before the next
   one can appear. Disabled below 901px — that breakpoint falls back to a
   plain stacked list via CSS, so no scroll-jacking on touch/small screens. */
(function () {
  var pin = document.querySelector('.svcd-pin');
  if (!pin) return;

  var stage = pin.querySelector('.svcd-pin__stage');
  var pageBody = document.body;
  var afterServicesCta = document.querySelector('.svcd-after-services');
  var heroCopy = document.querySelector('.svcd-hero__copy');
  var panels = Array.prototype.slice.call(pin.querySelectorAll('.svcd-pin__panel'));
  var dots = Array.prototype.slice.call(pin.querySelectorAll('.svcd-pin__dot'));
  if (!stage || !panels.length) return;


  // A single persistent blob replaces the old one-per-panel setup: it rises
  // and grows exactly once, then freezes in place — only its color keeps
  // changing to track whichever service is active. It lives in panel 0's own
  // ".svcd-pin__visual" in the markup (so mobile's plain stacked fallback,
  // which never runs the desktop code below, keeps showing it there,
  // untouched); on desktop it's physically moved into its own dedicated slot
  // (outside every panel) so panel 0's own transform can't carry it away.
  var blobWrap = panels[0].querySelector('.svcd-pin__blob-wrap');
  var blobHome = blobWrap && blobWrap.parentNode; // panel 0's own .svcd-pin__visual
  var blobSlotVisual = pin.querySelector('#js-pin-blob-visual');
  var robotVideo = document.querySelector('.svcd-hero__robot.svcd-pin__robot') || panels[0].querySelector('.svcd-pin__robot');
  var robotHome = robotVideo && robotVideo.parentNode;
  var robotPositions = [
    { x: '3vw', y: '17vh', scale: 1 },
    { x: '81vw', y: '13vh', scale: 0.96 },
    { x: '5vw', y: '56vh', scale: 0.92 },
    { x: '82vw', y: '12vh', scale: 0.9 },
    { x: '43vw', y: '13vh', scale: 0.94 }
  ];
  function setRobotMotion(pos, opacity) {
    if (!robotVideo || !pos) return;
    robotVideo.style.setProperty('--unified-robot-x', pos.x);
    robotVideo.style.setProperty('--unified-robot-y', pos.y);
    robotVideo.style.setProperty('--unified-robot-scale', String(pos.scale));
    robotVideo.style.setProperty('--unified-robot-opacity', String(opacity));
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function robotPathAt(progress) {
    var vw = window.innerWidth || document.documentElement.clientWidth || 1200;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var p = 1 - Math.pow(1 - clamp(progress, 0, 1), 2.15);
    return {
      x: lerp(1100, vw * 0.03, p) + 'px',
      y: lerp(408, vh * 0.17, p) + 'px',
      scale: lerp(2.51, 1, p)
    };
  }
  function robotProgressForScroll(scrollY, pinDocTop) {
    return pinDocTop > 0 ? clamp(scrollY / pinDocTop, 0, 1) : 1;
  }
  function setHeroCopyProgress(progress) {
    if (!heroCopy) return;
    var hide = clamp((progress - 0.04) / 0.22, 0, 1);
    heroCopy.style.opacity = String(1 - hide);
    heroCopy.style.transform = 'translateY(' + (-18 * hide).toFixed(1) + 'px)';
    heroCopy.style.pointerEvents = hide > 0.8 ? 'none' : '';
  }
  var BLOB_SCALE = 3; // held size; entrance and exit both ramp to/from this
  var BLOB_MIN_SCALE = 0.4; // small size while exiting at the very end
  var BLOB_FAR_SCALE = 0.12; // tiny/distant size while approaching at the very start

  // Tags live over the circle itself (moved there in the markup): each
  // panel's own tag list slides in from well past the right edge of the
  // frame once that panel becomes the held step.
  var tagsEls = panels.map(function (p) { return p.querySelector('.svcd-pin__tags'); });
  var TAGS_OFFSET_PX = 500; // starts well past the frame's right edge
  var TAG_CYCLE_MS = 1100;  // auto bold/fill cycle, once tags have settled

  // Every value below animates via a current->target lerp (same technique as
  // the homepage service-card tilt in this same file), run continuously off
  // its own rAF loop — this is what makes each step's transition feel smooth
  // rather than snapping instantly the moment a step change is requested.
  var EASE = 0.11; // responsive glide: less stuck, still eased
  var smoothRunning = false;
  var smoothRafId = 0;
  var panelState = panels.map(function () { return { ty: 100, op: 0, blur: 0, curTy: 100, curOp: 0, curBlur: 0 }; });
  var tagsState = panels.map(function () { return { tx: TAGS_OFFSET_PX, op: 0, curTx: TAGS_OFFSET_PX, curOp: 0 }; });
  var blobTarget = { x: 0, y: 0, ty: 100, scale: BLOB_MIN_SCALE, rot: 0, op: 0, blur: 0 };
  var blobCur = { x: 0, y: 0, ty: 100, scale: BLOB_MIN_SCALE, rot: 0, op: 0, blur: 0 };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function snapAll() {
    panelState.forEach(function (s) { s.curTy = s.ty; s.curOp = s.op; s.curBlur = s.blur; });
    tagsState.forEach(function (s) { s.curTx = s.tx; s.curOp = s.op; });
    blobCur.x = blobTarget.x; blobCur.y = blobTarget.y; blobCur.ty = blobTarget.ty; blobCur.scale = blobTarget.scale; blobCur.rot = blobTarget.rot;
    blobCur.op = blobTarget.op; blobCur.blur = blobTarget.blur;
    paintFrame();
  }

  function paintFrame() {
    // Belt-and-suspenders: a smoothTick frame queued right before a resize
    // flips us to mobile could otherwise still land one more repaint with
    // stale desktop inline styles, fighting the mobile CSS fallback's own
    // !important rules (an inline style, even a stale one, always outranks
    // a plain stylesheet rule of the same importance). Never touch the DOM
    // here at all once we're not on desktop.
    if (!isDesktop.matches) return;
    // During a hash/deep-link entry hold (see openServiceFromHash), the
    // target panel is displayed by a pure-CSS rule and must not be
    // repainted from panelState — a queued frame carrying stale "hidden"
    // values would stamp inline !important opacity over it and blank the
    // very content the visitor came to read. The hold lifts on the first
    // real step change (goToStep) and painting resumes seamlessly from
    // state that was synced to the visible values at entry.
    var hashHold = pin.classList.contains('is-hash-entry');
    panels.forEach(function (p, i) {
      if (hashHold && p.classList.contains('is-hash-active')) return;
      var s = panelState[i];
      set(p, 'transform', 'translateY(' + s.curTy.toFixed(3) + '%)');
      set(p, 'opacity', String(Math.max(0, s.curOp)));
      set(p, 'filter', s.curBlur > 0.05 ? 'blur(' + s.curBlur.toFixed(1) + 'px)' : 'none');

      var tags = tagsEls[i], ts = tagsState[i];
      if (tags) {
        set(tags, 'transform', 'translateX(' + ts.curTx.toFixed(1) + 'px)');
        set(tags, 'opacity', String(Math.max(0, ts.curOp)));
      }
    });
    if (blobWrap) {
      set(blobWrap, 'transform', 'translate(' + blobCur.x.toFixed(1) + 'px,' + blobCur.y.toFixed(1) + 'px) translateY(' + blobCur.ty.toFixed(3) + '%) scale(' + blobCur.scale.toFixed(3) + ') rotate(' + blobCur.rot.toFixed(1) + 'deg)');
      set(blobWrap, 'opacity', String(Math.max(0, blobCur.op)));
      set(blobWrap, 'filter', blobCur.blur > 0.05 ? 'blur(' + blobCur.blur.toFixed(1) + 'px)' : 'none');
    }
  }

  function smoothTick() {
    var moving = false;
    panelState.forEach(function (s) {
      s.curTy = lerp(s.curTy, s.ty, EASE);
      s.curOp = lerp(s.curOp, s.op, EASE);
      s.curBlur = lerp(s.curBlur, s.blur, EASE);
      if (Math.abs(s.curTy - s.ty) > 0.05 || Math.abs(s.curOp - s.op) > 0.002 || Math.abs(s.curBlur - s.blur) > 0.02) moving = true;
    });
    tagsState.forEach(function (s) {
      s.curTx = lerp(s.curTx, s.tx, EASE);
      s.curOp = lerp(s.curOp, s.op, EASE);
      if (Math.abs(s.curTx - s.tx) > 0.1 || Math.abs(s.curOp - s.op) > 0.002) moving = true;
    });
    blobCur.x = lerp(blobCur.x, blobTarget.x, EASE);
    blobCur.y = lerp(blobCur.y, blobTarget.y, EASE);
    blobCur.ty = lerp(blobCur.ty, blobTarget.ty, EASE);
    blobCur.scale = lerp(blobCur.scale, blobTarget.scale, EASE);
    blobCur.rot = lerp(blobCur.rot, blobTarget.rot, EASE);
    blobCur.op = lerp(blobCur.op, blobTarget.op, EASE);
    blobCur.blur = lerp(blobCur.blur, blobTarget.blur, EASE);
    if (Math.abs(blobCur.x - blobTarget.x) > 0.1 || Math.abs(blobCur.y - blobTarget.y) > 0.1 || Math.abs(blobCur.ty - blobTarget.ty) > 0.05 || Math.abs(blobCur.scale - blobTarget.scale) > 0.002 || Math.abs(blobCur.rot - blobTarget.rot) > 0.05) moving = true;

    paintFrame();
    if (moving) smoothRafId = requestAnimationFrame(smoothTick);
    else smoothRunning = false;
  }

  /* Self-healing restart, not a guard. The old "only start if not
     already running" version had a fatal failure mode, confirmed from a
     screen recording of a deep-link visit: if the smoothTick rAF chain
     ever dies while smoothRunning is still true (an exception mid-tick,
     a cancel that raced a queued frame, browser rAF starvation during
     heavy page load being resumed inconsistently...), every later
     ensureSmoothing() call became a silent no-op — steps kept advancing
     (dots, robot, blob colors are all painted directly, not via this
     loop) but panel text froze at whatever opacity the last painted
     frame left it (~0.1 = invisible). Unconditionally cancelling and
     re-queueing makes every step change revive the painter no matter
     how it previously died; cost is one cancel+queue per step, nothing
     per-frame. */
  function ensureSmoothing() {
    if (smoothRafId) cancelAnimationFrame(smoothRafId);
    smoothRunning = true;
    smoothRafId = requestAnimationFrame(smoothTick);
  }

  // Bug fix: without this, a still-running smoothTick loop would keep
  // repainting panels/blob every frame using stale JS state even after
  // layoutStatic() had just cleared their inline styles on disengage —
  // instantly overwriting the "hidden/static" reset with whatever
  // mid-transition values were still animating, which is what let stray
  // content flash back on top of the section right after it should have
  // released.
  function stopSmoothing() {
    smoothRunning = false;
    if (smoothRafId) cancelAnimationFrame(smoothRafId);
    smoothRafId = 0;
  }

  // Must mirror the CSS fallback query exactly (max-width:639px, pointer:coarse)
  // — gate on real touch / genuinely narrow viewports, not just "not wide",
  // so a normal (even non-maximized) desktop browser window still pins.
  var isDesktop = window.matchMedia('(min-width:640px) and (pointer:fine)');
  var activeIndex = -999; // never a real index/-1, so the very first setActive(-1) isn't a same-value no-op (it must actually strip the hardcoded "is-active" class the markup ships with on panel 0)

  // STEP MODEL — discrete, locked steps instead of a continuous scroll-scrub:
  //   0                       -> blob rises from below and settles, centered
  //   1..panels.length        -> that panel (step-1) held fully in view
  //   panels.length+1 (LAST)  -> blob shrinks and exits, then the section
  //                              releases into whatever comes after it
  // One wheel gesture = exactly one step forward or back, never partial —
  // this is what guarantees every service is fully shown before the next
  // can appear, regardless of how fast or slow the scroll gesture was.
  var STEP_PANEL_BASE = 1;
  var LAST_STEP = STEP_PANEL_BASE + panels.length;
  var currentStep = -1; // -1 = not yet engaged
  var engaged = false;
  var completedForward = false; // true once scrolled past LAST_STEP
  var locked = false;
  // Deliberately NOT tied to the (slow) visual settle time: the lerp can
  // smoothly retarget mid-transition if a new step is requested before the
  // previous one finished playing out — that's normal, gapless tweening.
  // Needs to be long enough that a single real scroll gesture (a mouse
  // wheel is rarely exactly one notch; a trackpad swipe fires many wheel
  // events over a few hundred ms) reads as ONE step, not several — too
  // short and one scroll motion blows through multiple services at once.
  var LOCK_MS = 1080;
  var wheelAccum = 0;
  var unlockTimer = 0;
  var lastStepAt = 0;
  var WHEEL_THRESHOLD = 115; // filters tiny trackpad twitches without requiring repeated scrolls
  var tagCycleTimer = 0;
  var anchorScrollY = 0; // real scrollY frozen at, while engaged
  var exitingToHero = false;

  // Belt-and-suspenders: set up the structural positioning this mechanic
  // NEEDS directly via inline styles, so it can't be silently defeated by
  // an out-of-date cached copy of style.css that's missing these rules
  // (this file has repeatedly appeared to "not update" for reasons that
  // traced back to stale CSS/JS caches — this removes that dependency
  // for the pin/slide mechanic specifically). Visual styling like colors
  // and fonts still comes from style.css; only the load-bearing layout
  // properties are re-asserted here.
  // set(el, prop, value) uses setProperty(...,'important') instead of the
  // plain .style.prop = value shorthand. A plain inline style can still be
  // beaten by an external stylesheet rule that happens to use !important
  // (this codebase's style.css has plenty of those from older passes) —
  // an inline !important declaration beats every author-stylesheet rule,
  // !important or not, so this is the one thing that truly cannot be
  // silently defeated by CSS, cached or otherwise.
  function set(el, prop, value) {
    if (value === '') { el.style.removeProperty(prop); }
    else { el.style.setProperty(prop, value, 'important'); }
  }

  function forceHideServiceRobot() {
    if (!robotVideo) return;
    robotVideo.classList.remove('is-visible');
  }
  function fadeOutServiceRobot() {
    if (!robotVideo) return;
    robotVideo.classList.remove('is-visible');
    robotVideo.classList.add('is-service-mode');
    setRobotMotion(robotPositions[robotPositions.length - 1], 0);
  }
  function allowServiceRobot() {
    if (!robotVideo) return;
    robotVideo.classList.add('is-service-mode');
  }
  function layoutFixed() {
    set(pin, 'position', 'relative');
    set(pin, 'height', '100vh');
    set(stage, 'position', 'fixed');
    set(stage, 'top', '0');
    set(stage, 'left', '0');
    set(stage, 'width', '100%');
    set(stage, 'height', '100vh');
    set(stage, 'overflow', 'hidden');
    set(stage, 'display', 'flex');
    set(stage, 'align-items', 'center');
    // While pinned, the stage needs its own opaque starfield layer. If it is
    // fully transparent, lower sections such as the footer can peek through
    // during inertial scroll drift. Copy the page starfield instead of using
    // a flat color, so the fixed-star look stays intact.
    var pageBg = window.getComputedStyle(document.body);
    set(stage, 'background-color', pageBg.backgroundColor || '#07060D');
    set(stage, 'background-image', pageBg.backgroundImage || 'none');
    set(stage, 'background-size', pageBg.backgroundSize || 'auto');
    set(stage, 'background-repeat', pageBg.backgroundRepeat || 'repeat');
    set(stage, 'background-position', pageBg.backgroundPosition || '0% 0%');
    set(stage, 'background-attachment', 'fixed');
    panels.forEach(function (p) {
      set(p, 'position', 'absolute');
      set(p, 'top', '0');
      set(p, 'left', '0');
      set(p, 'right', '0');
      set(p, 'bottom', '0');
      set(p, 'pointer-events', 'none');
    });
    if (blobWrap && blobSlotVisual && blobWrap.parentNode !== blobSlotVisual) {
      blobSlotVisual.appendChild(blobWrap);
    }
    if (robotVideo) {
      robotVideo.classList.add('is-service-mode');
    }
  }
  function layoutStatic(keepBlobInSlot) {
    set(pin, 'position', '');
    set(pin, 'height', '');
    set(stage, 'position', '');
    set(stage, 'top', '');
    set(stage, 'left', '');
    set(stage, 'width', '');
    set(stage, 'height', '');
    set(stage, 'overflow', '');
    set(stage, 'display', '');
    set(stage, 'align-items', '');
    set(stage, 'background', '');
    set(stage, 'background-color', '');
    set(stage, 'background-image', '');
    set(stage, 'background-size', '');
    set(stage, 'background-repeat', '');
    set(stage, 'background-position', '');
    set(stage, 'background-attachment', '');
    panels.forEach(function (p) {
      set(p, 'position', '');
      set(p, 'top', '');
      set(p, 'left', '');
      set(p, 'right', '');
      set(p, 'bottom', '');
      set(p, 'pointer-events', '');
      set(p, 'transform', '');
      set(p, 'opacity', '');
      set(p, 'filter', '');
    });
    tagsEls.forEach(function (tags) {
      if (!tags) return;
      set(tags, 'transform', '');
      set(tags, 'opacity', '');
    });
    if (!keepBlobInSlot && blobWrap && blobHome && blobWrap.parentNode !== blobHome) {
      blobHome.appendChild(blobWrap);
    }
    if (robotVideo) {
      forceHideServiceRobot();
      robotVideo.classList.remove('is-visible', 'is-service-mode');
      robotVideo.style.opacity = '';
      robotVideo.style.visibility = '';
      robotVideo.style.pointerEvents = '';
    }
    if (blobWrap && !keepBlobInSlot) {
      set(blobWrap, 'transform', '');
      set(blobWrap, 'opacity', '');
      set(blobWrap, 'filter', '');
      ['--row-c','--row-g1','--row-g2','--row-g3','--row-g4','--row-g5','--blob-spin','--row-p1','--row-p2','--row-p3','--row-p4','--row-p5'].forEach(function (name) { blobWrap.style.removeProperty(name); });
    }
  }

  function setActive(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    panels.forEach(function (p, idx) {
      p.classList.toggle('is-active', idx === i);
    });
    dots.forEach(function (d, idx) {
      d.classList.toggle('is-active', idx === i);
    });
    if (robotVideo) {
      if (i >= 0) {
        allowServiceRobot();
        setRobotMotion(robotPositions[i] || robotPositions[0], .96);
        robotVideo.classList.add('is-visible');
      } else {
        forceHideServiceRobot();
      }
    }
  }

  // Cycles each tag li bold + its bullet filled, one at a time, automatically
  // — but only ever as a small embellishment *within* an already-held,
  // already-locked step, never as something that advances the section
  // itself. Starts once the tags' own slide-in tween has had time to settle.
  function manageTagCycle(step) {
    clearInterval(tagCycleTimer);
    tagCycleTimer = 0;
    tagsEls.forEach(function (t) {
      if (!t) return;
      Array.prototype.forEach.call(t.children, function (li) { li.classList.remove('is-tag-active'); });
    });
    if (step < STEP_PANEL_BASE || step >= LAST_STEP) return;
    var idx = step - STEP_PANEL_BASE;
    var list = tagsEls[idx];
    if (!list) return;
    var items = Array.prototype.slice.call(list.children);
    if (!items.length) return;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var i = 0;
    function tick() {
      items.forEach(function (li, j) { li.classList.toggle('is-tag-active', j === i); });
      i = (i + 1) % items.length;
    }
    setTimeout(function () {
      if (currentStep !== step) return; // stepped away before it could start
      tick();
      if (!reduceMotion) tagCycleTimer = setInterval(tick, TAG_CYCLE_MS);
    }, Math.min(760, LOCK_MS));
  }
  function applyStep(step) {
    if (step <= 0) {
      // blob rising, nothing else has arrived yet
      blobTarget.x = 0; blobTarget.y = 0; blobTarget.ty = 0; blobTarget.scale = BLOB_SCALE; blobTarget.rot = 90; blobTarget.op = 1; blobTarget.blur = 0;
      if (step < 0) { blobTarget.x = 0; blobTarget.y = 0; blobTarget.ty = 0; blobTarget.scale = BLOB_FAR_SCALE; blobTarget.rot = 90; blobTarget.op = 0; }
      panels.forEach(function (p, i) {
        var s = panelState[i]; s.ty = 100; s.op = 0; s.blur = 0;
        var ts = tagsState[i]; ts.tx = TAGS_OFFSET_PX; ts.op = 0;
      });
      setActive(-1);
    } else if (step < LAST_STEP) {
      var active = step - STEP_PANEL_BASE;
      blobTarget.x = 0; blobTarget.y = 0; blobTarget.ty = 0; blobTarget.scale = BLOB_SCALE; blobTarget.rot = 90; blobTarget.op = 1; blobTarget.blur = 0;
      if (blobWrap) {
        ['--row-c','--row-g1','--row-g2','--row-g3','--row-g4','--row-g5','--blob-spin','--row-p1','--row-p2','--row-p3','--row-p4','--row-p5'].forEach(function (name) {
          var value = panels[active].style.getPropertyValue(name);
          if (value) blobWrap.style.setProperty(name, value);
        });
      }
      panels.forEach(function (p, i) {
        var s = panelState[i];
        if (i === active) { s.ty = 0; s.op = 1; s.blur = 0; }
        else if (i < active) { s.ty = -100; s.op = 0; s.blur = 9; }
        else { s.ty = 100; s.op = 0; s.blur = 0; }
        var ts = tagsState[i];
        ts.tx = i === active ? 0 : TAGS_OFFSET_PX;
        ts.op = i === active ? 1 : 0;
      });
      setActive(active);
    } else {
      // blob shrinking and exiting, every panel already gone
      blobTarget.x = 0; blobTarget.y = 0; blobTarget.ty = -135; blobTarget.scale = BLOB_MIN_SCALE; blobTarget.rot = 180; blobTarget.op = 0; blobTarget.blur = 9;
      panels.forEach(function (p, i) {
        var s = panelState[i]; s.ty = -100; s.op = 0; s.blur = 9;
        var ts = tagsState[i]; ts.tx = TAGS_OFFSET_PX; ts.op = 0;
      });
      setActive(-1);
      fadeOutServiceRobot();
    }
    ensureSmoothing();
    manageTagCycle(step);
  }

  function serviceStepFromHash() {
    var hash = (window.location.hash || '').replace('#', '');
    if (!hash) return null;
    for (var i = 0; i < panels.length; i += 1) {
      if (panels[i].id === hash) return i + STEP_PANEL_BASE;
    }
    return null;
  }

  /* Deep links from home enter the normal pinned interaction (a static
     bypass was tried and reverted at the owner's request); the target
     service's text is guaranteed by the CSS-owned hash-entry hold below. */
  function openServiceFromHash() {
    var step = serviceStepFromHash();
    if (step === null) return;
    // Mobile has its own locked-step controller further down this file
    // (see "MOBILE LOCKED-STEP SERVICES CONTROLLER"), which reads the
    // hash itself.
    if (!isDesktop.matches) return;
    window.scrollTo({ top: pin.getBoundingClientRect().top + window.scrollY, behavior: 'auto' });
    engage(step, true);
    snapAll();
    // HASH-ENTRY HOLD: the target panel's visibility is handed to a pure
    // CSS rule (.is-hash-entry/.is-hash-active in style.css) instead of
    // the JS paint pipeline. Every previous JS-side guarantee (snap,
    // self-healing rAF, direct inline writes) still intermittently lost
    // to *something* stamping the panel back to hidden on real machines —
    // so at entry the panel's inline styles are stripped entirely (an
    // inline !important always beats the stylesheet, even a stale one)
    // and paintFrame explicitly skips this panel while the hold is on.
    // Stylesheet-only display cannot be killed by any JS failure mode.
    // The hold lifts on the user's first step (goToStep) / disengage.
    var active = panels[step - STEP_PANEL_BASE];
    pin.classList.add('is-hash-entry');
    panels.forEach(function (p) { p.classList.toggle('is-hash-active', p === active); });
    if (active) {
      set(active, 'transform', '');
      set(active, 'opacity', '');
      set(active, 'filter', '');
    }
    var tags = tagsEls[step - STEP_PANEL_BASE];
    if (tags) {
      set(tags, 'transform', '');
      set(tags, 'opacity', '');
    }
    // Sync the tween bookkeeping to the visible values so the moment the
    // hold lifts, painting resumes from exactly what's on screen — no jump.
    var s = panelState[step - STEP_PANEL_BASE];
    if (s) { s.curTy = s.ty = 0; s.curOp = s.op = 1; s.curBlur = s.blur = 0; }
    var ts = tagsState[step - STEP_PANEL_BASE];
    if (ts) { ts.curTx = ts.tx = 0; ts.curOp = ts.op = 1; }
  }

  function liftHashEntryHold() {
    if (!pin.classList.contains('is-hash-entry')) return;
    pin.classList.remove('is-hash-entry');
    panels.forEach(function (p) { p.classList.remove('is-hash-active'); });
  }
  function scheduleUnlock() {
    clearTimeout(unlockTimer);
    var elapsed = performance.now() - lastStepAt;
    var delay = Math.max(260, LOCK_MS - elapsed);
    unlockTimer = setTimeout(function () {
      locked = false;
      wheelAccum = 0;
    }, delay);
  }

  var settleGuard = 0;
  function goToStep(next) {
    next = Math.max(0, Math.min(LAST_STEP, next));
    if (next === currentStep) return;
    // First real step change after a deep-link entry: hand display back
    // to the normal paint pipeline (its state was synced at entry, so
    // there is no visual jump).
    liftHashEntryHold();
    currentStep = next;
    applyStep(currentStep);
    // Watchdog for the same painter-death failure mode ensureSmoothing's
    // self-healing restart addresses: if ~a second after a step change
    // the eased values still haven't been painted through (tween died
    // mid-flight), force-complete this step's visuals in one snap. When
    // the tween is healthy the values have already converged by now, so
    // the snap is a visually-identical no-op.
    clearTimeout(settleGuard);
    settleGuard = setTimeout(function () {
      if (!engaged) return;
      snapAll();
    }, 950);
  }

  function onWheel(e) {
    if (!engaged) {
      var rect = pin.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;

      // Entering from the hero must be a committed handoff, not a half-scroll.
      // One down-scroll near the services scene lands on service 1, and the
      // initial lock absorbs the rest of that same gesture so it cannot skip
      // straight to service 2.
      if (!completedForward && e.deltaY > 0 && isDesktop.matches && rect.top < vh * 0.92 && rect.bottom > 0) {
        e.preventDefault();
        engage(1, true);
        return;
      }

      // Re-entry from below uses the wheel direction itself.
      if (completedForward && e.deltaY < 0 && isDesktop.matches) {
        var overlap = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        if (overlap / vh >= 0.6) engage(LAST_STEP - 1, true);
      }
      return;
    }
    e.preventDefault();
    if (locked) { wheelAccum = 0; return; }
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
    var dir = wheelAccum > 0 ? 1 : -1;
    wheelAccum = 0;


    if (dir > 0 && currentStep === LAST_STEP - 1) {
      exitToAfterServices();
      return;
    }
    if (dir > 0 && currentStep >= LAST_STEP) {
      disengage(true);
      return;
    }
    if (dir < 0 && currentStep <= STEP_PANEL_BASE) {
      softExitToHero();
      return;
    }
    locked = true;
    lastStepAt = performance.now();
    goToStep(currentStep + dir);
    scheduleUnlock();
  }

  function exitToAfterServices() {
    clearTimeout(unlockTimer);
    locked = true;
    wheelAccum = 0;
    lastStepAt = performance.now();
    goToStep(LAST_STEP);
    window.setTimeout(function () {
      if (engaged && currentStep === LAST_STEP) disengage(true);
    }, 120);
  }
  function softExitToHero() {
    if (exitingToHero) return;
    exitingToHero = true;
    locked = true;
    wheelAccum = 0;
    clearTimeout(settleGuard);
    applyStep(-1);
    if (robotVideo) {
      var rect = pin.getBoundingClientRect();
      var docTop = rect.top + window.scrollY;
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      var targetScroll = 0;
      setRobotMotion(robotPathAt(0), .96);
      robotVideo.classList.remove('is-visible');
    }
    window.setTimeout(function () {
      setHeroCopyProgress(0);
      disengage(false, true);
      exitingToHero = false;
    }, 1120);
  }
  function engage(startStep, lockInitial) {
    if (pageBody) pageBody.classList.remove('is-past-services');
    setHeroCopyProgress(1);
    engaged = true;
    anchorScrollY = window.scrollY;
    layoutFixed();
    currentStep = -1;
    goToStep(startStep);
    if (lockInitial) {
      locked = true;
      wheelAccum = 0;
      lastStepAt = performance.now();
      scheduleUnlock();
    }
  }

  function disengage(forward, toHeroTop) {
    engaged = false;
    wheelAccum = 0;
    locked = false;
    liftHashEntryHold();
    clearTimeout(settleGuard);
    clearInterval(tagCycleTimer);
    tagCycleTimer = 0;
    if (forward) stopSmoothing(); // forward exit can reset fully; backward exit must keep easing the blob away
    if (forward) completedForward = true;
    else completedForward = false;
    if (pageBody) pageBody.classList.toggle('is-past-services', !!forward);
    // We've been fully absorbing wheel input while engaged, so real scrollY
    // hasn't moved from the point of engagement — nudge it clear of the
    // wrapper so checkEngage()'s "dominant in viewport" test (below) no
    // longer holds. This does NOT need to fully clear the wrapper's whole
    // height (the page's content below it may not even be that tall) —
    // checkEngage() only re-triggers once this section stops dominating the
    // viewport, not on every last pixel of overlap.
    var docTop = pin.getBoundingClientRect().top + window.scrollY;
    var vh = window.innerHeight;
    forceHideServiceRobot();
    layoutStatic(!forward);
    currentStep = -1;
    var targetTop = forward ? docTop + vh * 1.02 : (toHeroTop ? 0 : docTop - vh * 0.55);
    if (forward && afterServicesCta) {
      targetTop = afterServicesCta.getBoundingClientRect().top + window.scrollY - 24;
    }
    window.scrollTo({ top: targetTop, behavior: 'auto' });
    if (!forward) {
      if (toHeroTop) {
        setHeroCopyProgress(0);
      } else {
        updateApproach();
      }
    }
  }

  function ensureBlobInSlot() {
    if (blobWrap && blobSlotVisual && blobWrap.parentNode !== blobSlotVisual) {
      blobSlotVisual.appendChild(blobWrap);
    }
  }

  // Continuous, scroll-tied pre-engagement: the blob's rise is NOT a step
  // and NOT a timer here — it tracks the scrollbar 1:1 as the wrapper enters
  // the viewport, exactly mirroring how the blob's exit already behaves at
  // the other end of the sequence. This is what removes the old dead-zone
  // (a long stretch of scrolling with zero visible feedback before the blob
  // would suddenly pop in) — the very first pixel of scroll into this
  // section already moves the blob. Only once it's fully arrived does the
  // locked step-by-step system for the panels actually engage.
  function updateApproach() {
    // Once the forward journey through this section has ever been fully
    // completed, this function has NOTHING further to do — re-entry from
    // below is handled exclusively by onWheel()'s own deltaY direction (see
    // above), never by re-deriving direction from scrollY here. Continuing
    // to scroll down (or sitting still at whatever the page's natural
    // scroll maximum happens to be, which may leave this section's rect
    // still technically overlapping if the remaining page content below it
    // isn't a full viewport tall) must never re-engage anything again.
    if (!isDesktop.matches || engaged || completedForward) return;
    ensureBlobInSlot();
    var rect = pin.getBoundingClientRect();

    // 0 = the very top of the page (scrollY 0) — the hero shows clean, blob
    // fully small/hidden; 1 = fully arrived (wrapper's top at the viewport's
    // own top). Uses the WHOLE natural pre-arrival scroll distance, not a
    // fixed vh window, so it always starts genuinely small regardless of
    // how tall (or short) the hero above it happens to be. Recomputed fresh
    // every call (not cached) so it self-corrects if a late font swap or
    // image load shifts the page's layout after script init.
    var pinDocTop = rect.top + window.scrollY;
    var approachT = pinDocTop > 0 ? Math.max(0, Math.min(1, window.scrollY / pinDocTop)) : 1;
    setHeroCopyProgress(approachT);
    if (blobWrap) {
      // Exact mirror of the exit (ty:-100->stays put here, scale:BIG->FAR,
      // rot:90->180 reversed to 0->90, op:1->0 reversed, blur:0->9 reversed)
      // — "from far, closer, bigger", never "up from below": ty stays 0 the
      // whole time by explicit request, everything else is the exit's own
      // math run backwards.
      var easedApproach = 1 - Math.pow(1 - approachT, 2.2);
      if (robotVideo) {
        robotVideo.classList.remove('is-visible', 'is-service-mode');
        setRobotMotion(robotPathAt(approachT), approachT <= 0.01 ? .96 : .98);
      }
      var farX = Math.min(260, window.innerWidth * 0.18);
      var farY = -Math.min(170, window.innerHeight * 0.18);
      blobTarget.x = farX * (1 - easedApproach);
      blobTarget.y = farY * (1 - easedApproach);
      blobTarget.ty = 0;
      blobTarget.scale = BLOB_FAR_SCALE + easedApproach * (BLOB_SCALE - BLOB_FAR_SCALE);
      blobTarget.rot = easedApproach * 90;
      blobTarget.op = approachT <= 0.01 ? 0 : 0.22 + easedApproach * 0.78;
      blobTarget.blur = (1 - easedApproach) * 6;

      var panelApproach = Math.max(0, Math.min(1, (approachT - 0.18) / 0.62));
      var easedPanel = 1 - Math.pow(1 - panelApproach, 2);
      panels.forEach(function (p, i) {
        var s = panelState[i];
        var ts = tagsState[i];
        if (i === 0) {
          s.ty = 100 - easedPanel * 100;
          s.op = easedPanel;
          s.blur = (1 - easedPanel) * 4;
          ts.tx = TAGS_OFFSET_PX * (1 - easedPanel);
          ts.op = easedPanel;
        } else {
          s.ty = 100;
          s.op = 0;
          s.blur = 0;
          ts.tx = TAGS_OFFSET_PX;
          ts.op = 0;
        }
      });
      ensureSmoothing();
    }
    // Guard against re-triggering forever: without rect.bottom>0, approachT
    // stays clamped at 1 for EVERY scroll event for the rest of the page's
    // life once you've passed this section (scrollY only grows), which was
    // dragging the user back into step 0 no matter how far down the page
    // they'd scrolled — the site could never actually reach its own footer.
    // rect.bottom>0 means the wrapper is still genuinely at/near the
    // viewport; once truly scrolled past it, this must never re-fire.
    // Wheel owns the actual pin/step handoff. updateApproach only previews the approach state.
  }

  // ROOT CAUSE of "deep link shows the sphere but no text", confirmed via
  // on-page diagnostics (panel opacity 1, text fully painted, yet panel
  // rect exactly one full height ABOVE the stage): the browser's own
  // scroll-to-#fragment logic targets the panel INSIDE .svcd-pin__list /
  // .svcd-pin__stage — both overflow:hidden — and scrolls their internal
  // scrollTop instead of only the window, silently shoving the whole
  // stacked-panel canvas out of view. These containers are never meant to
  // scroll internally, on any breakpoint: pin them to 0 permanently, and
  // clear anything the browser already scrolled before this ran.
  var innerScrollables = [pin, stage, pin.querySelector('.svcd-pin__list')];
  innerScrollables.forEach(function (el) {
    if (!el) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    el.addEventListener('scroll', function () {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    }, { passive: true });
  });

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('hashchange', openServiceFromHash);
  window.setTimeout(openServiceFromHash, 80);
  window.addEventListener('scroll', function () {
    if (engaged) {
      // Belt-and-suspenders against real-world trackpad/mouse momentum
      // scrolling: some browsers don't fully honor wheel preventDefault()
      // during inertial momentum, letting real scrollY creep even while
      // "engaged" — which would let the section below peek into view while
      // this one is still supposed to be pinned. Snap straight back.
      if (!exitingToHero && window.scrollY !== anchorScrollY) window.scrollTo(0, anchorScrollY);
      return;
    }
    updateApproach();
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!isDesktop.matches && engaged) disengage(false);
    updateApproach();
  });

  if (isDesktop.matches) {
    applyStep(-1);
    snapAll();
    ensureBlobInSlot();
  }
  updateApproach();
})();

/* MOBILE LOCKED-STEP SERVICES CONTROLLER — services.html only,
   touch/narrow screens. Mirrors the desktop wheel-jacked step system
   above (hero -> sphere rises -> each service holds, one per scroll
   gesture, locked -> sphere exits -> after-services CTA), but driven by
   real scroll-position deltas instead of wheel events, since touch
   scrolling has no equivalent "wheel" event to hijack. Entirely separate
   code path from the desktop controller above: gated on its own
   isMobile match, never runs above the mobile breakpoint, never touches
   desktop DOM, state, or CSS classes.

   How the "lock" works: rather than fighting touchmove/preventDefault
   (unreliable across mobile browsers, and risks breaking native
   gestures), this watches real scrollY while "engaged" and immediately
   snaps it straight back to the anchor position on every scroll event —
   the same belt-and-suspenders snap-back the desktop controller already
   uses for momentum-scroll safety, just used here as the PRIMARY
   mechanism. The accumulated delta before that snap-back is what decides
   whether a step has been "earned" (crossed WHEEL_THRESHOLD-equivalent),
   exactly mirroring the desktop wheelAccum/LOCK_MS pattern. */
(function () {
  var isMobile = window.matchMedia('(max-width:639px), (pointer:coarse)');
  var pin = document.querySelector('.svcd-pin');
  if (!pin) return;
  var panels = Array.prototype.slice.call(pin.querySelectorAll('.svcd-pin__panel'));
  var mobileBlob = document.getElementById('js-pin-mobile-blob');
  var heroRobot = document.querySelector('.svcd-hero__robot');
  var afterServicesCta = document.querySelector('.svcd-after-services');
  if (!panels.length || !mobileBlob) return;

  var currentStep = 0; // 0 = hero, not yet engaged; 1..N = services
  var engaged = false;
  var completedForward = false;
  var locked = false;
  var accum = 0;
  var anchorY = 0;
  var lastStepAt = 0;
  var unlockTimer = 0;
  var THRESHOLD = 60;
  var LOCK_MS = 700;
  var lastDisengageAt = 0;
  var REENGAGE_COOLDOWN_MS = 500; // otherwise the programmatic scrollTo a
  // backward disengage() ends with can itself land close enough to the
  // engage threshold to immediately re-trigger engage() on the very next
  // scroll event, creating a stuck flicker right at the hero/pin boundary.

  function syncBlobToPanel(i) {
    var p = panels[i];
    var cs = window.getComputedStyle(p);
    ['--row-c', '--row-g1', '--row-g2', '--row-g3', '--row-g4', '--row-g5', '--blob-spin'].forEach(function (name) {
      var val = cs.getPropertyValue(name);
      if (val) mobileBlob.style.setProperty(name, val.trim());
    });
  }

  function showStep(step) {
    panels.forEach(function (p, i) {
      p.classList.toggle('is-mobile-active', step >= 1 && i === step - 1);
    });
    if (step >= 1 && step <= panels.length) {
      syncBlobToPanel(step - 1);
      mobileBlob.classList.add('is-risen');
      mobileBlob.classList.remove('is-exiting');
    } else {
      mobileBlob.classList.remove('is-risen', 'is-exiting');
    }
  }

  function scheduleUnlock() {
    clearTimeout(unlockTimer);
    var elapsed = performance.now() - lastStepAt;
    var delay = Math.max(220, LOCK_MS - elapsed);
    unlockTimer = setTimeout(function () { locked = false; accum = 0; }, delay);
  }

  function goToStep(next) {
    next = Math.max(1, Math.min(panels.length, next));
    if (next === currentStep) return;
    currentStep = next;
    showStep(currentStep);
    locked = true;
    accum = 0;
    lastStepAt = performance.now();
    scheduleUnlock();
  }

  function engage(startStep) {
    engaged = true;
    completedForward = false;
    anchorY = window.scrollY;
    currentStep = 0;
    pin.classList.add('is-mobile-engaged');
    if (heroRobot) heroRobot.classList.add('is-mobile-hidden');
    // The after-services CTA card AND the footer are both gated behind
    // this same body class site-wide (style.css: ".svcd-page:not(.is-
    // past-services) .svcd-after-services/.footer" = opacity:0,
    // visibility:hidden) — previously only the desktop wheel-jack
    // controller ever toggled it, so on mobile they stayed permanently
    // invisible no matter how far you scrolled, regardless of this
    // sequence's own step/scroll logic. Mirroring the exact same toggle
    // here is what actually reveals them once the last service passes.
    document.body.classList.remove('is-past-services');
    goToStep(startStep || 1);
  }

  function disengage(forward) {
    engaged = false;
    completedForward = !!forward;
    lastDisengageAt = performance.now();
    clearTimeout(unlockTimer);
    locked = false;
    accum = 0;
    pin.classList.remove('is-mobile-engaged');
    panels.forEach(function (p) { p.classList.remove('is-mobile-active'); });
    document.body.classList.toggle('is-past-services', !!forward);
    if (forward) {
      mobileBlob.classList.remove('is-risen');
      mobileBlob.classList.add('is-exiting');
    } else {
      mobileBlob.classList.remove('is-risen', 'is-exiting');
    }
    currentStep = 0;
    if (heroRobot && !forward) heroRobot.classList.remove('is-mobile-hidden');
    var docTop = pin.getBoundingClientRect().top + window.scrollY;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var targetTop;
    if (forward && afterServicesCta) {
      targetTop = afterServicesCta.getBoundingClientRect().top + window.scrollY - 16;
    } else if (forward) {
      targetTop = docTop + vh * 1.02;
    } else {
      targetTop = Math.max(0, docTop - vh * 0.4);
    }
    window.scrollTo({ top: targetTop, behavior: 'auto' });
  }

  function onScroll() {
    if (!isMobile.matches) return;

    if (!engaged) {
      if (performance.now() - lastDisengageAt < REENGAGE_COOLDOWN_MS) return;
      var rect = pin.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      if (completedForward) {
        // Re-entry from below: scrolling back UP into a section that's
        // already been fully completed forward. Mirrors the desktop
        // controller's own re-entry handling — land back on the last
        // service rather than an empty pinned section.
        if (rect.bottom > vh * 0.6 && rect.bottom < vh * 1.4) engage(panels.length);
        return;
      }
      if (rect.top < vh * 0.55 && rect.bottom > 0) engage(1);
      return;
    }

    var delta = window.scrollY - anchorY;
    // Snap straight back — this is what "locks" real page scroll while
    // the sequence is engaged, same technique as the desktop controller's
    // own momentum-scroll safety net.
    if (window.scrollY !== anchorY) window.scrollTo(0, anchorY);
    if (locked) return;

    accum += delta;
    if (Math.abs(accum) < THRESHOLD) return;
    var dir = accum > 0 ? 1 : -1;
    accum = 0;

    if (dir > 0) {
      if (currentStep >= panels.length) { disengage(true); return; }
      goToStep(currentStep + 1);
    } else {
      if (currentStep <= 1) { disengage(false); return; }
      goToStep(currentStep - 1);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () {
    if (!isMobile.matches && engaged) disengage(false);
  });

  // Deep-links from the home page cards (services.html#ai-innovation etc.)
  // — mirrors the desktop controller's own hash handling, but engages
  // straight into THIS controller's locked-step state instead of a plain
  // scrollIntoView (which doesn't work now that panels are absolutely
  // positioned/crossfaded rather than stacked in normal flow).
  function openFromHash() {
    if (!isMobile.matches) return;
    var hash = (window.location.hash || '').replace('#', '');
    if (!hash) return;
    for (var i = 0; i < panels.length; i += 1) {
      if (panels[i].id === hash) {
        window.scrollTo({ top: pin.getBoundingClientRect().top + window.scrollY, behavior: 'auto' });
        engage(i + 1);
        return;
      }
    }
  }
  window.addEventListener('hashchange', openFromHash);
  window.setTimeout(openFromHash, 80);
})();





















/* Robot handoff is now owned by the services controller above. */
/* FAQ accordion (post-booking section, index.html). Independent
   toggles — opening one doesn't close the others. Height animation
   is handled purely in CSS via grid-template-rows driven by
   aria-expanded, so this just flips the attribute. */
(function(){
  document.querySelectorAll('.faq-item__q').forEach(function(btn){
    btn.addEventListener('click', function(){
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  });
})();

/* "Read More" reveal toggle for #coaching. Expands/collapses the
   .coaching-extra wrapper (Why E4LA / Gain / How We Work) via a
   grid-template-rows 0fr/1fr transition (see style.css) instead of an
   instant show/hide, so the sections unfold smoothly. On open, the
   .coaching-more button/text block is smoothly scrolled to the top of
   the viewport at the same time — so it settles near the top and
   stays visible while the content grows in below it, instead of the
   page jumping straight down to the revealed content. FAQ and the
   Schedule CTA live outside this wrapper in the markup, so they're
   unaffected and always visible. */
(function(){
  var btn = document.getElementById('js-coaching-more');
  var extra = document.getElementById('coaching-extra');
  if (!btn || !extra) return;
  var label = btn.querySelector('.coaching-more__label');
  var moreWrap = document.querySelector('.coaching-more');
  btn.addEventListener('click', function(){
    var open = btn.getAttribute('aria-expanded') === 'true';
    if (open) {
      btn.setAttribute('aria-expanded', 'false');
      extra.classList.remove('is-open');
      if (label) label.textContent = 'Read More';
    } else {
      btn.setAttribute('aria-expanded', 'true');
      extra.classList.add('is-open');
      if (label) label.textContent = 'Show Less';
      if (moreWrap) {
        requestAnimationFrame(function(){
          moreWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  });
})();

/* "Why E4LA" stats auto-cycle. Same exact mechanism as the
   #coaching .coaching__timeline auto-cycle above: lights up each
   stat in sequence automatically, one at a time, forever, 2s per
   step (see style.css .is-why-active for the per-item glow + scale
   that class turns on). Pauses while the tab is hidden, and respects
   prefers-reduced-motion by just lighting the first item and
   stopping there. */
(() => {
  var stats = Array.from(document.querySelectorAll('.why-stats .why-stat'));
  if (!stats.length) return;

  var STEP_MS = 2000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0;
  var timer = 0;

  function show(i) {
    stats.forEach(function (s, j) {
      s.classList.toggle('is-why-active', j === i);
    });
  }

  function tick() {
    idx = (idx + 1) % stats.length;
    show(idx);
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, STEP_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  show(0);

  if (!reduceMotion) {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }
})();

/* "What You'll Gain" auto-cycle — same mechanism as the why-stats
   one above (see style.css .is-gain-active). */
(() => {
  var items = Array.from(document.querySelectorAll('.gain-grid .gain-item'));
  if (!items.length) return;

  var STEP_MS = 2000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0;
  var timer = 0;

  function show(i) {
    items.forEach(function (s, j) {
      s.classList.toggle('is-gain-active', j === i);
    });
  }
  function tick() {
    idx = (idx + 1) % items.length;
    show(idx);
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, STEP_MS);
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  show(0);
  if (!reduceMotion) {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }
})();

/* "How We Work Together" auto-cycle — same mechanism, driven in
   step order (see style.css .is-howwork-active). */
(() => {
  var steps = Array.from(document.querySelectorAll('.howwork-steps .howwork-step'));
  if (!steps.length) return;

  var STEP_MS = 2000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var idx = 0;
  var timer = 0;

  function show(i) {
    steps.forEach(function (s, j) {
      s.classList.toggle('is-howwork-active', j === i);
    });
  }
  function tick() {
    idx = (idx + 1) % steps.length;
    show(idx);
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, STEP_MS);
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  show(0);
  if (!reduceMotion) {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }
})();
























































/* After-services CTA is controlled by the services step controller above. */















/* HOME SERVICE CARD DEEP LINKS */
document.querySelectorAll('.sec-services .svc-card[data-service-target]').forEach(function (card) {
  card.addEventListener('click', function (event) {
    if (event.target.closest('button, a')) event.preventDefault();
    window.location.href = card.getAttribute('data-service-target');
  });
  card.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.location.href = card.getAttribute('data-service-target');
    }
  });
});

