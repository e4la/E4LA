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
  setInterval(function(){idx=(idx+1)%words.length;scramble(words[idx])},3800);
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

/* FINAL SERVICES 3D TILT — clean single system */
(() => {
  const section = document.querySelector('.sec-services');
  if (!section) return;

  const cards = Array.from(section.querySelectorAll('.svc-card'));
  if (!cards.length) return;

  const canTilt = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const maxTilt = 11;
  const ease = 0.085;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const states = new WeakMap();

  function writeVars(card, state) {
    card.style.setProperty('--svc-rx', state.currentX.toFixed(3) + 'deg');
    card.style.setProperty('--svc-ry', state.currentY.toFixed(3) + 'deg');
    card.style.setProperty('--svc-scale', state.currentScale.toFixed(4));
  }

  function animate(card) {
    const state = states.get(card);
    if (!state) return;

    state.currentX += (state.targetX - state.currentX) * ease;
    state.currentY += (state.targetY - state.currentY) * ease;
    state.currentScale += (state.targetScale - state.currentScale) * ease;

    writeVars(card, state);

    const stillMoving =
      Math.abs(state.currentX - state.targetX) > 0.01 ||
      Math.abs(state.currentY - state.targetY) > 0.01 ||
      Math.abs(state.currentScale - state.targetScale) > 0.001;

    if (state.active || stillMoving) {
      state.raf = requestAnimationFrame(() => animate(card));
    } else {
      state.currentX = state.targetX = 0;
      state.currentY = state.targetY = 0;
      state.currentScale = state.targetScale = 1;
      writeVars(card, state);
      card.classList.remove('is-hovering', 'is-tilting');
      state.raf = 0;
    }
  }

  function start(card) {
    const state = states.get(card);
    if (state && !state.raf) {
      state.raf = requestAnimationFrame(() => animate(card));
    }
  }

  function reset(card) {
    const state = states.get(card);
    if (!state) return;
    state.active = false;
    state.targetX = 0;
    state.targetY = 0;
    state.targetScale = 1;
    card.classList.remove('is-hovering');
    start(card);
  }

  cards.forEach((card) => {
    const state = {
      active: false,
      raf: 0,
      currentX: 0,
      currentY: 0,
      currentScale: 1,
      targetX: 0,
      targetY: 0,
      targetScale: 1
    };

    states.set(card, state);
    card.classList.remove('is-active');
    card.setAttribute('aria-expanded', 'false');
    writeVars(card, state);

    card.addEventListener('pointerenter', () => {
      if (!canTilt.matches || reduceMotion.matches) return;
      state.active = true;
      state.targetScale = 1.035;
      card.classList.add('is-hovering', 'is-tilting');
      start(card);
    });

    card.addEventListener('pointermove', (event) => {
      if (!canTilt.matches || reduceMotion.matches) return;

      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;

      state.active = true;
      state.targetX = clamp(-y * maxTilt, -maxTilt, maxTilt);
      state.targetY = clamp(x * maxTilt, -maxTilt, maxTilt);
      state.targetScale = 1.035;
      card.classList.add('is-hovering', 'is-tilting');
      start(card);
    }, { passive: true });

    card.addEventListener('pointerleave', () => reset(card));
    card.addEventListener('blur', () => reset(card));
  });

  function hardReset() {
    cards.forEach((card) => {
      const state = states.get(card);
      if (!state) return;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.active = false;
      state.raf = 0;
      state.currentX = state.targetX = 0;
      state.currentY = state.targetY = 0;
      state.currentScale = state.targetScale = 1;
      card.classList.remove('is-active', 'is-hovering', 'is-tilting');
      card.setAttribute('aria-expanded', 'false');
      writeVars(card, state);
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

  var STEP_MS = 2000;
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

/* FINAL v2 — SERVICE CARD HOVER VIDEO. The video now IS the icon
   (no more static <img> to swap with), so it sits paused on its
   first frame at rest — reading as a normal static icon — and only
   actually plays while the card is hovered; script.js is what starts
   and stops it, since CSS can only show/hide an element, not control
   its playback. Force-paused at frame 0 as soon as it has data (some
   browsers begin playback-ready videos a frame in, or a video with
   autoplay-like attributes can start advancing on its own), then
   plays from the beginning on enter and rewinds back to frame 0 on
   leave, so it's always showing the same "icon" frame when idle.
   Independent of the tilt system's hover:hover/pointer:fine/min-
   width gate, so it also works via tap on touch devices. */
(() => {
  document.querySelectorAll('.svc-card').forEach(function (card) {
    var video = card.querySelector('.svc-icon__video');
    if (!video) return;

    function freeze() {
      video.pause();
      video.currentTime = 0;
    }

    if (video.readyState >= 1) {
      freeze();
    } else {
      video.addEventListener('loadedmetadata', freeze, { once: true });
    }

    card.addEventListener('pointerenter', function () {
      video.currentTime = 0;
      var playPromise = video.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    });
    card.addEventListener('pointerleave', freeze);
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
