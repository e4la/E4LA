/* E4LA public-site measurement layer. See MEASUREMENT.md (source of truth).
   - Loaded ONLY by the four public marketing pages; also self-guards by host + path allowlist
     so a stray include can never fire analytics on client proposal/contract/portal/admin pages.
   - Loads the single GTM container (no inline gtag, no second GA4 tag).
   - Exposes window.e4laTrack(event, params) for script.js. Never pass PII or free text. */
(function () {
  'use strict';

  var CFG = {
    gtmId: '',                       // GTM-XXXXXXX. Empty = dataLayer only, no network tag load.
    hosts: ['www.e4la.org', 'e4la.org'],
    pathAllowlist: ['/', '/index.html', '/services', '/services.html', '/our-work', '/our-work.html', '/about', '/about.html'],
    analyticsConsentDefault: 'granted', // flip to 'denied' + call e4laConsent.grant() once a CMP/banner exists
    debugHosts: []                   // optional extra hosts for staging verification
  };

  var host = location.hostname.toLowerCase();
  var path = location.pathname.replace(/\/+$/, '') || '/';
  var allowed = (CFG.hosts.indexOf(host) > -1 || CFG.debugHosts.indexOf(host) > -1) && CFG.pathAllowlist.indexOf(path) > -1;
  if (!allowed) { window.e4laTrack = function () {}; return; }

  var dl = window.dataLayer = window.dataLayer || [];
  function gtag() { dl.push(arguments); }

  // Consent Mode v2 defaults (no ad/remarketing storage is ever granted by this site).
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: CFG.analyticsConsentDefault
  });
  window.e4laConsent = {
    grant: function () { gtag('consent', 'update', { analytics_storage: 'granted' }); },
    revoke: function () { gtag('consent', 'update', { analytics_storage: 'denied' }); }
  };

  var pageType = { '/': 'home', '/index.html': 'home', '/services': 'services', '/services.html': 'services',
    '/our-work': 'portfolio', '/our-work.html': 'portfolio', '/about': 'about', '/about.html': 'about' }[path] || 'other';

  var BLOCK = /^(email|e-?mail|phone|name|full_?name|first_?name|last_?name|message|notes?|company|address|goal|challenge|outcome)$|_(email|phone)$/i;
  window.e4laTrack = function (eventName, params) {
    var payload = { event: eventName, page_type: pageType };
    if (params) for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k) || BLOCK.test(k)) continue;
      var v = params[k];
      if (typeof v === 'string') v = v.slice(0, 100);
      payload[k] = v;
    }
    dl.push(payload);
  };

  // Micro-conversions: email / phone clicks (delegated, one event per click).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="mailto:"], a[href^="tel:"]');
    if (!a) return;
    var isMail = a.getAttribute('href').toLowerCase().indexOf('mailto:') === 0;
    var zone = a.closest('footer') ? 'footer' : (a.closest('.booking-modal, #booking-modal') ? 'booking_modal' : 'content');
    window.e4laTrack(isMail ? 'click_email' : 'click_phone', { link_location: zone });
  }, true);

  if (CFG.gtmId && /^GTM-[A-Z0-9]+$/.test(CFG.gtmId)) {
    dl.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + CFG.gtmId;
    document.head.appendChild(s);
  }
})();
