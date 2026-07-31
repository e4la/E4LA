/* ============================================================
   E4LA — OUR WORK / PORTFOLIO PAGE
   Plain IIFE, same style and same shared behaviours as about.js
   (scroll reveal, nav border shift, burger menu, newsletter stub).
   Page-specific: the hero accordion rail, the organization filter
   wall, and the metric counters.
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Scroll reveal (shared) ---------- */
  var reveal = [].slice.call(document.querySelectorAll('[data-r]'));
  if (reduce || !('IntersectionObserver' in window)) {
    reveal.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      });
    }, { threshold: .08, rootMargin: '0px 0px -30px 0px' });
    reveal.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Nav border shift on scroll (shared) ---------- */
  var nav = document.getElementById('js-nav');
  var ticking = false;
  if (nav) {
    window.addEventListener('scroll', function () {
      if (ticking) return;
      requestAnimationFrame(function () {
        nav.style.borderBottomColor = window.scrollY > 40 ? 'rgba(200,168,75,.18)' : 'rgba(255,255,255,.055)';
        ticking = false;
      });
      ticking = true;
    }, { passive: true });
  }

  /* ---------- Mobile menu (shared) ---------- */
  var burger = document.getElementById('js-nav-burger');
  var mobile = document.getElementById('js-nav-mobile');
  if (burger && mobile) {
    var closeMenu = function () {
      mobile.classList.remove('is-open');
      mobile.setAttribute('aria-hidden', 'true');
      burger.setAttribute('aria-expanded', 'false');
    };
    burger.addEventListener('click', function () {
      var open = !mobile.classList.contains('is-open');
      mobile.classList.toggle('is-open', open);
      mobile.setAttribute('aria-hidden', open ? 'false' : 'true');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobile.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  }

  /* ---------- Newsletter stub (shared, client-side only) ---------- */
  var form = document.getElementById('js-nl');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('nl-email');
      var submit = form.querySelector('.footer__submit');
      if (!input.value) return;
      submit.textContent = 'OK'; submit.disabled = true; input.value = '';
      setTimeout(function () { submit.textContent = '->'; submit.disabled = false; }, 2400);
    });
  }

  /* ---------- Hero accordion rail ----------
     One panel expanded at a time. Each panel is a real <a> to its
     section, so clicking/Entering jumps there and the whole rail
     works with no JS at all (CSS gives panel 1 the expanded state
     via .is-active in the markup). JS only moves which panel is
     active. The accordion runs at every width — below 900px the CSS
     turns it vertical rather than switching it off.

     Each input mode is handled separately: hover expands on
     fine-pointer devices, focus expands everywhere (so tab-through
     never leaves the focused panel collapsed), and on hover-less
     devices the first tap expands while a second follows the link. */
  var rail = document.getElementById('js-hero-rail');
  if (rail) {
    var panels = [].slice.call(rail.querySelectorAll('.hero-rail__panel'));
    var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    /* Only gates the auto-advance below — the accordion itself is not
       width-dependent any more. */
    var isNarrow = function () { return window.matchMedia('(max-width: 900px)').matches; };
    var active = Math.max(0, panels.findIndex(function (p) { return p.classList.contains('is-active'); }));
    var cycleId = null;

    var setActive = function (index) {
      if (index === active) return;
      active = index;
      panels.forEach(function (p, i) { p.classList.toggle('is-active', i === index); });
    };

    var stopCycle = function () {
      if (cycleId === null) return;
      clearInterval(cycleId);
      cycleId = null;
    };

    panels.forEach(function (panel, index) {
      if (canHover) {
        panel.addEventListener('mouseenter', function () { stopCycle(); setActive(index); });
      }
      panel.addEventListener('focus', function () { stopCycle(); setActive(index); });
      panel.addEventListener('touchstart', stopCycle, { passive: true });

      /* Touch has no hover to preview with, so a tap on a closed panel
         opens it instead of navigating — otherwise the page would jump to
         a section the reader never got to look at. The open panel's own
         "Jump to section" cue is the affordance for the second tap, and
         the link still works normally for keyboard and mouse. */
      panel.addEventListener('click', function (e) {
        if (canHover || panel.classList.contains('is-active')) return;
        e.preventDefault();
        stopCycle();
        setActive(index);
      });

      panel.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % panels.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + panels.length) % panels.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = panels.length - 1;
        if (next === null) return;
        e.preventDefault();
        stopCycle();
        panels[next].focus();
      });
    });

    /* Gentle auto-advance so the rail reads as interactive on first
       paint, matching the auto-cycling timelines on Home. Stops for good
       on the first real interaction, pauses with the tab, and never runs
       under reduced motion. Deliberately off on narrow screens: there the
       panels move vertically, so an unprompted switch would shift what is
       under the reader's thumb mid-scroll. The vertical bars are obviously
       tappable on their own, so nothing is lost. */
    if (!reduce) {
      var startCycle = function () {
        if (cycleId !== null || isNarrow()) return;
        cycleId = setInterval(function () {
          if (document.hidden) return;
          setActive((active + 1) % panels.length);
        }, 3400);
      };
      startCycle();
      rail.addEventListener('mouseenter', stopCycle);
      window.addEventListener('resize', function () { if (isNarrow()) stopCycle(); }, { passive: true });
    }
  }

  /* ---------- Organization filter wall ----------
     Cards are authored in the HTML (not fetched), so the full list
     is present for crawlers, AI answer engines, and no-JS visitors.
     Filtering only toggles [hidden] on cards whose pipe-delimited
     data-groups list contains the selected group. */
  var filters = [].slice.call(document.querySelectorAll('.filter'));
  var cards = [].slice.call(document.querySelectorAll('.organization-card'));
  var status = document.getElementById('results-status');
  var grid = document.getElementById('organization-grid');

  /* ---------- Logo marquee ----------
     The logos scroll as four short rows in alternating directions instead
     of sitting in seven static grid rows. Four short rows rather than one
     or two long ones is the whole point: a row of ~9 loops quickly, so
     every logo comes back around often.

     The real cards are MOVED out of the grid into the rows (not copied),
     so each logo still has its own link, label and description exactly
     once. Only the filler copies that make the loop seamless are clones,
     and those are hidden from assistive tech and taken out of the tab
     order. The grid element stays in the document as the no-JS and
     reduced-motion form and is only hidden once the rows are built. */
  var ROW_TARGET = 4;
  var marquee = null;

  var buildMarquee = function (visible) {
    if (!grid || reduce) return false;

    if (!marquee) {
      marquee = document.createElement('div');
      marquee.className = 'orgmarquee';
      grid.parentNode.insertBefore(marquee, grid);
    }
    while (marquee.firstChild) marquee.removeChild(marquee.firstChild);

    if (!visible.length) {
      // The grid holds the only .empty-message but is hidden by now, so the
      // marquee has to carry its own.
      var none = document.createElement('p');
      none.className = 'empty-message';
      none.textContent = 'No organizations in this category yet.';
      marquee.appendChild(none);
      marquee.hidden = false;
      return true;
    }
    marquee.hidden = false;

    // Keep rows from getting so short they read as a stutter rather than a
    // scroll; with few logos, use fewer rows instead.
    var rows = Math.max(1, Math.min(ROW_TARGET, Math.ceil(visible.length / 4)));
    var perRow = Math.ceil(visible.length / rows);
    var pending = [];

    for (var r = 0; r < rows; r++) {
      var slice = visible.slice(r * perRow, (r + 1) * perRow);
      if (!slice.length) break;

      var row = document.createElement('div');
      row.className = 'orgrow';
      var track = document.createElement('div');
      track.className = 'orgrow__track';
      row.appendChild(track);
      marquee.appendChild(row);

      slice.forEach(function (card) { track.appendChild(card); });
      if (r % 2 === 1) track.style.setProperty('--dir', 'reverse');
      pending.push({ row: row, track: track, slice: slice });
    }

    grid.hidden = true;
    /* Duplicating and timing both depend on the row's real width, which is
       not known until the logo images have decoded — measuring first gave
       each row a different tempo and left one row's loop a few px short.
       The logos are about to scroll into view anyway, so they are switched
       to eager loading and the rows are finished once they are in. */
    whenImagesReady(marquee, function () { pending.forEach(fillRow); });
    return true;
  };

  /* One copy of the row must be at least as wide as the container or the
     loop shows a gap, so repeat to an even count — the -50% keyframe then
     advances by exactly half the copies, which is indistinguishable from
     the start. Speed is a constant px/sec so all four rows run at the same
     tempo regardless of how wide their contents are. */
  var SCROLL_PX_PER_SEC = 55;

  var fillRow = function (entry) {
    var track = entry.track;
    var setWidth = track.scrollWidth;
    if (!setWidth) return;
    var copies = Math.max(2, 2 * Math.max(1, Math.ceil(entry.row.clientWidth / setWidth)));
    for (var c = 1; c < copies; c++) {
      entry.slice.forEach(function (card) {
        var clone = card.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        [].slice.call(clone.querySelectorAll('a')).forEach(function (a) { a.setAttribute('tabindex', '-1'); });
        track.appendChild(clone);
      });
    }
    var loopWidth = setWidth * (copies / 2);
    track.style.setProperty('--speed', Math.max(16, Math.round(loopWidth / SCROLL_PX_PER_SEC)) + 's');
  };

  var whenImagesReady = function (root, done) {
    var imgs = [].slice.call(root.querySelectorAll('img'));
    imgs.forEach(function (i) { i.loading = 'eager'; });
    var waiting = imgs.filter(function (i) { return !i.complete; });
    if (!waiting.length) { done(); return; }
    var left = waiting.length;
    waiting.forEach(function (i) {
      var tick = function () { if (--left === 0) done(); };
      i.addEventListener('load', tick, { once: true });
      i.addEventListener('error', tick, { once: true });
    });
  };

  var applyFilter = function (group) {
    var visible = [];
    cards.forEach(function (card) {
      var groups = (card.getAttribute('data-groups') || '').split('|');
      var match = group === 'All' || groups.indexOf(group) !== -1;
      card.hidden = !match;
      if (match) visible.push(card);
    });
    if (status) {
      status.textContent = visible.length + ' organization' + (visible.length === 1 ? '' : 's') + ' shown for ' + group + '.';
    }
    var built = buildMarquee(visible);
    if (!built && grid) {
      var empty = grid.querySelector('.empty-message');
      if (empty) empty.hidden = visible.length !== 0;
    }
  };

  filters.forEach(function (button, index) {
    button.addEventListener('click', function () {
      filters.forEach(function (f) {
        var on = f === button;
        f.classList.toggle('is-active', on);
        f.setAttribute('aria-pressed', String(on));
      });
      applyFilter(button.getAttribute('data-filter') || 'All');
    });

    button.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
      e.preventDefault();
      var next = index;
      if (e.key === 'ArrowRight') next = (index + 1) % filters.length;
      if (e.key === 'ArrowLeft') next = (index - 1 + filters.length) % filters.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = filters.length - 1;
      filters[next].focus();
    });
  });

  if (filters.length && cards.length) applyFilter('All');

  /* ---------- Paint Events photo frames ----------
     Scroll-linked, not time-based: the eight frames fan out from behind the
     Paint Events mark in step with the section entering the viewport, so the
     reader drives it and can hold it at any point.

     This lives here, in the page's plain script, rather than in motion.js.
     Two reasons. It no longer uses Motion at all — Motion's scroll() built
     without error but never delivered a callback on this page, so the
     progress is measured directly. And motion.js is a `type="module"`
     script, which the browser refuses to run over file:// (modules are
     fetched with CORS, and a file:// origin is null); this site does get
     opened straight from disk, so anything that has to work there cannot
     live in a module.

     All it does is write one number (0 -> 1) to --paint-open on
     .paint__visual; the geometry is in our-work.css. That keeps it
     reversible, keeps it correct scrolling either direction, and leaves the
     section looking finished if this never runs — the stylesheet's default
     for --paint-open is 1, not 0, so there is deliberately no pre-set to 0. */
  var paintVisual = document.querySelector('.paint__visual');
  if (paintVisual && !reduce) {
    var paintQueued = false;

    var paintUpdate = function () {
      paintQueued = false;
      var rect = paintVisual.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      /* 0 when the circle's top edge sits 90% down the viewport, 1 when its
         centre reaches 55% down — so the fan-out finishes while the circle is
         comfortably in view instead of resolving off the bottom of the
         screen. The denominator is (0.35 * vh + height / 2), always
         positive, so there is no divide-by-zero to guard. */
      var startTop = vh * 0.9;
      var endTop = vh * 0.55 - rect.height / 2;
      var progress = (startTop - rect.top) / (startTop - endTop);
      if (progress < 0) progress = 0;
      if (progress > 1) progress = 1;
      paintVisual.style.setProperty('--paint-open', progress.toFixed(4));
    };

    var onPaintScroll = function () {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(paintUpdate);
    };

    window.addEventListener('scroll', onPaintScroll, { passive: true });
    window.addEventListener('resize', onPaintScroll, { passive: true });
    paintUpdate();
  }

  /* ---------- Metric counters ---------- */
  var animateCounter = function (el) {
    var target = Number(el.getAttribute('data-count'));
    if (!isFinite(target)) return;
    var suffix = el.getAttribute('data-suffix') || '';
    var start = performance.now();
    var duration = 1100;
    var frame = function (now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-US') + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  var counters = [].slice.call(document.querySelectorAll('[data-count]'));
  if (!reduce && counters.length && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        co.unobserve(entry.target);
      });
    }, { threshold: .65 });
    counters.forEach(function (c) { co.observe(c); });
  }
}());
