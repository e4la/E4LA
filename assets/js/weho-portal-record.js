// WeHo Grill client-facing engagement record.
// This module augments the existing portal block only when client-portal.js has
// positively identified the signed-in/admin-preview client as WeHo Grill and
// unhidden #portal-weho-program. It does not infer client identity from names,
// URLs, or billing data.

const mount = document.querySelector('#portal-weho-program');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function heading(text) {
  return el('p', 'ops-list__title ops-mt-18', text);
}

function list(items) {
  const ul = el('ul', 'e4la-roadmap__deliverables-list');
  items.forEach((item) => ul.append(el('li', '', item)));
  return ul;
}

function termList(items) {
  const dl = el('dl', 'billing-summary ops-mt-18');
  items.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.append(el('dt', '', label), el('dd', '', value));
    dl.append(row);
  });
  return dl;
}

function renderWeHoRecord() {
  if (!mount || mount.hidden) return;
  if (mount.dataset.fullWehoRecord === 'true') return;

  mount.dataset.fullWehoRecord = 'true';
  mount.replaceChildren();

  const titleRow = el('div', 'dashboard-card-title');
  titleRow.append(
    el('h3', '', 'WeHo Grill engagement record'),
    el('span', 'ops-status ops-status--complete', 'Completed')
  );

  mount.append(
    titleRow,
    el('p', 'ops-list__title', '90-Day Brand Visibility & Local Growth Program'),
    el('p', 'ops-list__meta', 'Started August 6, 2026 · Current paid period ended September 4, 2026 at 6:38 PM PT'),
    el('p', 'ops-hint ops-mt-12', 'Strategic positioning: Modern Persian Hospitality in Los Angeles')
  );

  mount.append(termList([
    ['Original program value', '$1,200 / month · $3,600 total'],
    ['Original payment structure', '$600 initial, then $600 biweekly'],
    ['Renewal status', 'Canceled at period end'],
    ['Future automatic charges', 'None scheduled after Sep 4, 2026 at 6:38 PM PT'],
  ]));

  mount.append(heading('Program scope'));
  mount.append(list([
    'Business and digital presence assessment',
    'Website, menu, ordering, and platform alignment',
    'Google Business Profile and local visibility',
    'Google Ads audit, conversion-quality review, and campaign correction',
    'Instagram / Meta content and advertising strategy',
    'Catering growth strategy, menu architecture, pricing, and visual assets',
    'ezCater optimization and catering platform implementation support',
    'Toast Catering & Events / private-event growth direction',
    'Food, catering, sandwich-box, and promotional content production',
    'Review strategy, creator collaboration direction, and customer-acquisition planning',
  ]));

  mount.append(heading('Collaboration model'));
  mount.append(list([
    'E4LA led strategic campaigns, promotional content direction, collaborations, revenue-driving traffic, and campaign optimization.',
    'Restaurant staff / Ava handled day-to-day Stories, reposts, tagged interactions, DMs, comments, and routine community engagement.',
    'Farshad retained approval over prices, quantities, ingredients, minimums, delivery policies, operational terms, and final publication decisions.',
    'Restaurant cooperation was required for platform access, current menu information, food photography, event details, and content-production scheduling.',
  ]));

  mount.append(heading('Key work completed / advanced'));
  mount.append(list([
    'Reviewed restaurant positioning and developed the working brand direction “Modern Persian Hospitality in Los Angeles.”',
    'Reviewed Google Business Profile, local-search visibility, menu consistency, Google Updates, and review strategy.',
    'Audited the prior Google Ads campaign and identified that most reported conversions were direction actions rather than verified orders or revenue; the existing campaign was stopped before further spend against misleading signals.',
    'Reviewed and corrected Instagram / Meta campaign direction, audience strategy, content direction, calls to action, and operating boundaries for independent boosting/posting.',
    'Rebuilt catering around packages, boxed lunches, sandwich/group options, trays, sides/mezze, desserts, beverages, and service items.',
    'Completed multiple catering-menu revision rounds, including package structures, prices, portions, product names, terms, and platform-ready descriptions.',
    'Produced catering menu designs and extensive food/catering visual assets including kabob trays, mixed grills, rice, salads, mezze, desserts, boxed meals, and sandwich boxes.',
    'Refined ezCater structure toward Packages → Boxes → Trays → Sides and supported replacement of the prior catering menu with the new menu on August 13, 2026.',
    'Developed catering operational terms including advance-notice rules, delivery minimum/fee logic, modification windows, and cancellation terms.',
    'Expanded the growth plan into private dining and events, including corporate lunches, client dinners, birthdays, engagements, family gatherings, and hosted events.',
    'Developed curated private-event menu concepts including Classic Persian Table, WeHo Signature Experience, and Premium Persian Table.',
    'Prepared / used AI-assisted promotional videos and additional unpublished video assets during the engagement.',
    'Worked toward cross-platform consistency across the website, Google, Toast, ezCater, DoorDash, Uber Eats, Instagram, and catering materials.',
    'Added WeHo Grill to the E4LA portfolio / case-study system as a broader local-growth and visibility engagement.',
  ]));

  mount.append(heading('Advertising audit reference'));
  mount.append(el('p', 'ops-list__meta', 'Reviewed campaign period: approximately 171,856 impressions, 7,900 interactions, 2,426 reported conversions, 2,368 direction actions, 35 phone-call lead conversions, $2,299.91 spend, and approximately $2,370 reported conversion value. The review concluded that reported conversion volume substantially overstated verified revenue-generating outcomes.'));

  mount.append(heading('Catering / events expansion'));
  mount.append(list([
    'Catering was repositioned as a distinct revenue channel rather than a simple extension of the dine-in menu.',
    'Private dining / events were developed as a second growth channel around the restaurant’s approximately 36 indoor seats and approximately 44 total seats including outdoor seating.',
    'Toast Catering & Events and SmartQuote were incorporated into the later-stage event-sales direction.',
  ]));

  mount.append(heading('Cancellation and closeout'));
  mount.append(
    el('p', 'ops-list__meta', 'The client submitted written notice requesting that service end after the already-paid period and that automatic billing stop. E4LA verified cancellation at period end in Stripe. No future automatic renewal or charge is scheduled after September 4, 2026 at 6:38 PM PT.'),
    el('p', 'ops-hint ops-mt-12', 'The final paid period was used to stabilize and complete work already underway rather than launch new initiatives requiring ongoing management. Billing/payment history remains server-authoritative and separate from this engagement summary.')
  );
}

if (mount) {
  const observer = new MutationObserver(() => {
    if (!mount.hidden) {
      renderWeHoRecord();
      observer.disconnect();
    }
  });
  observer.observe(mount, { attributes: true, attributeFilter: ['hidden'] });
  renderWeHoRecord();
}
