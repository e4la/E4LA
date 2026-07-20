(function(){
'use strict';

/* Keep a clean mobile Home entry at the true top of the document. */
if(window.matchMedia('(max-width: 767px)').matches && !window.location.hash){
  if('scrollRestoration' in history) history.scrollRestoration='manual';
  var resetMobileHomeScroll=function(){window.scrollTo(0,0)};
  resetMobileHomeScroll();
  requestAnimationFrame(resetMobileHomeScroll);
  window.addEventListener('pageshow',resetMobileHomeScroll,{once:true});
}

/* Ã¢â€â‚¬Ã¢â€â‚¬ Scroll reveal Ã¢â€â‚¬Ã¢â€â‚¬ */
var io=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}
  })
},{threshold:.08,rootMargin:'0px 0px -20px 0px'});
document.querySelectorAll('[data-r]').forEach(function(el){io.observe(el)});

/* Ã¢â€â‚¬Ã¢â€â‚¬ Nav border on scroll Ã¢â€â‚¬Ã¢â€â‚¬ */
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

/* Ã¢â€â‚¬Ã¢â€â‚¬ Scroll delegation Ã¢â€â‚¬Ã¢â€â‚¬ */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-scroll-to]');
  if(!el)return;
  var dest=document.querySelector(el.dataset.scrollTo);
  if(dest){e.preventDefault();dest.scrollIntoView({behavior:'smooth'})}
});

/* Ã¢â€â‚¬Ã¢â€â‚¬ Word scramble Ã¢â€â‚¬Ã¢â€â‚¬ */
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

/* Ã¢â€â‚¬Ã¢â€â‚¬ Audience cards Ã¢â€â‚¬Ã¢â€â‚¬ */
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

/* Ã¢â€â‚¬Ã¢â€â‚¬ Calendar date selection Ã¢â€â‚¬Ã¢â€â‚¬ */
document.querySelectorAll('.cal__date:not(.cal__date--empty)').forEach(function(d){
  d.addEventListener('click',function(){
    document.querySelectorAll('.cal__date--today').forEach(function(x){
      x.classList.remove('cal__date--today')
    });
    d.classList.add('cal__date--today');
  });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬ Book session Ã¢â€â‚¬Ã¢â€â‚¬ */
var bookBtn=document.getElementById('js-book');
if(bookBtn && !bookBtn.hasAttribute('data-booking-open')){
  bookBtn.addEventListener('click',function(){
    window.location.href='mailto:info@e4la.org?subject=Book%20a%20Session'
  });
}

/* Ã¢â€â‚¬Ã¢â€â‚¬ Newsletter Ã¢â€â‚¬Ã¢â€â‚¬ */
var nlForm=document.getElementById('js-nl');
if(nlForm){
  nlForm.addEventListener('submit',function(e){
    e.preventDefault();
    var inp=document.getElementById('nl-email');
    var sub=nlForm.querySelector('.footer__submit');
    if(!inp.value)return;
    sub.textContent='Ã¢Å“â€œ';sub.disabled=true;inp.value='';
    setTimeout(function(){sub.textContent='Go';sub.disabled=false},3000);
  });
}

}());

/* FINAL SERVICES 3D TILT â€” REVERSED. Cards now auto-wobble on their
   own continuously at rest (a slow, gentle, desynced drift per
   card), and freeze to perfectly flat/static the moment the card is
   hovered â€” the exact opposite of the original mouse-tracking-tilt-
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

  // Distinct per-card motion "personality" â€” different frequency
  // RATIOS (not just a time-shift of the same wave), so each card
  // traces its own genuinely different Lissajous-style path instead
  // of all 5 looking like copies of one wave offset in time. Cycled
  // by index so it also holds up if more/fewer cards are ever added.
  /* Amplitudes roughly halved from the original 3.5-4.5deg range â€”
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
      // Hovered: ease to flat (no tilt) but pop the card outward â€”
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
   real, final size â€” that's circular: setting the badge bigger grows
   the button (auto height), which re-fires the ResizeObserver, which
   reads the new bigger height and grows the badge again, unbounded
   (this happened once already and produced a giant badge covering
   most of the page).

   Fix: for each button, temporarily zero out the badge's own box,
   read btn.offsetHeight (now driven only by that button's real label
   + padding + whatever else the cascade applies to it â€” this
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

  /* Blend a #rrggbb color toward white by `amt` (0-1) â€” used to make
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
     loop â€” not a dense sea-wave of many small ripples. A native SVG
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
     each time the period actually changes â€” cheap and only happens
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
       height â€” flush to the inner edge of the border on all sides).
       marginY cancels exactly the badge's added height beyond the
       original content line, so re-applying the real badgeD can
       never change naturalH on a later pass â€” no feedback possible. */
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

/* FINAL â€” APPROACH TIMELINE AUTO-CYCLE. Lights up each step (01..06)
   in sequence automatically, one at a time, forever â€” no hover
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

/* FINAL v3 â€” SERVICE CARD VIDEO: always-on autoplay loop, not
   hover-triggered. Each clip starts playing as soon as it has enough
   data and just keeps looping (the <video> tags already carry the
   `loop` attribute) â€” no pointer listeners needed anymore. Still
   pauses when the tab is hidden and resumes when it's visible again,
   so 5 looping videos aren't burning CPU/battery in a background
   tab. Respects prefers-reduced-motion by leaving the clip on its
   first frame instead of autoplaying. */
(() => {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Rest-frame offset (seconds) for each card, in DOM order â€”
  // explicit values requested by the user.
  var REST_OFFSETS = [4.9, 4.3, 2.8, 2.4, 4];
  // No real hover on touch devices, so the mouseenter/mouseleave pair
  // below never fires there â€” the clip just sat on its rest frame
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

/* FINAL â€” "HOW THE SESSION WORKS" TIMELINE AUTO-CYCLE. Same exact
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

/* â”€â”€ SERVICES DETAIL â€” pinned scroll-STEP controller (services.html) â”€â”€
   Discrete, locked steps rather than a continuous scroll-scrub: one wheel
   gesture = exactly one step forward or back (blob rises & settles -> each
   service holds fully in view, one at a time -> blob shrinks & exits), never
   less, never more. This is deliberate: a continuous 1:1 scrub let a fast
   scroll fling blow straight through a service without it ever fully
   settling on screen, and let a small scroll leave things half-transitioned.
   Locking to discrete steps (via wheel-event hijacking + preventDefault
   while "engaged") guarantees every service is fully shown before the next
   one can appear. Disabled below 901px â€” that breakpoint falls back to a
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
  // and grows exactly once, then freezes in place â€” only its color keeps
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
  // its own rAF loop â€” this is what makes each step's transition feel smooth
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
    // repainted from panelState â€” a queued frame carrying stale "hidden"
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
     ensureSmoothing() call became a silent no-op â€” steps kept advancing
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
  // layoutStatic() had just cleared their inline styles on disengage â€”
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
  // â€” gate on real touch / genuinely narrow viewports, not just "not wide",
  // so a normal (even non-maximized) desktop browser window still pins.
  var isDesktop = window.matchMedia('(min-width:640px) and (pointer:fine)');
  var activeIndex = -999; // never a real index/-1, so the very first setActive(-1) isn't a same-value no-op (it must actually strip the hardcoded "is-active" class the markup ships with on panel 0)

  // STEP MODEL â€” discrete, locked steps instead of a continuous scroll-scrub:
  //   0                       -> blob rises from below and settles, centered
  //   1..panels.length        -> that panel (step-1) held fully in view
  //   panels.length+1 (LAST)  -> blob shrinks and exits, then the section
  //                              releases into whatever comes after it
  // One wheel gesture = exactly one step forward or back, never partial â€”
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
  // previous one finished playing out â€” that's normal, gapless tweening.
  // Needs to be long enough that a single real scroll gesture (a mouse
  // wheel is rarely exactly one notch; a trackpad swipe fires many wheel
  // events over a few hundred ms) reads as ONE step, not several â€” too
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
  // traced back to stale CSS/JS caches â€” this removes that dependency
  // for the pin/slide mechanic specifically). Visual styling like colors
  // and fonts still comes from style.css; only the load-bearing layout
  // properties are re-asserted here.
  // set(el, prop, value) uses setProperty(...,'important') instead of the
  // plain .style.prop = value shorthand. A plain inline style can still be
  // beaten by an external stylesheet rule that happens to use !important
  // (this codebase's style.css has plenty of those from older passes) â€”
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
  // â€” but only ever as a small embellishment *within* an already-held,
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
    // to *something* stamping the panel back to hidden on real machines â€”
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
    // hold lifts, painting resumes from exactly what's on screen â€” no jump.
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
    // hasn't moved from the point of engagement â€” nudge it clear of the
    // wrapper so checkEngage()'s "dominant in viewport" test (below) no
    // longer holds. This does NOT need to fully clear the wrapper's whole
    // height (the page's content below it may not even be that tall) â€”
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
  // and NOT a timer here â€” it tracks the scrollbar 1:1 as the wrapper enters
  // the viewport, exactly mirroring how the blob's exit already behaves at
  // the other end of the sequence. This is what removes the old dead-zone
  // (a long stretch of scrolling with zero visible feedback before the blob
  // would suddenly pop in) â€” the very first pixel of scroll into this
  // section already moves the blob. Only once it's fully arrived does the
  // locked step-by-step system for the panels actually engage.
  function updateApproach() {
    // Once the forward journey through this section has ever been fully
    // completed, this function has NOTHING further to do â€” re-entry from
    // below is handled exclusively by onWheel()'s own deltaY direction (see
    // above), never by re-deriving direction from scrollY here. Continuing
    // to scroll down (or sitting still at whatever the page's natural
    // scroll maximum happens to be, which may leave this section's rect
    // still technically overlapping if the remaining page content below it
    // isn't a full viewport tall) must never re-engage anything again.
    if (!isDesktop.matches || engaged || completedForward) return;
    ensureBlobInSlot();
    var rect = pin.getBoundingClientRect();

    // 0 = the very top of the page (scrollY 0) â€” the hero shows clean, blob
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
      // â€” "from far, closer, bigger", never "up from below": ty stays 0 the
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
    // they'd scrolled â€” the site could never actually reach its own footer.
    // rect.bottom>0 means the wrapper is still genuinely at/near the
    // viewport; once truly scrolled past it, this must never re-fire.
    // Wheel owns the actual pin/step handoff. updateApproach only previews the approach state.
  }

  // ROOT CAUSE of "deep link shows the sphere but no text", confirmed via
  // on-page diagnostics (panel opacity 1, text fully painted, yet panel
  // rect exactly one full height ABOVE the stage): the browser's own
  // scroll-to-#fragment logic targets the panel INSIDE .svcd-pin__list /
  // .svcd-pin__stage â€” both overflow:hidden â€” and scrolls their internal
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
      // "engaged" â€” which would let the section below peek into view while
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

/* MOBILE SERVICES â€” SINGLE CLEAN PINNED CONTROLLER.
   One state machine owns Hero -> five services -> CTA. */
(function () {
  var mobile = window.matchMedia('(max-width: 639px), (pointer: coarse)');
  var pin = document.querySelector('.svcd-pin');
  if (!pin) return;
  var panels = Array.prototype.slice.call(pin.querySelectorAll('.svcd-pin__panel'));
  var sphere = document.getElementById('js-pin-mobile-blob');
  var hero = document.querySelector('.svcd-hero');
  var cta = document.querySelector('.svcd-after-services');
  if (!panels.length || !sphere || !hero || !cta) return;

  var active = false;
  var index = 0;
  var completedForward = false;
  var inputLocked = false;
  var unlockTimer = 0;
  var touchActive = false;
  var touchCandidate = false;
  var startX = 0;
  var startY = 0;
  var currentX = 0;
  var currentY = 0;
  var SWIPE_DISTANCE = 24;
  var STEP_LOCK_MS = 1080;

  function copySphereTheme(panel) {
    var style = window.getComputedStyle(panel);
    ['--row-c', '--row-g1', '--row-g2', '--row-g3', '--row-g4', '--row-g5', '--blob-spin'].forEach(function (name) {
      var value = style.getPropertyValue(name);
      if (value) sphere.style.setProperty(name, value.trim());
    });
  }

  function render() {
    panels.forEach(function (panel, panelIndex) {
      panel.classList.toggle('is-mobile-active', active && panelIndex === index);
    });
    if (active) {
      copySphereTheme(panels[index]);
      sphere.classList.add('is-risen');
    } else {
      sphere.classList.remove('is-risen', 'is-exiting');
    }
  }

  function lockInput() {
    inputLocked = true;
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(function () { inputLocked = false; }, STEP_LOCK_MS);
  }

  function enterServices(startIndex) {
    active = true;
    index = Math.max(0, Math.min(panels.length - 1, startIndex || 0));
    document.body.classList.remove('is-past-services');
    pin.classList.add('is-mobile-sequence');
    window.scrollTo({ top: pin.getBoundingClientRect().top + window.scrollY, behavior: 'auto' });
    render();
    lockInput();
  }

  function leaveServices(forward) {
    active = false;
    pin.classList.remove('is-mobile-sequence');
    completedForward = !!forward;
    document.body.classList.toggle('is-past-services', completedForward);
    render();
    lockInput();
    (forward ? cta : hero).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function move(direction) {
    if (!active || inputLocked) return;
    if (direction > 0) {
      if (index === panels.length - 1) leaveServices(true);
      else {
        index += 1;
        render();
        lockInput();
      }
    } else if (index === 0) {
      leaveServices(false);
    } else {
      index -= 1;
      render();
      lockInput();
    }
  }

  function isNearEntry() {
    var rect = pin.getBoundingClientRect();
    var viewport = window.innerHeight || document.documentElement.clientHeight || 800;
    return rect.top <= viewport * 1.2 && rect.bottom > 0;
  }

  window.addEventListener('wheel', function (event) {
    if (!mobile.matches || Math.abs(event.deltaY) < 2) return;
    if (active) {
      event.preventDefault();
      move(event.deltaY > 0 ? 1 : -1);
      return;
    }
    if (event.deltaY > 0 && !completedForward && isNearEntry()) {
      event.preventDefault();
      enterServices(0);
      return;
    }
    if (event.deltaY < 0 && completedForward) {
      event.preventDefault();
      enterServices(panels.length - 1);
    }
  }, { passive: false, capture: true });

  window.addEventListener('touchstart', function (event) {
    if (!mobile.matches || event.touches.length !== 1) return;
    touchCandidate = active || completedForward || isNearEntry();
    if (!touchCandidate) return;
    touchActive = true;
    startX = currentX = event.touches[0].clientX;
    startY = currentY = event.touches[0].clientY;
  }, { passive: true, capture: true });

  window.addEventListener('touchmove', function (event) {
    if (!touchActive || !event.touches.length) return;
    currentX = event.touches[0].clientX;
    currentY = event.touches[0].clientY;
    if (Math.abs(startY - currentY) > Math.abs(startX - currentX)) event.preventDefault();
  }, { passive: false, capture: true });

  window.addEventListener('touchend', function (event) {
    if (!touchActive) return;
    if (event.changedTouches && event.changedTouches.length) {
      currentX = event.changedTouches[0].clientX;
      currentY = event.changedTouches[0].clientY;
    }
    touchActive = false;
    var dx = startX - currentX;
    var dy = startY - currentY;
    if (Math.abs(dy) <= Math.abs(dx) || Math.abs(dy) < SWIPE_DISTANCE) return;
    if (!active) {
      if (dy > 0 && !completedForward && isNearEntry()) enterServices(0);
      else if (dy < 0 && completedForward) enterServices(panels.length - 1);
      return;
    }
    move(dy > 0 ? 1 : -1);
  }, { passive: true, capture: true });

  window.addEventListener('touchcancel', function () {
    touchActive = false;
    touchCandidate = false;
  }, { passive: true, capture: true });

  window.addEventListener('resize', function () {
    if (!mobile.matches && active) {
      active = false;
      pin.classList.remove('is-mobile-sequence');
      render();
    }
  });
})();
/* Robot handoff is now owned by the services controller above. */
/* FAQ accordion (post-booking section, index.html). Independent
   toggles â€” opening one doesn't close the others. Height animation
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
   the viewport at the same time â€” so it settles near the top and
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

/* "What You'll Gain" auto-cycle â€” same mechanism as the why-stats
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

/* "How We Work Together" auto-cycle â€” same mechanism, driven in
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



/* FINAL FUNCTIONAL BOOKING CALENDAR */
(() => {
  const calendar = document.querySelector('.calendar-widget');
  if (!calendar) return;

  const STORAGE_KEY = 'e4laBookingState';
  const LEGACY_APPOINTMENT_STORAGE_KEY = 'e4laBookingAppointment';
  const TIMEZONE = 'America/Los_Angeles';
  const DURATION = 60;
  const SESSION_TYPE = '1:1 Vision Strategy Session';
  const monthLabel = calendar.querySelector('.cal__month');
  const prevButton = calendar.querySelector('.cal__btn[aria-label="Previous month"]');
  const nextButton = calendar.querySelector('.cal__btn[aria-label="Next month"]');
  const grid = calendar.querySelector('.cal__grid');
  const timeList = calendar.querySelector('.cal__time-list');
  const bookButton = calendar.querySelector('#js-book');
  const note = calendar.querySelector('.cal__note');
  const weekdayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const availability = {
    weekdaySlots: ['09:00', '11:00', '14:00', '16:00'],
    fridaySlots: ['09:00', '11:00', '13:00'],
    saturdaySlots: ['10:00', '12:00'],
    blockedIsoDates: []
  };

  const today = stripTime(new Date());
  const bookingEnd = addMonths(today, 6);
  let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let state = loadState();

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addMonths(date, amount) {
    return new Date(date.getFullYear(), date.getMonth() + amount, date.getDate());
  }

  function toIso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromIso(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function sameDate(a, b) {
    return a && b && toIso(a) === toIso(b);
  }

  function getMonthKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  function normalizeState(raw) {
    return {
      sessionType: raw?.sessionType || SESSION_TYPE,
      date: raw?.date || '',
      startTime: raw?.startTime || '',
      endTime: raw?.endTime || '',
      timezone: TIMEZONE,
      durationMinutes: DURATION
    };
  }

  function loadState() {
    try {
      const flowState = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      let legacyAppointment = {};
      try { legacyAppointment = JSON.parse(sessionStorage.getItem(LEGACY_APPOINTMENT_STORAGE_KEY) || '{}'); } catch (error) {}
      const saved = normalizeState(flowState.appointment || legacyAppointment || {});
      const selectedDate = fromIso(saved.date);
      if (!selectedDate || !isInsideWindow(selectedDate) || !getSlotsForDate(selectedDate).length) {
        return normalizeState({});
      }
      if (saved.startTime && getSlotsForDate(selectedDate).includes(saved.startTime)) {
        saved.endTime = addMinutesToTime(saved.startTime, DURATION);
        visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        return saved;
      }
      saved.startTime = '';
      saved.endTime = '';
      return saved;
    } catch (error) {
      return normalizeState({});
    }
  }

  function saveState() {
    try {
      const flowState = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      flowState.appointment = { ...state };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flowState));
    } catch (error) {}
  }

  function isPast(date) {
    return date < today;
  }

  function isInsideWindow(date) {
    return date >= today && date <= bookingEnd;
  }

  function getSlotsForDate(date) {
    const iso = toIso(date);
    if (availability.blockedIsoDates.includes(iso)) return [];
    const day = date.getDay();
    if (day === 0) return [];
    if (day === 6) return availability.saturdaySlots;
    if (day === 5) return availability.fridaySlots;
    return availability.weekdaySlots;
  }

  function isAvailable(date) {
    return isInsideWindow(date) && getSlotsForDate(date).length > 0;
  }

  function renderCalendar() {
    if (!monthLabel || !grid) return;
    monthLabel.textContent = monthFormatter.format(visibleMonth);
    grid.setAttribute('aria-label', monthFormatter.format(visibleMonth));
    grid.innerHTML = weekdayNames.map((day) => `<div class="cal__day-name">${day}</div>`).join('');

    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();

    for (let i = 0; i < firstDay; i += 1) {
      grid.appendChild(createEmptyCell());
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
      grid.appendChild(createDateCell(date));
    }

    updateMonthButtons();
    renderTimes();
    updateBookButton();
    updateSummary();
  }

  function createEmptyCell() {
    const cell = document.createElement('div');
    cell.className = 'cal__date cal__date--empty';
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  }

  function createDateCell(date) {
    const button = document.createElement('button');
    const iso = toIso(date);
    const available = isAvailable(date);
    const selected = state.date === iso;
    button.type = 'button';
    button.className = 'cal__date';
    button.textContent = String(date.getDate());
    button.dataset.date = iso;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `Select ${dateFormatter.format(date)}`);

    if (isPast(date)) button.classList.add('cal__date--past');
    else if (!isInsideWindow(date)) button.classList.add('cal__date--outside-window');
    else if (!available) button.classList.add('cal__date--unavailable');
    else button.classList.add('cal__date--available');

    if (sameDate(date, today)) button.classList.add('cal__date--today');
    if (selected) {
      button.classList.add('cal__date--selected');
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.setAttribute('aria-pressed', 'false');
    }

    if (!available) {
      button.disabled = true;
      button.tabIndex = -1;
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.addEventListener('click', () => selectDate(iso));
      button.addEventListener('keydown', handleDateKeyboard);
    }
    return button;
  }

  function selectDate(iso) {
    if (state.date !== iso) {
      state.date = iso;
      state.startTime = '';
      state.endTime = '';
    }
    state.sessionType = SESSION_TYPE;
    saveState();
    renderCalendar();
    showMessage('Choose a time for your selected date.');
  }

  function handleDateKeyboard(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(grid.querySelectorAll('.cal__date--available'));
    const current = buttons.indexOf(event.currentTarget);
    let next = current;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, current + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, current - 7);
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 7);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    buttons[next]?.focus();
  }

  function renderTimes() {
    if (!timeList) return;
    timeList.innerHTML = '';
    const date = fromIso(state.date);
    if (!date || !isAvailable(date)) {
      timeList.innerHTML = '<p class="cal__message">Select an available date to see times.</p>';
      return;
    }

    getSlotsForDate(date).forEach((slot) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal__time-slot';
      button.textContent = formatTime(slot);
      button.dataset.time = slot;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', state.startTime === slot ? 'true' : 'false');
      if (state.startTime === slot) button.classList.add('is-selected');
      button.addEventListener('click', () => selectTime(slot));
      timeList.appendChild(button);
    });
  }

  function selectTime(time) {
    state.sessionType = SESSION_TYPE;
    state.startTime = time;
    state.endTime = addMinutesToTime(time, DURATION);
    saveState();
    renderTimes();
    updateBookButton();
    updateSummary();
    showMessage('Date and time selected. You can book now.');
  }

  function updateMonthButtons() {
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const maxMonth = new Date(bookingEnd.getFullYear(), bookingEnd.getMonth(), 1);
    if (prevButton) prevButton.disabled = getMonthKey(visibleMonth) === getMonthKey(minMonth);
    if (nextButton) nextButton.disabled = getMonthKey(visibleMonth) === getMonthKey(maxMonth);
  }

  function updateBookButton() {
    const valid = hasValidAppointment();
    if (!bookButton) return;
    bookButton.disabled = !valid;
    bookButton.setAttribute('aria-disabled', String(!valid));
  }

  function hasValidAppointment() {
    if (!state.sessionType || !state.date || !state.startTime || !state.endTime) return false;
    const date = fromIso(state.date);
    return Boolean(date && isAvailable(date) && getSlotsForDate(date).includes(state.startTime));
  }

  function updateSummary() {
    document.querySelectorAll('[data-booking-summary]').forEach((item) => {
      const key = item.dataset.bookingSummary;
      if (key === 'sessionType') item.textContent = state.sessionType || SESSION_TYPE;
      if (key === 'date') item.textContent = state.date ? formatDateDisplay(state.date) : 'Select a date';
      if (key === 'time') item.textContent = state.startTime ? formatTimeRange(state.startTime, state.endTime) : 'Select a time';
      if (key === 'duration') item.textContent = `${state.durationMinutes || DURATION} minutes`;
    });
    window.E4LABookingFlow?.refreshSummary?.();
  }

  function formatDateDisplay(iso) {
    const date = fromIso(iso);
    return date ? dateFormatter.format(date) : 'Select a date';
  }

  function formatTime(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, hours, minutes));
  }

  function formatTimeRange(start, end) {
    const date = fromIso(state.date) || today;
    return `${formatTime(start)} - ${formatTime(end)} (${getTimezoneName(date)})`;
  }

  function addMinutesToTime(time, minutesToAdd) {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date(2026, 0, 1, hours, minutes + minutesToAdd);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function getTimezoneName(date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value || 'MT';
  }

  function showMessage(message) {
    if (note) note.textContent = message;
  }

  function goToMonth(delta) {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1);
    renderCalendar();
  }

  prevButton?.addEventListener('click', () => goToMonth(-1));
  nextButton?.addEventListener('click', () => goToMonth(1));

  function setAppointment(nextAppointment) {
    state = normalizeState(nextAppointment || {});
    const selectedDate = fromIso(state.date);
    if (selectedDate && isInsideWindow(selectedDate)) {
      visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    saveState();
    renderCalendar();
  }

  function createAppointmentEditor(editor) {
    if (!editor) return null;
    const editorMonthLabel = editor.querySelector('.cal__month');
    const editorPrevButton = editor.querySelector('.cal__btn[aria-label="Previous month"]');
    const editorNextButton = editor.querySelector('.cal__btn[aria-label="Next month"]');
    const editorGrid = editor.querySelector('.cal__grid');
    const editorTimeList = editor.querySelector('.cal__time-list');
    const editorSaveButton = editor.querySelector('[data-appointment-save]');
    const editorWarning = editor.querySelector('.appointment-edit-modal__warning');
    const editorTimezone = editor.querySelector('.cal__timezone');
    let draft = normalizeState({});
    let editorVisibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    function open(appointment) {
      draft = normalizeState(appointment || state || {});
      const selectedDate = fromIso(draft.date);
      editorWarning.hidden = true;
      editorWarning.textContent = '';
      if (selectedDate && isInsideWindow(selectedDate)) {
        editorVisibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
        const slots = getSlotsForDate(selectedDate);
        if (draft.startTime && !slots.includes(draft.startTime)) {
          draft.startTime = '';
          draft.endTime = '';
          showEditorWarning('That time is no longer available. Please choose another time.');
        }
      } else {
        draft.date = '';
        draft.startTime = '';
        draft.endTime = '';
        editorVisibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      }
      renderEditor();
    }

    function renderEditor() {
      if (!editorMonthLabel || !editorGrid) return;
      editorMonthLabel.textContent = monthFormatter.format(editorVisibleMonth);
      editorGrid.setAttribute('aria-label', monthFormatter.format(editorVisibleMonth));
      editorGrid.innerHTML = weekdayNames.map((day) => `<div class="cal__day-name">${day}</div>`).join('');
      if (editorTimezone) editorTimezone.textContent = 'Times shown in Pacific Time';

      const firstDay = new Date(editorVisibleMonth.getFullYear(), editorVisibleMonth.getMonth(), 1).getDay();
      const daysInMonth = new Date(editorVisibleMonth.getFullYear(), editorVisibleMonth.getMonth() + 1, 0).getDate();
      for (let i = 0; i < firstDay; i += 1) editorGrid.appendChild(createEmptyCell());
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(editorVisibleMonth.getFullYear(), editorVisibleMonth.getMonth(), day);
        editorGrid.appendChild(createEditorDateCell(date));
      }
      updateEditorMonthButtons();
      renderEditorTimes();
      updateEditorSaveButton();
    }

    function createEditorDateCell(date) {
      const button = document.createElement('button');
      const iso = toIso(date);
      const available = isAvailable(date);
      const selected = draft.date === iso;
      button.type = 'button';
      button.className = 'cal__date';
      button.textContent = String(date.getDate());
      button.dataset.date = iso;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `Select ${dateFormatter.format(date)}`);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (isPast(date)) button.classList.add('cal__date--past');
      else if (!isInsideWindow(date)) button.classList.add('cal__date--outside-window');
      else if (!available) button.classList.add('cal__date--unavailable');
      else button.classList.add('cal__date--available');
      if (sameDate(date, today)) button.classList.add('cal__date--today');
      if (selected) button.classList.add('cal__date--selected');
      if (!available) {
        button.disabled = true;
        button.tabIndex = -1;
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.addEventListener('click', () => selectEditorDate(iso));
        button.addEventListener('keydown', handleEditorDateKeyboard);
      }
      return button;
    }

    function selectEditorDate(iso) {
      if (draft.date !== iso) {
        draft.date = iso;
        draft.startTime = '';
        draft.endTime = '';
      }
      hideEditorWarning();
      renderEditor();
    }

    function handleEditorDateKeyboard(event) {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(editorGrid.querySelectorAll('.cal__date--available'));
      const current = buttons.indexOf(event.currentTarget);
      let next = current;
      if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
      if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, current + 1);
      if (event.key === 'ArrowUp') next = Math.max(0, current - 7);
      if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 7);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      buttons[next]?.focus();
    }

    function renderEditorTimes() {
      if (!editorTimeList) return;
      editorTimeList.innerHTML = '';
      const date = fromIso(draft.date);
      if (!date || !isAvailable(date)) {
        editorTimeList.innerHTML = '<p class="cal__message">Select an available date to see times.</p>';
        return;
      }
      getSlotsForDate(date).forEach((slot) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cal__time-slot';
        button.textContent = formatTime(slot);
        button.dataset.time = slot;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', draft.startTime === slot ? 'true' : 'false');
        if (draft.startTime === slot) button.classList.add('is-selected');
        button.addEventListener('click', () => selectEditorTime(slot));
        editorTimeList.appendChild(button);
      });
    }

    function selectEditorTime(slot) {
      draft.startTime = slot;
      draft.endTime = addMinutesToTime(slot, DURATION);
      hideEditorWarning();
      renderEditorTimes();
      updateEditorSaveButton();
    }

    function updateEditorMonthButtons() {
      const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const maxMonth = new Date(bookingEnd.getFullYear(), bookingEnd.getMonth(), 1);
      if (editorPrevButton) editorPrevButton.disabled = getMonthKey(editorVisibleMonth) === getMonthKey(minMonth);
      if (editorNextButton) editorNextButton.disabled = getMonthKey(editorVisibleMonth) === getMonthKey(maxMonth);
    }

    function updateEditorSaveButton() {
      if (editorSaveButton) editorSaveButton.disabled = !isDraftValid();
    }

    function isDraftValid() {
      if (!draft.date || !draft.startTime || !draft.endTime) return false;
      const date = fromIso(draft.date);
      return Boolean(date && isAvailable(date) && getSlotsForDate(date).includes(draft.startTime));
    }

    function showEditorWarning(message) {
      if (!editorWarning) return;
      editorWarning.textContent = message;
      editorWarning.hidden = false;
    }

    function hideEditorWarning() {
      if (!editorWarning) return;
      editorWarning.textContent = '';
      editorWarning.hidden = true;
    }

    function goToEditorMonth(delta) {
      editorVisibleMonth = new Date(editorVisibleMonth.getFullYear(), editorVisibleMonth.getMonth() + delta, 1);
      renderEditor();
    }

    editorPrevButton?.addEventListener('click', () => goToEditorMonth(-1));
    editorNextButton?.addEventListener('click', () => goToEditorMonth(1));

    return {
      open,
      isValid: isDraftValid,
      getDraft: () => ({ ...draft }),
      focusInitial: () => editor.querySelector('.cal__date--selected, .cal__date--available, [data-appointment-cancel], button:not([disabled])')?.focus({ preventScroll: true })
    };
  }
  window.E4LABookingCalendar = {
    hasValidAppointment,
    setAppointment,
    createAppointmentEditor,
    syncSummary: updateSummary,
    showMessage,
    getState: () => ({ ...state })
  };

  renderCalendar();
})();
/* FINAL BOOKING POPUP MODAL */
(() => {
  const modal = document.getElementById('booking-modal');
  if (!modal) return;
  if (!modal.dataset.legacyBookingFlowDisabled) { modal.dataset.legacyBookingFlowDisabled = 'true'; return; }

  const FLOW_STORAGE_KEY = 'e4laBookingState';
  const APPOINTMENT_STORAGE_KEY = 'e4laBookingAppointment';
  const defaultState = {
    appointment: {
      sessionType: '',
      date: '',
      startTime: '',
      endTime: '',
      timezone: '',
      durationMinutes: 60
    },
    personalInfo: {
      fullName: '',
      email: '',
      phone: '',
      company: '',
      role: '',
      referralSource: ''
    },
    bookingReason: '',
    details: {
      mainChallenge: '',
      desiredOutcome: '',
      workedWithConsultant: '',
      aiExperience: '',
      previousAttempts: ''
    },
    finalDetails: {
      reviewItems: [],
      notes: '',
      policyAccepted: false,
      selectedFiles: []
    }
  };

  const openers = document.querySelectorAll('[data-booking-open]');
  const closers = modal.querySelectorAll('[data-booking-close]');
  const stepButtons = modal.querySelectorAll('[data-booking-step]');
  const choices = modal.querySelectorAll('.booking-choice input[type="radio"]');
  const countedFields = modal.querySelectorAll('textarea[maxlength]');
  const summaryEditButtons = modal.querySelectorAll('[data-booking-edit]');
  const appointmentEditor = document.getElementById('booking-appointment-editor');
  const appointmentCancelButtons = appointmentEditor?.querySelectorAll('[data-appointment-cancel]') || [];
  const appointmentSaveButton = appointmentEditor?.querySelector('[data-appointment-save]');
  const step1Next = modal.querySelector('[data-booking-panel="1"] .booking-submit');
  const step2Next = modal.querySelector('[data-booking-panel="2"] .booking-submit[data-booking-step="3"]');
  const step3Next = modal.querySelector('[data-booking-panel="3"] .booking-submit');
  const confirmButton = modal.querySelector('[data-confirm-booking]');
  const confirmMessage = modal.querySelector('[data-confirm-message]');
  const reviewContent = modal.querySelector('[data-booking-review-content]');
  const successContent = modal.querySelector('[data-booking-success]');
  const successTitle = modal.querySelector('[data-success-title]');
  const successSessionType = modal.querySelector('[data-success-session-type]');
  const successPrepCopy = modal.querySelector('[data-success-prep-copy]');
  const successMessage = modal.querySelector('[data-success-message]');
  const returnHomeButton = modal.querySelector('[data-return-home]');
  const addCalendarButton = modal.querySelector('[data-add-calendar]');
  const reviewList = modal.querySelector('[data-booking-review]');
  const prepInputs = modal.querySelectorAll('input[name="booking-prep"]');
  const prepPanels = modal.querySelectorAll('[data-prep-panel]');
  const uploadInput = modal.querySelector('#booking-files');
  const uploadDrop = modal.querySelector('[data-upload-drop]');
  const uploadBrowse = modal.querySelector('[data-upload-browse]');
  const uploadList = modal.querySelector('[data-upload-list]');
  const uploadError = modal.querySelector('[data-upload-error]');
  const policyInput = modal.querySelector('#booking-policy');
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const ALLOWED_FILE_EXTENSIONS = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
  const touched = new Set();
  let bookingState = loadBookingState();
  let lastFocused = null;
  let navigationLocked = false;
  let submitAttempted = false;
  let appointmentEditorControl = window.E4LABookingCalendar?.createAppointmentEditor?.(appointmentEditor) || null;
  let lastAppointmentEditTrigger = null;
  let appointmentSaveLocked = false;
  let confirmLocked = false;
  let activeFinalFiles = [];

  const fields = {
    fullName: modal.querySelector('#booking-name'),
    email: modal.querySelector('#booking-email'),
    phone: modal.querySelector('#booking-phone'),
    company: modal.querySelector('#booking-company'),
    role: modal.querySelector('#booking-role'),
    referralSource: modal.querySelector('#booking-source'),
    mainChallenge: modal.querySelector('#booking-challenge'),
    desiredOutcome: modal.querySelector('#booking-success'),
    previousAttempts: modal.querySelector('#booking-tried'),
    notes: modal.querySelector('#booking-final-notes')
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadBookingState() {
    let saved = {};
    let appointment = {};
    try { saved = JSON.parse(sessionStorage.getItem(FLOW_STORAGE_KEY) || '{}'); } catch (error) {}
    try { appointment = JSON.parse(sessionStorage.getItem(APPOINTMENT_STORAGE_KEY) || '{}'); } catch (error) {}
    const merged = mergeState(defaultState, saved);
    merged.appointment = mergeState(defaultState.appointment, saved.appointment || appointment || {});
    return merged;
  }

  function mergeState(base, patch) {
    const output = clone(base);
    Object.keys(patch || {}).forEach((key) => {
      if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) && output[key]) {
        output[key] = mergeState(output[key], patch[key]);
      } else if (patch[key] !== undefined) {
        output[key] = patch[key];
      }
    });
    return output;
  }

  function saveBookingState() {
    sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(bookingState));
  }

  function hasValidAppointment() {
    const a = bookingState.appointment;
    return Boolean(a.sessionType && a.date && a.startTime && a.endTime && a.timezone && Number(a.durationMinutes));
  }

  function syncAppointmentFromCalendar() {
    const calendarState = window.E4LABookingCalendar?.getState?.();
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(APPOINTMENT_STORAGE_KEY) || '{}'); } catch (error) {}
    const appointment = calendarState || stored;
    bookingState.appointment = mergeState(defaultState.appointment, appointment || {});
    saveBookingState();
  }

  function getFocusable() {
    return Array.from(modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  }

  function updateProgress(step) {
    modal.querySelectorAll('[data-progress-step]').forEach((item) => {
      const itemStep = Number(item.getAttribute('data-progress-step'));
      const badge = item.querySelector('b');
      item.classList.toggle('is-complete', itemStep < step);
      item.classList.toggle('is-active', itemStep === step);
      if (badge) badge.textContent = itemStep < step ? 'âœ“' : String(itemStep);
    });
  }

      function setBookingStep(step) {
    const guardedStep = getAllowedStep(Math.max(1, Math.min(Number(step) || 1, 3)));
    modal.dataset.step = String(guardedStep);
    updateProgress(guardedStep);

    modal.querySelectorAll('[data-booking-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-booking-panel') !== String(guardedStep);
    });

    const activePanel = modal.querySelector(`[data-booking-panel="${guardedStep}"]`);
    const focusTarget = activePanel?.querySelector('input, textarea, select, button:not([disabled])') || getFocusable()[0];
    requestAnimationFrame(() => {
      modal.querySelector('.booking-modal__shell')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      focusTarget?.focus({ preventScroll: true });
    });
  }

  function getAllowedStep(requestedStep) {
    if (!hasValidAppointment()) return 1;
    if (requestedStep >= 2 && !isStep2Valid(false)) return 1;
    if (requestedStep >= 3 && !isStep1Valid(false)) return 2;
    return requestedStep;
  }

      function updateButtons() {
    if (step1Next) {
      step1Next.disabled = !isStep2Valid(false);
      const label = bookingState.bookingReason ? `Continue with ${bookingState.bookingReason}` : 'Continue';
      step1Next.innerHTML = `${escapeHtml(label)} <span aria-hidden="true">&rarr;</span>`;
    }
    if (step2Next) step2Next.disabled = !isStep1Valid(false);
    if (step3Next) step3Next.disabled = !isStep3Valid(false);
    if (confirmButton) confirmButton.disabled = !isStep3Valid(false);
  }

  function markInvalid(control, message, show) {
    if (!control) return false;
    const wrapper = control.closest('.booking-field, .booking-question, .booking-policy') || control.closest('fieldset') || control.parentElement;
    let error = wrapper.querySelector('.booking-error');
    if (!error) {
      error = document.createElement('small');
      error.className = 'booking-error';
      error.setAttribute('role', 'alert');
      wrapper.appendChild(error);
    }
    control.classList.toggle('is-invalid', show && Boolean(message));
    wrapper.classList.toggle('is-invalid', show && Boolean(message));
    error.textContent = show && message ? message : '';
    error.hidden = !(show && message);
    return !message;
  }

  function validateRequired(control, message, show) {
    const invalid = !String(control?.value || '').trim();
    return markInvalid(control, invalid ? message : '', show);
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function isValidPhone(value) {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function isStep1Valid(show) {
    const ok = Boolean(bookingState.bookingReason);
    const group = modal.querySelector('[data-booking-panel="1"] .booking-choice-grid');
    let error = group?.querySelector('.booking-error');
    if (group && !error) { error = document.createElement('small'); error.className = 'booking-error'; error.setAttribute('role', 'alert'); group.appendChild(error); }
    if (group && error) { group.classList.toggle('is-invalid', show && !ok); error.textContent = show && !ok ? 'Please choose one primary focus.' : ''; error.hidden = !show || ok; }
    return ok;
  }
  function isStep2Valid(show) {
    const checks = [];
    checks.push(validateRequired(fields.fullName, 'Please enter your full name.', show));
    const email = fields.email?.value || '';
    checks.push(markInvalid(fields.email, !email.trim() ? 'Please enter your email.' : !isValidEmail(email) ? 'Please enter a valid email address.' : '', show));
    const phone = fields.phone?.value || '';
    checks.push(markInvalid(fields.phone, !phone.trim() ? 'Please enter your phone number.' : !isValidPhone(phone) ? 'Please enter a valid phone number.' : '', show));
    return checks.every(Boolean);
  }
  function isReviewValid(show) { const accepted = Boolean(policyInput?.checked); markInvalid(policyInput, accepted ? '' : 'Please agree to the session policy before confirming.', show); return hasValidAppointment() && isStep1Valid(false) && isStep2Valid(false) && accepted; }
  function getAllowedStep(step) { if (!hasValidAppointment()) return 1; if (step >= 2 && !isStep1Valid(false)) return 1; if (step >= 3 && !isStep2Valid(false)) return 2; return step; }
  function setBookingStep(step, options = {}) { const requested = Math.max(1, Math.min(Number(step) || 1, 6)); const guarded = options.force ? requested : getAllowedStep(requested); modal.dataset.step = String(guarded); updateProgress(guarded); modal.querySelectorAll('[data-booking-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-booking-panel') !== String(guarded); }); if (guarded !== 6 || !bookingState.confirmed) resetSuccessScreen(); updateButtons(); renderReviewSection(); const activePanel = modal.querySelector('[data-booking-panel="' + guarded + '"]'); const focusTarget = activePanel?.querySelector('input, textarea, select, button:not([disabled])') || getFocusable()[0]; requestAnimationFrame(() => {
      modal.querySelector('.booking-modal__shell')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      focusTarget?.focus({ preventScroll: true });
    }); }
  function updateProgress(step) { modal.querySelectorAll('[data-progress-step]').forEach((item) => { const itemStep = Number(item.dataset.progressStep); const badge = item.querySelector('b'); item.classList.toggle('is-complete', itemStep < step); item.classList.toggle('is-active', itemStep === step); if (badge) badge.textContent = String(itemStep); }); }
  function updateButtons() { modal.querySelector('[data-booking-panel="1"] .booking-submit')?.toggleAttribute('disabled', !isStep1Valid(false)); modal.querySelector('[data-open-optional-notice]')?.toggleAttribute('disabled', !isStep2Valid(false)); if (confirmButton) confirmButton.disabled = !isReviewValid(false); updatePriorityUI(); }
  function syncPersonalInfo() { bookingState.personalInfo.fullName = fields.fullName?.value.trim() || ''; bookingState.personalInfo.email = fields.email?.value.trim() || ''; bookingState.personalInfo.phone = fields.phone?.value.trim() || ''; bookingState.personalInfo.company = fields.company?.value.trim() || ''; bookingState.personalInfo.role = fields.role?.value.trim() || ''; bookingState.personalInfo.referralSource = fields.referralSource?.value || ''; saveBookingState(); updateSummary(); updateButtons(); }
  function syncOptionalDetails() { const o = bookingState.optionalDetails; o.biggestChallenge = fields.biggestChallenge?.value.trim() || ''; o.desiredOutcome = fields.desiredOutcome?.value.trim() || ''; o.previousAttempts = fields.previousAttempts?.value.trim() || ''; o.consultantExperience = modal.querySelector('input[name="consultant-before"]:checked')?.value || ''; o.aiExperience = modal.querySelector('input[name="ai-use"]:checked')?.value || ''; o.reviewItems = Array.from(reviewInputs).filter((input) => input.checked).map((input) => input.value); o.notes = fields.notes?.value.trim() || ''; o.selectedFileMetadata = activeFinalFiles.map((file) => ({ name: file.name, size: file.size, type: file.type || '' })); saveBookingState(); updateCounters(); updateSummary(); renderReviewSection(); renderUploadList(); updateButtons(); }
  function applyStateToUI() { const p = bookingState.personalInfo, o = bookingState.optionalDetails; if (fields.fullName) fields.fullName.value = p.fullName || ''; if (fields.email) fields.email.value = p.email || ''; if (fields.phone) fields.phone.value = p.phone || ''; if (fields.company) fields.company.value = p.company || ''; if (fields.role) fields.role.value = p.role || ''; if (fields.referralSource) fields.referralSource.value = p.referralSource || ''; if (fields.biggestChallenge) fields.biggestChallenge.value = o.biggestChallenge || ''; if (fields.desiredOutcome) fields.desiredOutcome.value = o.desiredOutcome || ''; if (fields.previousAttempts) fields.previousAttempts.value = o.previousAttempts || ''; if (fields.notes) fields.notes.value = o.notes || ''; if (policyInput) policyInput.checked = Boolean(bookingState.finalDetails.policyAccepted); setRadioValue('consultant-before', o.consultantExperience); setRadioValue('ai-use', o.aiExperience); modal.querySelectorAll('input[name="booking-focus"]').forEach((input) => { input.checked = input.value === bookingState.bookingReason; input.closest('.booking-choice')?.classList.toggle('is-selected', input.checked); }); reviewInputs.forEach((input) => { input.checked = (o.reviewItems || []).includes(input.value); input.closest('.booking-final-card')?.classList.toggle('is-selected', input.checked); }); updateCounters(); updatePriorityUI(); renderUploadList(); updateSummary(); renderReviewSection(); updateButtons(); }
  function setRadioValue(name, value) { modal.querySelectorAll('input[name="' + name + '"]').forEach((input) => { input.checked = input.value === value; }); }
  function getFocusable() { return Array.from(modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')); }
  function focusFirstInvalid(step) {
    const selector = step === 1 ? '[data-booking-panel="1"] .booking-choice-grid.is-invalid input' : step === 2 ? '[data-booking-panel="2"] .booking-field.is-invalid input, [data-booking-panel="2"] .booking-field.is-invalid select' : '.booking-policy.is-invalid input';
    modal.querySelector(selector)?.focus({ preventScroll: false });
  }
  function attemptStepChange(targetStep, options = {}) { if (navigationLocked) return; navigationLocked = true; window.setTimeout(() => { navigationLocked = false; }, 220); syncPersonalInfo(); syncOptionalDetails(); if (targetStep >= 2 && !isStep1Valid(true)) { updateButtons(); focusFirstInvalid(1); return; } if (targetStep >= 3 && !isStep2Valid(true)) { setBookingStep(2); updateButtons(); focusFirstInvalid(2); return; } setBookingStep(targetStep, options); }
  function updatePriorityUI() { const selected = bookingState.optionalDetails.priorities || []; if (priorityCount) priorityCount.textContent = selected.length + ' of 3 selected'; priorityCards.forEach((card) => { const isSelected = selected.includes(card.dataset.priority); card.classList.toggle('is-selected', isSelected); card.disabled = selected.length >= 3 && !isSelected; card.classList.toggle('is-disabled', card.disabled); }); }
  function togglePriority(value) { const selected = bookingState.optionalDetails.priorities || []; if (selected.includes(value)) bookingState.optionalDetails.priorities = selected.filter((item) => item !== value); else if (selected.length < 3) bookingState.optionalDetails.priorities = selected.concat(value); saveBookingState(); updatePriorityUI(); updateSummary(); renderReviewSection(); }
  function setUploadError(message) { if (!uploadError) return; uploadError.textContent = message || ''; uploadError.hidden = !message; }
  function formatFileSize(size) { if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1) + ' MB'; return Math.max(1, Math.round(size / 1024)) + ' KB'; }
  function addFinalFiles(files) { setUploadError(''); Array.from(files || []).forEach((file) => { const ext = file.name.split('.').pop().toLowerCase(); const duplicate = activeFinalFiles.some((item) => item.name === file.name && item.size === file.size); if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) { setUploadError('Please choose PDF, PPT, DOC, PNG or JPG files only.'); return; } if (file.size > MAX_FILE_SIZE) { setUploadError('Each file must be 20MB or smaller.'); return; } if (!duplicate) activeFinalFiles.push(file); }); syncOptionalDetails(); }
  function renderUploadList() { if (!uploadList) return; const saved = bookingState.optionalDetails.selectedFileMetadata || []; uploadList.innerHTML = ''; if (!activeFinalFiles.length && saved.length) { const row = document.createElement('li'); row.className = 'booking-upload__stale'; row.textContent = 'Previously selected files need to be chosen again after refresh.'; uploadList.appendChild(row); return; } activeFinalFiles.forEach((file, index) => { const row = document.createElement('li'); row.innerHTML = '<span>' + escapeHtml(file.name) + '<small>' + formatFileSize(file.size) + '</small></span><button type="button" data-remove-file="' + index + '">Remove</button>'; uploadList.appendChild(row); }); }
  function updateCounters() { countedFields.forEach((field) => { const counter = modal.querySelector('[data-count-for="' + field.id + '"]'); if (counter) counter.textContent = String(field.value.length); }); }
  function updateSummary() { const a = bookingState.appointment; setSummary('sessionType', a.sessionType || 'Select a session'); setSummary('date', a.date ? formatDateDisplay(a.date) : 'Select a date'); setSummary('time', a.startTime ? formatTimeRange(a.startTime, a.endTime, a.timezone, a.date) : 'Select a time'); setSummary('duration', (a.durationMinutes || 60) + ' minutes'); renderExtraSummaryRows(); }
  function setSummary(key, value) { const node = modal.querySelector('[data-booking-summary="' + key + '"]'); if (node) node.textContent = value; }
  function renderExtraSummaryRows() {
    const list = modal.querySelector('.booking-summary__details');
    if (!list) return;
    const rows = [['goal', 'Primary Goal', bookingState.bookingReason], ['name', 'Name', bookingState.personalInfo.fullName], ['context', 'Optional Context', optionalSummary()]];
    rows.forEach(([key, label, value]) => {
      let row = list.querySelector('[data-summary-extra="' + key + '"]');
      if (!row) {
        row = document.createElement('li');
        row.dataset.summaryExtra = key;
        row.className = 'booking-summary__extra is-visible';
        row.innerHTML = '<span class="booking-summary__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span><span><small></small><strong></strong></span>';
        list.appendChild(row);
      }
      const isVisible = Boolean(value);
      row.hidden = !isVisible;
      if (!isVisible) return;
      const small = row.querySelector('small');
      const strong = row.querySelector('strong');
      if (small) small.textContent = label;
      if (strong) strong.textContent = shorten(value, 48);
    });
  }
  function optionalSummary() { const o = bookingState.optionalDetails; const parts = []; if (o.biggestChallenge) parts.push('Context'); if (o.priorities?.length) parts.push(o.priorities.length + ' priorities'); if (o.reviewItems?.length) parts.push(o.reviewItems.length + ' materials'); if (o.selectedFileMetadata?.length) parts.push(o.selectedFileMetadata.length + ' files'); if (o.notes) parts.push('Notes'); return parts.join(', '); }
  function renderReviewSection() { renderDl('[data-booking-review-required]', requiredRows()); renderDl('[data-booking-review-optional]', optionalRows()); }
  function renderDl(selector, rows) { const list = modal.querySelector(selector); if (!list) return; const visible = rows.filter((row) => row[1]); list.innerHTML = visible.length ? visible.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join('') : '<div><dt>Optional preparation</dt><dd>Not provided</dd></div>'; }
  function requiredRows() { const a = bookingState.appointment; return [['Session type', a.sessionType], ['Date', a.date ? formatDateDisplay(a.date) : ''], ['Time', a.startTime && a.endTime ? formatTimeRange(a.startTime, a.endTime, a.timezone, a.date) : ''], ['Duration', a.durationMinutes ? a.durationMinutes + ' minutes' : ''], ['Full name', bookingState.personalInfo.fullName], ['Email', bookingState.personalInfo.email], ['Phone', bookingState.personalInfo.phone], ['Primary goal', bookingState.bookingReason]]; }
  function optionalRows() { const o = bookingState.optionalDetails; return [['Biggest challenge', o.biggestChallenge], ['Desired outcome', o.desiredOutcome], ['Consultant experience', o.consultantExperience], ['AI experience', o.aiExperience], ['Previous attempts', o.previousAttempts], ['Priorities', (o.priorities || []).join(', ')], ['Materials', (o.reviewItems || []).map(labelForReviewItem).join(', ')], ['Files', (o.selectedFileMetadata || []).map((file) => file.name).join(', ')], ['Notes', o.notes]]; }
  function labelForReviewItem(key) { return ({ website: 'Website', portfolio: 'Portfolio', pitchDeck: 'Pitch deck', socialMedia: 'Social media', pdf: 'PDF', other: 'Other' }[key]) || key; }
  function resetSuccessScreen() { modal.classList.remove('is-booking-success'); if (reviewContent) reviewContent.hidden = false; if (successContent) successContent.hidden = true; if (successMessage) { successMessage.hidden = true; successMessage.textContent = ''; } }
  function showSuccessScreen() { bookingState.confirmed = true; bookingState.confirmedAt = new Date().toISOString(); saveBookingState(); updateProgress(7); modal.classList.add('is-booking-success'); if (reviewContent) reviewContent.hidden = true; if (successContent) successContent.hidden = false; const firstName = (bookingState.personalInfo.fullName || '').trim().split(/\s+/)[0]; if (successTitle) successTitle.innerHTML = firstName ? 'You&rsquo;re all set, ' + escapeHtml(firstName) + '!' : 'You&rsquo;re all set!'; if (successSessionType) successSessionType.textContent = (bookingState.appointment.sessionType || '1:1 Vision Strategy Session').toUpperCase(); if (successPrepCopy) successPrepCopy.textContent = optionalSummary() ? 'We\'ll review the information you shared before your session.' : 'We\'ll use your booking goal to prepare for the conversation.'; if (confirmMessage) { confirmMessage.hidden = true; confirmMessage.textContent = ''; } requestAnimationFrame(() => successTitle?.focus({ preventScroll: true })); }
  function confirmBooking(event) { if (event) event.preventDefault(); syncPersonalInfo(); syncOptionalDetails(); bookingState.finalDetails.policyAccepted = Boolean(policyInput?.checked); saveBookingState(); if (confirmLocked || !isReviewValid(true)) { updateButtons(); focusFirstInvalid(6); return; } confirmLocked = true; showSuccessScreen(); updateButtons(); window.setTimeout(() => { confirmLocked = false; }, 500); }
  function pad2(value) { return String(value).padStart(2, '0'); }
  function calendarStamp(date, time) { const parts = String(date || '').split('-').map(Number); const clock = String(time || '').split(':').map(Number); if (parts.length !== 3 || clock.length < 2) return ''; return String(parts[0]) + pad2(parts[1]) + pad2(parts[2]) + 'T' + pad2(clock[0]) + pad2(clock[1]) + '00'; }
  function escapeIcs(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function downloadCalendarFile(event) { if (event) event.preventDefault(); if (!hasValidAppointment()) { if (successMessage) { successMessage.hidden = false; successMessage.textContent = 'Calendar file could not be created because the appointment is incomplete.'; } return; } const a = bookingState.appointment; const title = a.sessionType || 'E4LA Strategy Session'; const timezone = a.timezone || 'America/Los_Angeles'; const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//E4LA//Booking//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:' + Date.now() + '-e4la-booking','DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),'DTSTART;TZID=' + timezone + ':' + calendarStamp(a.date, a.startTime),'DTEND;TZID=' + timezone + ':' + calendarStamp(a.date, a.endTime),'SUMMARY:' + escapeIcs(title),'DESCRIPTION:' + escapeIcs('E4LA booking details completed. Meeting link will be provided when the backend is connected.'),'END:VEVENT','END:VCALENDAR'].join('\r\n'); const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'e4la-vision-strategy-session.ics'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function openBooking(event) { if (event) event.preventDefault(); syncAppointmentFromCalendar(); if (!hasValidAppointment()) { window.E4LABookingCalendar?.showMessage?.('Please select a date and time before booking.'); document.getElementById('coaching')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } lastFocused = document.activeElement; applyStateToUI(); setBookingStep(1, { force: true }); modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('booking-modal-open'); }
  function closeBooking(event) { if (event) event.preventDefault(); modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('booking-modal-open'); if (lastFocused?.focus) lastFocused.focus({ preventScroll: true }); }
  function openNotice(event) { if (event) event.preventDefault(); syncPersonalInfo(); syncOptionalDetails(); if (!isStep2Valid(true)) { focusFirstInvalid(2); return; } lastNoticeTrigger = event.currentTarget; notice?.classList.add('is-open'); notice?.setAttribute('aria-hidden', 'false'); document.body.classList.add('booking-notice-open'); requestAnimationFrame(() => noticeAnswer?.focus({ preventScroll: true })); }
  function closeNotice(event, returnFocus = true) { if (event) event.preventDefault(); notice?.classList.remove('is-open'); notice?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('booking-notice-open'); if (returnFocus && lastNoticeTrigger?.focus) lastNoticeTrigger.focus({ preventScroll: true }); }
  function getNoticeFocusable() { return Array.from(notice?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') || []); }
  function openAppointmentEditor(event) { if (event) event.preventDefault(); if (!appointmentEditor || !appointmentEditorControl) return; syncAppointmentFromCalendar(); if (!hasValidAppointment()) return; lastAppointmentEditTrigger = event?.currentTarget || document.activeElement; appointmentEditorControl.open(bookingState.appointment); appointmentEditor.classList.add('is-open'); appointmentEditor.setAttribute('aria-hidden', 'false'); document.body.classList.add('appointment-editor-open'); requestAnimationFrame(() => appointmentEditorControl.focusInitial?.()); }
  function closeAppointmentEditor(event, options = {}) { if (event) event.preventDefault(); appointmentEditor?.classList.remove('is-open'); appointmentEditor?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('appointment-editor-open'); if (options.returnFocus !== false && lastAppointmentEditTrigger?.focus) lastAppointmentEditTrigger.focus({ preventScroll: true }); }
  function saveAppointmentEditor(event) { if (event) event.preventDefault(); if (!appointmentEditorControl || appointmentSaveLocked || !appointmentEditorControl.isValid()) return; appointmentSaveLocked = true; if (appointmentSaveButton) appointmentSaveButton.disabled = true; const previous = clone(bookingState.appointment); try { bookingState.appointment = mergeState(defaultState.appointment, appointmentEditorControl.getDraft()); saveBookingState(); window.E4LABookingCalendar?.setAppointment?.(bookingState.appointment); updateSummary(); renderReviewSection(); closeAppointmentEditor(null, { returnFocus: true }); } catch (error) { bookingState.appointment = previous; saveBookingState(); updateSummary(); } finally { window.setTimeout(() => { appointmentSaveLocked = false; }, 240); } }
  function formatDateDisplay(iso) { const [year, month, day] = iso.split('-').map(Number); return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day)); }
  function formatTimeRange(start, end, timezone, isoDate) { return formatTime(start) + ' - ' + formatTime(end) + ' (' + getTimezoneName(timezone, isoDate) + ')'; }
  function formatTime(time) { const [hours, minutes] = time.split(':').map(Number); return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, hours, minutes)); }
  function getTimezoneName(timezone, isoDate) { const date = isoDate ? new Date(isoDate + 'T12:00:00') : new Date(); const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'America/Los_Angeles', timeZoneName: 'short' }).formatToParts(date); return parts.find((part) => part.type === 'timeZoneName')?.value || 'PT'; }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
  function shorten(value, max) { value = String(value || ''); return value.length > max ? value.slice(0, max - 1) + '?' : value; }
  Object.values(fields).forEach((field) => { field?.addEventListener('input', () => { syncPersonalInfo(); syncOptionalDetails(); }); field?.addEventListener('change', () => { syncPersonalInfo(); syncOptionalDetails(); }); });
  modal.querySelectorAll('input[name="booking-focus"]').forEach((choice) => { const card = choice.closest('.booking-choice'); card?.setAttribute('tabindex', '0'); card?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choice.checked = true; choice.dispatchEvent(new Event('change', { bubbles: true })); } }); choice.addEventListener('change', () => { bookingState.bookingReason = choice.checked ? choice.value : ''; modal.querySelectorAll('.booking-choice').forEach((item) => item.classList.remove('is-selected')); card?.classList.toggle('is-selected', choice.checked); saveBookingState(); updateSummary(); updateButtons(); }); });
  modal.querySelectorAll('input[name="consultant-before"], input[name="ai-use"]').forEach((input) => input.addEventListener('change', syncOptionalDetails));
  reviewInputs.forEach((input) => { const card = input.closest('.booking-final-card'); card?.setAttribute('tabindex', '0'); card?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); } }); input.addEventListener('change', () => { card?.classList.toggle('is-selected', input.checked); syncOptionalDetails(); }); });
  priorityCards.forEach((card) => card.addEventListener('click', () => togglePriority(card.dataset.priority)));
  if (uploadBrowse && uploadInput) uploadBrowse.addEventListener('click', () => uploadInput.click());
  uploadInput?.addEventListener('change', () => { addFinalFiles(uploadInput.files); uploadInput.value = ''; });
  uploadDrop?.addEventListener('dragover', (event) => { event.preventDefault(); uploadDrop.classList.add('is-dragging'); }); uploadDrop?.addEventListener('dragleave', () => uploadDrop.classList.remove('is-dragging')); uploadDrop?.addEventListener('drop', (event) => { event.preventDefault(); uploadDrop.classList.remove('is-dragging'); addFinalFiles(event.dataTransfer?.files); });
  uploadList?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-file]'); if (!button) return; activeFinalFiles.splice(Number(button.dataset.removeFile), 1); syncOptionalDetails(); });
  policyInput?.addEventListener('change', () => { bookingState.finalDetails.policyAccepted = Boolean(policyInput.checked); saveBookingState(); updateButtons(); }); openers.forEach((opener) => opener.addEventListener('click', openBooking)); closers.forEach((closer) => closer.addEventListener('click', closeBooking)); stepButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); attemptStepChange(Number(button.dataset.bookingStep) || 1); })); skipButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); syncOptionalDetails(); setBookingStep(Number(button.dataset.bookingSkip) || 6, { force: true }); }));
  modal.querySelector('[data-open-optional-notice]')?.addEventListener('click', openNotice); noticeCloseButtons.forEach((button) => button.addEventListener('click', (event) => closeNotice(event, true))); noticeAnswer?.addEventListener('click', (event) => { closeNotice(event, false); setBookingStep(3, { force: true }); }); noticeSkip?.addEventListener('click', (event) => { closeNotice(event, false); setBookingStep(6, { force: true }); }); confirmButton?.addEventListener('click', confirmBooking); addCalendarButton?.addEventListener('click', downloadCalendarFile); returnHomeButton?.addEventListener('click', (event) => { event.preventDefault(); closeBooking(event); window.scrollTo({ top: 0, behavior: 'smooth' }); }); summaryEditButtons.forEach((button) => button.addEventListener('click', openAppointmentEditor)); appointmentCancelButtons.forEach((button) => button.addEventListener('click', (event) => closeAppointmentEditor(event, { returnFocus: true }))); appointmentSaveButton?.addEventListener('click', saveAppointmentEditor); modal.addEventListener('click', (event) => { if (event.target.classList.contains('booking-modal__backdrop')) closeBooking(event); });
  document.addEventListener('keydown', (event) => { if (notice?.classList.contains('is-open')) { if (event.key === 'Escape') { closeNotice(event, true); return; } if (event.key === 'Tab') { const focusable = getNoticeFocusable(); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (!first) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } return; } if (!modal.classList.contains('is-open')) return; if (event.key === 'Escape') closeBooking(event); });
  window.E4LABookingFlow = { refreshSummary() { bookingState = loadBookingState(); applyStateToUI(); }, getState: () => clone(bookingState) };
  applyStateToUI();
})();

/* FINAL SIX-STEP BOOKING FLOW */
(() => {
  const modal = document.getElementById('booking-modal');
  if (!modal) return;
  const FLOW_STORAGE_KEY = 'e4laBookingState';
  const APPOINTMENT_STORAGE_KEY = 'e4laBookingAppointment';
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const ALLOWED_FILE_EXTENSIONS = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
  const defaultState = {
    appointment: { sessionType: '', date: '', startTime: '', endTime: '', timezone: '', durationMinutes: 60 },
    personalInfo: { fullName: '', email: '', phone: '', company: '', role: '', referralSource: '' },
    bookingReason: '',
    optionalDetails: { biggestChallenge: '', desiredOutcome: '', consultantExperience: '', aiExperience: '', previousAttempts: '', priorities: [], reviewItems: [], notes: '', selectedFileMetadata: [] },
    finalDetails: { policyAccepted: false }
  };
  let bookingState = loadBookingState();
  let lastFocused = null;
  let lastNoticeTrigger = null;
  let navigationLocked = false;
  let confirmLocked = false;
  let activeFinalFiles = [];
  let lastAppointmentEditTrigger = null;
  let appointmentSaveLocked = false;
  const openers = document.querySelectorAll('[data-booking-open]');
  const closers = modal.querySelectorAll('[data-booking-close]');
  const stepButtons = modal.querySelectorAll('[data-booking-step]');
  const skipButtons = modal.querySelectorAll('[data-booking-skip]');
  const summaryEditButtons = modal.querySelectorAll('[data-booking-edit]');
  const appointmentEditor = document.getElementById('booking-appointment-editor');
  const appointmentCancelButtons = appointmentEditor?.querySelectorAll('[data-appointment-cancel]') || [];
  const appointmentSaveButton = appointmentEditor?.querySelector('[data-appointment-save]');
  const appointmentEditorControl = window.E4LABookingCalendar?.createAppointmentEditor?.(appointmentEditor) || null;
  const notice = document.getElementById('booking-optional-notice');
  const noticeCloseButtons = notice?.querySelectorAll('[data-optional-notice-close]') || [];
  const noticeAnswer = notice?.querySelector('[data-optional-notice-answer]');
  const noticeSkip = notice?.querySelector('[data-optional-notice-skip]');
  const confirmButton = modal.querySelector('[data-confirm-booking]');
  const confirmMessage = modal.querySelector('[data-confirm-message]');
  const reviewContent = modal.querySelector('[data-booking-review-content]');
  const successContent = modal.querySelector('[data-booking-success]');
  const successTitle = modal.querySelector('[data-success-title]');
  const successSessionType = modal.querySelector('[data-success-session-type]');
  const successPrepCopy = modal.querySelector('[data-success-prep-copy]');
  const successMessage = modal.querySelector('[data-success-message]');
  const returnHomeButton = modal.querySelector('[data-return-home]');
  const addCalendarButton = modal.querySelector('[data-add-calendar]');
  const policyInput = modal.querySelector('#booking-policy');
  const uploadInput = modal.querySelector('#booking-files');
  const uploadDrop = modal.querySelector('[data-upload-drop]');
  const uploadBrowse = modal.querySelector('[data-upload-browse]');
  const uploadList = modal.querySelector('[data-upload-list]');
  const uploadError = modal.querySelector('[data-upload-error]');
  const priorityCards = modal.querySelectorAll('[data-priority]');
  const priorityCount = modal.querySelector('[data-priority-count]');
  const reviewInputs = modal.querySelectorAll('input[name="booking-final-review"]');
  const countedFields = modal.querySelectorAll('textarea[maxlength]');
  const fields = {
    fullName: modal.querySelector('#booking-name'), email: modal.querySelector('#booking-email'), phone: modal.querySelector('#booking-phone'), company: modal.querySelector('#booking-company'), role: modal.querySelector('#booking-role'), referralSource: modal.querySelector('#booking-source'), biggestChallenge: modal.querySelector('#booking-challenge'), desiredOutcome: modal.querySelector('#booking-success'), previousAttempts: modal.querySelector('#booking-tried'), notes: modal.querySelector('#booking-final-notes')
  };
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function mergeState(base, patch) { const output = clone(base); Object.keys(patch || {}).forEach((key) => { if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) output[key] = mergeState(output[key], patch[key]); else if (patch[key] !== undefined) output[key] = patch[key]; }); return output; }
  function loadBookingState() { let saved = {}; let appointment = {}; try { saved = JSON.parse(sessionStorage.getItem(FLOW_STORAGE_KEY) || '{}'); } catch (error) {} try { appointment = JSON.parse(sessionStorage.getItem(APPOINTMENT_STORAGE_KEY) || '{}'); } catch (error) {} const merged = mergeState(defaultState, saved); merged.appointment = mergeState(defaultState.appointment, saved.appointment || appointment || {}); if (!saved.optionalDetails) { merged.optionalDetails.biggestChallenge = saved.details?.mainChallenge || ''; merged.optionalDetails.desiredOutcome = saved.details?.desiredOutcome || ''; merged.optionalDetails.consultantExperience = saved.details?.workedWithConsultant || ''; merged.optionalDetails.aiExperience = saved.details?.aiExperience || ''; merged.optionalDetails.previousAttempts = saved.details?.previousAttempts || ''; merged.optionalDetails.reviewItems = saved.finalDetails?.reviewItems || []; merged.optionalDetails.notes = saved.finalDetails?.notes || ''; merged.optionalDetails.selectedFileMetadata = saved.finalDetails?.selectedFiles || []; } merged.finalDetails.policyAccepted = Boolean(saved.finalDetails?.policyAccepted); return merged; }
  function saveBookingState() { sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(bookingState)); }
  function syncAppointmentFromCalendar() { const calendarState = window.E4LABookingCalendar?.getState?.(); let stored = {}; try { stored = JSON.parse(sessionStorage.getItem(APPOINTMENT_STORAGE_KEY) || '{}'); } catch (error) {} bookingState.appointment = mergeState(defaultState.appointment, calendarState || stored || {}); saveBookingState(); }
  function hasValidAppointment() { const a = bookingState.appointment; return Boolean(a.sessionType && a.date && a.startTime && a.endTime && a.timezone && Number(a.durationMinutes)); }
  function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
  function isValidPhone(value) { const digits = value.replace(/\D/g, ''); return digits.length >= 7 && digits.length <= 15; }
  function markInvalid(control, message, show) { if (!control) return false; const wrapper = control.closest('.booking-field, .booking-policy') || control.parentElement; let error = wrapper.querySelector('.booking-error'); if (!error) { error = document.createElement('small'); error.className = 'booking-error'; error.setAttribute('role', 'alert'); wrapper.appendChild(error); } wrapper.classList.toggle('is-invalid', show && Boolean(message)); control.classList.toggle('is-invalid', show && Boolean(message)); error.textContent = show && message ? message : ''; error.hidden = !(show && message); return !message; }
  function validateRequired(control, message, show) { return markInvalid(control, !String(control?.value || '').trim() ? message : '', show); }
  function isStep1Valid(show) { const ok = Boolean(bookingState.bookingReason); const group = modal.querySelector('[data-booking-panel="1"] .booking-choice-grid'); let error = group?.querySelector('.booking-error'); if (group && !error) { error = document.createElement('small'); error.className = 'booking-error'; error.setAttribute('role', 'alert'); group.appendChild(error); } if (group && error) { group.classList.toggle('is-invalid', show && !ok); error.textContent = show && !ok ? 'Please choose one primary focus.' : ''; error.hidden = !show || ok; } return ok; }
  function isStep2Valid(show) { const checks = []; checks.push(validateRequired(fields.fullName, 'Please enter your full name.', show)); const email = fields.email?.value || ''; checks.push(markInvalid(fields.email, !email.trim() ? 'Please enter your email.' : !isValidEmail(email) ? 'Please enter a valid email address.' : '', show)); const phone = fields.phone?.value || ''; checks.push(markInvalid(fields.phone, !phone.trim() ? 'Please enter your phone number.' : !isValidPhone(phone) ? 'Please enter a valid phone number.' : '', show)); return checks.every(Boolean); }
  function isReviewValid(show) { const accepted = Boolean(policyInput?.checked); markInvalid(policyInput, accepted ? '' : 'Please agree to the session policy before confirming.', show); return hasValidAppointment() && isStep1Valid(false) && isStep2Valid(false) && accepted; }
  function getAllowedStep(step) { if (!hasValidAppointment()) return 1; if (step >= 2 && !isStep1Valid(false)) return 1; if (step >= 3 && !isStep2Valid(false)) return 2; return step; }
  function setBookingStep(step, options = {}) { const requested = Math.max(1, Math.min(Number(step) || 1, 6)); const guarded = options.force ? requested : getAllowedStep(requested); modal.dataset.step = String(guarded); updateProgress(guarded); modal.querySelectorAll('[data-booking-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-booking-panel') !== String(guarded); }); if (guarded !== 6 || !bookingState.confirmed) resetSuccessScreen(); updateButtons(); renderReviewSection(); const activePanel = modal.querySelector('[data-booking-panel="' + guarded + '"]'); const focusTarget = activePanel?.querySelector('input, textarea, select, button:not([disabled])') || getFocusable()[0]; requestAnimationFrame(() => {
      modal.querySelector('.booking-modal__shell')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      focusTarget?.focus({ preventScroll: true });
    }); }
  function updateProgress(step) { modal.querySelectorAll('[data-progress-step]').forEach((item) => { const itemStep = Number(item.dataset.progressStep); const badge = item.querySelector('b'); item.classList.toggle('is-complete', itemStep < step); item.classList.toggle('is-active', itemStep === step); if (badge) badge.textContent = String(itemStep); }); }
  function updateButtons() { modal.querySelector('[data-booking-panel="1"] .booking-submit')?.toggleAttribute('disabled', !isStep1Valid(false)); modal.querySelector('[data-open-optional-notice]')?.toggleAttribute('disabled', !isStep2Valid(false)); if (confirmButton) confirmButton.disabled = !isReviewValid(false); updatePriorityUI(); }
  function syncPersonalInfo() { bookingState.personalInfo.fullName = fields.fullName?.value.trim() || ''; bookingState.personalInfo.email = fields.email?.value.trim() || ''; bookingState.personalInfo.phone = fields.phone?.value.trim() || ''; bookingState.personalInfo.company = fields.company?.value.trim() || ''; bookingState.personalInfo.role = fields.role?.value.trim() || ''; bookingState.personalInfo.referralSource = fields.referralSource?.value || ''; saveBookingState(); updateSummary(); updateButtons(); }
  function syncOptionalDetails() { const o = bookingState.optionalDetails; o.biggestChallenge = fields.biggestChallenge?.value.trim() || ''; o.desiredOutcome = fields.desiredOutcome?.value.trim() || ''; o.previousAttempts = fields.previousAttempts?.value.trim() || ''; o.consultantExperience = modal.querySelector('input[name="consultant-before"]:checked')?.value || ''; o.aiExperience = modal.querySelector('input[name="ai-use"]:checked')?.value || ''; o.reviewItems = Array.from(reviewInputs).filter((input) => input.checked).map((input) => input.value); o.notes = fields.notes?.value.trim() || ''; o.selectedFileMetadata = activeFinalFiles.map((file) => ({ name: file.name, size: file.size, type: file.type || '' })); saveBookingState(); updateCounters(); updateSummary(); renderReviewSection(); renderUploadList(); updateButtons(); }
  function applyStateToUI() { const p = bookingState.personalInfo, o = bookingState.optionalDetails; if (fields.fullName) fields.fullName.value = p.fullName || ''; if (fields.email) fields.email.value = p.email || ''; if (fields.phone) fields.phone.value = p.phone || ''; if (fields.company) fields.company.value = p.company || ''; if (fields.role) fields.role.value = p.role || ''; if (fields.referralSource) fields.referralSource.value = p.referralSource || ''; if (fields.biggestChallenge) fields.biggestChallenge.value = o.biggestChallenge || ''; if (fields.desiredOutcome) fields.desiredOutcome.value = o.desiredOutcome || ''; if (fields.previousAttempts) fields.previousAttempts.value = o.previousAttempts || ''; if (fields.notes) fields.notes.value = o.notes || ''; if (policyInput) policyInput.checked = Boolean(bookingState.finalDetails.policyAccepted); setRadioValue('consultant-before', o.consultantExperience); setRadioValue('ai-use', o.aiExperience); modal.querySelectorAll('input[name="booking-focus"]').forEach((input) => { input.checked = input.value === bookingState.bookingReason; input.closest('.booking-choice')?.classList.toggle('is-selected', input.checked); }); reviewInputs.forEach((input) => { input.checked = (o.reviewItems || []).includes(input.value); input.closest('.booking-final-card')?.classList.toggle('is-selected', input.checked); }); updateCounters(); updatePriorityUI(); renderUploadList(); updateSummary(); renderReviewSection(); updateButtons(); }
  function setRadioValue(name, value) { modal.querySelectorAll('input[name="' + name + '"]').forEach((input) => { input.checked = input.value === value; }); }
  function getFocusable() { return Array.from(modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')); }
  function focusFirstInvalid(step) { const selector = step === 1 ? '[data-booking-panel="1"] .booking-choice-grid.is-invalid input' : step === 2 ? '[data-booking-panel="2"] .booking-field.is-invalid input, [data-booking-panel="2"] .booking-field.is-invalid select' : '.booking-policy.is-invalid input'; modal.querySelector(selector)?.focus({ preventScroll: false }); }
  function attemptStepChange(targetStep, options = {}) { if (navigationLocked) return; navigationLocked = true; window.setTimeout(() => { navigationLocked = false; }, 220); syncPersonalInfo(); syncOptionalDetails(); if (targetStep >= 2 && !isStep1Valid(true)) { updateButtons(); focusFirstInvalid(1); return; } if (targetStep >= 3 && !isStep2Valid(true)) { setBookingStep(2); updateButtons(); focusFirstInvalid(2); return; } setBookingStep(targetStep, options); }
  function updatePriorityUI() { const selected = bookingState.optionalDetails.priorities || []; if (priorityCount) priorityCount.textContent = selected.length + ' of 3 selected'; priorityCards.forEach((card) => { const isSelected = selected.includes(card.dataset.priority); card.classList.toggle('is-selected', isSelected); card.disabled = selected.length >= 3 && !isSelected; card.classList.toggle('is-disabled', card.disabled); }); }
  function togglePriority(value) { const selected = bookingState.optionalDetails.priorities || []; if (selected.includes(value)) bookingState.optionalDetails.priorities = selected.filter((item) => item !== value); else if (selected.length < 3) bookingState.optionalDetails.priorities = selected.concat(value); saveBookingState(); updatePriorityUI(); updateSummary(); renderReviewSection(); }
  function setUploadError(message) { if (!uploadError) return; uploadError.textContent = message || ''; uploadError.hidden = !message; }
  function formatFileSize(size) { if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1) + ' MB'; return Math.max(1, Math.round(size / 1024)) + ' KB'; }
  function addFinalFiles(files) { setUploadError(''); Array.from(files || []).forEach((file) => { const ext = file.name.split('.').pop().toLowerCase(); const duplicate = activeFinalFiles.some((item) => item.name === file.name && item.size === file.size); if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) { setUploadError('Please choose PDF, PPT, DOC, PNG or JPG files only.'); return; } if (file.size > MAX_FILE_SIZE) { setUploadError('Each file must be 20MB or smaller.'); return; } if (!duplicate) activeFinalFiles.push(file); }); syncOptionalDetails(); }
  function renderUploadList() { if (!uploadList) return; const saved = bookingState.optionalDetails.selectedFileMetadata || []; uploadList.innerHTML = ''; if (!activeFinalFiles.length && saved.length) { const row = document.createElement('li'); row.className = 'booking-upload__stale'; row.textContent = 'Previously selected files need to be chosen again after refresh.'; uploadList.appendChild(row); return; } activeFinalFiles.forEach((file, index) => { const row = document.createElement('li'); row.innerHTML = '<span>' + escapeHtml(file.name) + '<small>' + formatFileSize(file.size) + '</small></span><button type="button" data-remove-file="' + index + '">Remove</button>'; uploadList.appendChild(row); }); }
  function updateCounters() { countedFields.forEach((field) => { const counter = modal.querySelector('[data-count-for="' + field.id + '"]'); if (counter) counter.textContent = String(field.value.length); }); }
  function updateSummary() { const a = bookingState.appointment; setSummary('sessionType', a.sessionType || 'Select a session'); setSummary('date', a.date ? formatDateDisplay(a.date) : 'Select a date'); setSummary('time', a.startTime ? formatTimeRange(a.startTime, a.endTime, a.timezone, a.date) : 'Select a time'); setSummary('duration', (a.durationMinutes || 60) + ' minutes'); renderExtraSummaryRows(); }
  function setSummary(key, value) { const node = modal.querySelector('[data-booking-summary="' + key + '"]'); if (node) node.textContent = value; }
  function renderExtraSummaryRows() {
    const list = modal.querySelector('.booking-summary__details');
    if (!list) return;
    const rows = [['goal', 'Primary Goal', bookingState.bookingReason], ['name', 'Name', bookingState.personalInfo.fullName], ['context', 'Optional Context', optionalSummary()]];
    rows.forEach(([key, label, value]) => {
      let row = list.querySelector('[data-summary-extra="' + key + '"]');
      if (!row) {
        row = document.createElement('li');
        row.dataset.summaryExtra = key;
        row.className = 'booking-summary__extra is-visible';
        row.innerHTML = '<span class="booking-summary__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span><span><small></small><strong></strong></span>';
        list.appendChild(row);
      }
      const isVisible = Boolean(value);
      row.hidden = !isVisible;
      if (!isVisible) return;
      const small = row.querySelector('small');
      const strong = row.querySelector('strong');
      if (small) small.textContent = label;
      if (strong) strong.textContent = shorten(value, 48);
    });
  }
  function optionalSummary() { const o = bookingState.optionalDetails; const parts = []; if (o.biggestChallenge) parts.push('Context'); if (o.priorities?.length) parts.push(o.priorities.length + ' priorities'); if (o.reviewItems?.length) parts.push(o.reviewItems.length + ' materials'); if (o.selectedFileMetadata?.length) parts.push(o.selectedFileMetadata.length + ' files'); if (o.notes) parts.push('Notes'); return parts.join(', '); }
  function renderReviewSection() { renderDl('[data-booking-review-required]', requiredRows()); renderDl('[data-booking-review-optional]', optionalRows()); }
  function renderDl(selector, rows) { const list = modal.querySelector(selector); if (!list) return; const visible = rows.filter((row) => row[1]); list.innerHTML = visible.length ? visible.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join('') : '<div><dt>Optional preparation</dt><dd>Not provided</dd></div>'; }
  function requiredRows() { const a = bookingState.appointment; return [['Session type', a.sessionType], ['Date', a.date ? formatDateDisplay(a.date) : ''], ['Time', a.startTime && a.endTime ? formatTimeRange(a.startTime, a.endTime, a.timezone, a.date) : ''], ['Duration', a.durationMinutes ? a.durationMinutes + ' minutes' : ''], ['Primary goal', bookingState.bookingReason], ['Full name', bookingState.personalInfo.fullName], ['Email', bookingState.personalInfo.email], ['Phone', bookingState.personalInfo.phone]]; }
  function optionalRows() { const o = bookingState.optionalDetails; return [['Biggest challenge', o.biggestChallenge], ['Desired outcome', o.desiredOutcome], ['Consultant experience', o.consultantExperience], ['AI experience', o.aiExperience], ['Previous attempts', o.previousAttempts], ['Priorities', (o.priorities || []).join(', ')], ['Materials', (o.reviewItems || []).map(labelForReviewItem).join(', ')], ['Files', (o.selectedFileMetadata || []).map((file) => file.name).join(', ')], ['Notes', o.notes]]; }
  function labelForReviewItem(key) { return ({ website: 'Website', portfolio: 'Portfolio', pitchDeck: 'Pitch deck', socialMedia: 'Social media', pdf: 'PDF', other: 'Other' }[key]) || key; }
  function resetSuccessScreen() { modal.classList.remove('is-booking-success'); if (reviewContent) reviewContent.hidden = false; if (successContent) successContent.hidden = true; if (successMessage) { successMessage.hidden = true; successMessage.textContent = ''; } }
  function showSuccessScreen() { bookingState.confirmed = true; bookingState.confirmedAt = new Date().toISOString(); saveBookingState(); updateProgress(7); modal.classList.add('is-booking-success'); if (reviewContent) reviewContent.hidden = true; if (successContent) successContent.hidden = false; const firstName = (bookingState.personalInfo.fullName || '').trim().split(/\s+/)[0]; if (successTitle) successTitle.innerHTML = firstName ? 'You&rsquo;re all set, ' + escapeHtml(firstName) + '!' : 'You&rsquo;re all set!'; if (successSessionType) successSessionType.textContent = (bookingState.appointment.sessionType || '1:1 Vision Strategy Session').toUpperCase(); if (successPrepCopy) successPrepCopy.textContent = optionalSummary() ? 'We\'ll review the information you shared before your session.' : 'We\'ll use your booking goal to prepare for the conversation.'; if (confirmMessage) { confirmMessage.hidden = true; confirmMessage.textContent = ''; } requestAnimationFrame(() => successTitle?.focus({ preventScroll: true })); }
  function confirmBooking(event) { if (event) event.preventDefault(); syncPersonalInfo(); syncOptionalDetails(); bookingState.finalDetails.policyAccepted = Boolean(policyInput?.checked); saveBookingState(); if (confirmLocked || !isReviewValid(true)) { updateButtons(); focusFirstInvalid(6); return; } confirmLocked = true; showSuccessScreen(); updateButtons(); window.setTimeout(() => { confirmLocked = false; }, 500); }
  function pad2(value) { return String(value).padStart(2, '0'); }
  function calendarStamp(date, time) { const parts = String(date || '').split('-').map(Number); const clock = String(time || '').split(':').map(Number); if (parts.length !== 3 || clock.length < 2) return ''; return String(parts[0]) + pad2(parts[1]) + pad2(parts[2]) + 'T' + pad2(clock[0]) + pad2(clock[1]) + '00'; }
  function escapeIcs(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function downloadCalendarFile(event) { if (event) event.preventDefault(); if (!hasValidAppointment()) { if (successMessage) { successMessage.hidden = false; successMessage.textContent = 'Calendar file could not be created because the appointment is incomplete.'; } return; } const a = bookingState.appointment; const title = a.sessionType || 'E4LA Strategy Session'; const timezone = a.timezone || 'America/Los_Angeles'; const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//E4LA//Booking//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:' + Date.now() + '-e4la-booking','DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),'DTSTART;TZID=' + timezone + ':' + calendarStamp(a.date, a.startTime),'DTEND;TZID=' + timezone + ':' + calendarStamp(a.date, a.endTime),'SUMMARY:' + escapeIcs(title),'DESCRIPTION:' + escapeIcs('E4LA booking details completed. Meeting link will be provided when the backend is connected.'),'END:VEVENT','END:VCALENDAR'].join('\r\n'); const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'e4la-vision-strategy-session.ics'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function openBooking(event) { if (event) event.preventDefault(); syncAppointmentFromCalendar(); if (!hasValidAppointment()) { window.E4LABookingCalendar?.showMessage?.('Please select a date and time before booking.'); document.getElementById('coaching')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } lastFocused = document.activeElement; applyStateToUI(); setBookingStep(1, { force: true }); modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('booking-modal-open'); }
  function closeBooking(event) { if (event) event.preventDefault(); modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('booking-modal-open'); if (lastFocused?.focus) lastFocused.focus({ preventScroll: true }); }
  function openNotice(event) { if (event) event.preventDefault(); syncPersonalInfo(); syncOptionalDetails(); if (!isStep2Valid(true)) { focusFirstInvalid(2); return; } lastNoticeTrigger = event.currentTarget; notice?.classList.add('is-open'); notice?.setAttribute('aria-hidden', 'false'); document.body.classList.add('booking-notice-open'); requestAnimationFrame(() => noticeAnswer?.focus({ preventScroll: true })); }
  function closeNotice(event, returnFocus = true) { if (event) event.preventDefault(); notice?.classList.remove('is-open'); notice?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('booking-notice-open'); if (returnFocus && lastNoticeTrigger?.focus) lastNoticeTrigger.focus({ preventScroll: true }); }
  function getNoticeFocusable() { return Array.from(notice?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') || []); }
  function openAppointmentEditor(event) { if (event) event.preventDefault(); if (!appointmentEditor || !appointmentEditorControl) return; syncAppointmentFromCalendar(); if (!hasValidAppointment()) return; lastAppointmentEditTrigger = event?.currentTarget || document.activeElement; appointmentEditorControl.open(bookingState.appointment); appointmentEditor.classList.add('is-open'); appointmentEditor.setAttribute('aria-hidden', 'false'); document.body.classList.add('appointment-editor-open'); requestAnimationFrame(() => appointmentEditorControl.focusInitial?.()); }
  function closeAppointmentEditor(event, options = {}) { if (event) event.preventDefault(); appointmentEditor?.classList.remove('is-open'); appointmentEditor?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('appointment-editor-open'); if (options.returnFocus !== false && lastAppointmentEditTrigger?.focus) lastAppointmentEditTrigger.focus({ preventScroll: true }); }
  function saveAppointmentEditor(event) { if (event) event.preventDefault(); if (!appointmentEditorControl || appointmentSaveLocked || !appointmentEditorControl.isValid()) return; appointmentSaveLocked = true; if (appointmentSaveButton) appointmentSaveButton.disabled = true; const previous = clone(bookingState.appointment); try { bookingState.appointment = mergeState(defaultState.appointment, appointmentEditorControl.getDraft()); saveBookingState(); window.E4LABookingCalendar?.setAppointment?.(bookingState.appointment); updateSummary(); renderReviewSection(); closeAppointmentEditor(null, { returnFocus: true }); } catch (error) { bookingState.appointment = previous; saveBookingState(); updateSummary(); } finally { window.setTimeout(() => { appointmentSaveLocked = false; }, 240); } }
  function formatDateDisplay(iso) { const [year, month, day] = iso.split('-').map(Number); return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day)); }
  function formatTimeRange(start, end, timezone, isoDate) { return formatTime(start) + ' - ' + formatTime(end) + ' (' + getTimezoneName(timezone, isoDate) + ')'; }
  function formatTime(time) { const [hours, minutes] = time.split(':').map(Number); return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, hours, minutes)); }
  function getTimezoneName(timezone, isoDate) { const date = isoDate ? new Date(isoDate + 'T12:00:00') : new Date(); const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'America/Los_Angeles', timeZoneName: 'short' }).formatToParts(date); return parts.find((part) => part.type === 'timeZoneName')?.value || 'PT'; }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
  function shorten(value, max) { value = String(value || ''); return value.length > max ? value.slice(0, max - 1) + '...' : value; }
  Object.values(fields).forEach((field) => { field?.addEventListener('input', () => { syncPersonalInfo(); syncOptionalDetails(); }); field?.addEventListener('change', () => { syncPersonalInfo(); syncOptionalDetails(); }); });
  modal.querySelectorAll('input[name="booking-focus"]').forEach((choice) => { const card = choice.closest('.booking-choice'); card?.setAttribute('tabindex', '0'); card?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choice.checked = true; choice.dispatchEvent(new Event('change', { bubbles: true })); } }); choice.addEventListener('change', () => { bookingState.bookingReason = choice.checked ? choice.value : ''; modal.querySelectorAll('.booking-choice').forEach((item) => item.classList.remove('is-selected')); card?.classList.toggle('is-selected', choice.checked); saveBookingState(); updateSummary(); updateButtons(); }); });
  modal.querySelectorAll('input[name="consultant-before"], input[name="ai-use"]').forEach((input) => input.addEventListener('change', syncOptionalDetails));
  reviewInputs.forEach((input) => { const card = input.closest('.booking-final-card'); card?.setAttribute('tabindex', '0'); card?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); } }); input.addEventListener('change', () => { card?.classList.toggle('is-selected', input.checked); syncOptionalDetails(); }); });
  priorityCards.forEach((card) => card.addEventListener('click', () => togglePriority(card.dataset.priority)));
  if (uploadBrowse && uploadInput) uploadBrowse.addEventListener('click', () => uploadInput.click());
  uploadInput?.addEventListener('change', () => { addFinalFiles(uploadInput.files); uploadInput.value = ''; });
  uploadDrop?.addEventListener('dragover', (event) => { event.preventDefault(); uploadDrop.classList.add('is-dragging'); }); uploadDrop?.addEventListener('dragleave', () => uploadDrop.classList.remove('is-dragging')); uploadDrop?.addEventListener('drop', (event) => { event.preventDefault(); uploadDrop.classList.remove('is-dragging'); addFinalFiles(event.dataTransfer?.files); });
  uploadList?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-file]'); if (!button) return; activeFinalFiles.splice(Number(button.dataset.removeFile), 1); syncOptionalDetails(); });
  policyInput?.addEventListener('change', () => { bookingState.finalDetails.policyAccepted = Boolean(policyInput.checked); saveBookingState(); updateButtons(); });
  openers.forEach((opener) => opener.addEventListener('click', openBooking)); closers.forEach((closer) => closer.addEventListener('click', closeBooking)); stepButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); attemptStepChange(Number(button.dataset.bookingStep) || 1); })); skipButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); syncOptionalDetails(); setBookingStep(Number(button.dataset.bookingSkip) || 6, { force: true }); }));
  modal.querySelector('[data-open-optional-notice]')?.addEventListener('click', openNotice); noticeCloseButtons.forEach((button) => button.addEventListener('click', (event) => closeNotice(event, true))); noticeAnswer?.addEventListener('click', (event) => { closeNotice(event, false); setBookingStep(3, { force: true }); }); noticeSkip?.addEventListener('click', (event) => { closeNotice(event, false); setBookingStep(6, { force: true }); }); confirmButton?.addEventListener('click', confirmBooking); addCalendarButton?.addEventListener('click', downloadCalendarFile); returnHomeButton?.addEventListener('click', (event) => { event.preventDefault(); closeBooking(event); window.scrollTo({ top: 0, behavior: 'smooth' }); }); summaryEditButtons.forEach((button) => button.addEventListener('click', openAppointmentEditor)); appointmentCancelButtons.forEach((button) => button.addEventListener('click', (event) => closeAppointmentEditor(event, { returnFocus: true }))); appointmentSaveButton?.addEventListener('click', saveAppointmentEditor); modal.addEventListener('click', (event) => { if (event.target.classList.contains('booking-modal__backdrop')) closeBooking(event); });
  document.addEventListener('keydown', (event) => { if (notice?.classList.contains('is-open')) { if (event.key === 'Escape') { closeNotice(event, true); return; } if (event.key === 'Tab') { const focusable = getNoticeFocusable(); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (!first) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } return; } if (!modal.classList.contains('is-open')) return; if (event.key === 'Escape') closeBooking(event); });
  window.E4LABookingFlow = { refreshSummary() { bookingState = loadBookingState(); applyStateToUI(); }, getState: () => clone(bookingState) };
  applyStateToUI();
})();



