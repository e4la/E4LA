const dashboardData = {
  clientName: "Sean Elyaszadeh",
  clientInitials: "SE",
  projectName: "Mortgage Bankers",
  statusMessage:
    "Great progress this month! Your website traffic is up 24% and leads are increasing. Let's keep building momentum.",
  progress: 82,
  nav: [
    { label: "Dashboard", icon: "layout-dashboard", active: true },
    { label: "Project Overview", icon: "folder" },
    { label: "Tasks & Progress", icon: "list-checks" },
    { label: "Deliverables", icon: "file-text" },
    { label: "Reports & Results", icon: "bar-chart-3" },
    { label: "SEO & GEO", icon: "globe-2" },
    { label: "Content Calendar", icon: "calendar-days" },
    { label: "Messages", icon: "messages-square", badge: 2 },
    { label: "Files & Assets", icon: "folder-open" },
    { label: "Invoices", icon: "circle-dollar-sign" },
    { label: "Meetings", icon: "video" },
    { label: "Settings", icon: "settings" }
  ],
  kpis: [
    {
      type: "progress",
      label: "Overall Progress",
      status: "On track",
      description: "Project is progressing as planned.",
      cta: "View Details"
    },
    {
      label: "Current Phase",
      icon: "sparkles",
      title: "Content Optimization",
      description: "Creating and optimizing content that ranks, engages and converts.",
      cta: "View Phase Details"
    },
    {
      label: "Project Health",
      icon: "activity",
      status: "Excellent",
      description: "All systems operational and performing well.",
      cta: "View Health Report",
      tone: "mint"
    },
    {
      label: "Next Milestone",
      icon: "calendar-days",
      title: "AI Optimization",
      description: "May 28, 2024",
      cta: "See Milestones"
    }
  ],
  roadmap: [
    { phase: "Discovery", status: "completed", date: "Apr 15" },
    { phase: "Audit & Research", status: "completed", date: "Apr 25" },
    { phase: "UX & Strategy", status: "completed", date: "May 5" },
    { phase: "Content Optimization", status: "current", date: "May 10 – May 28" },
    { phase: "AI Optimization", status: "upcoming", date: "May 29 – Jun 10" },
    { phase: "Growth & Scale", status: "upcoming", date: "Jun 11 – Jun 25" }
  ],
  metrics: [
    {
      label: "Website Sessions",
      value: "12,846",
      change: "24%",
      icon: "gem",
      color: "#7c58e8",
      points: [52, 42, 48, 39, 56, 46, 51, 64, 41, 54, 47, 50, 68, 55, 61, 50, 70, 58]
    },
    {
      label: "Leads Generated",
      value: "238",
      change: "18%",
      icon: "sparkles",
      color: "#506fbd",
      points: [34, 46, 31, 42, 28, 58, 36, 41, 64, 33, 44, 39, 51, 36, 77, 31, 60, 55]
    },
    {
      label: "Keyword Rankings",
      value: "156",
      change: "32%",
      icon: "blocks",
      color: "#27b995",
      points: [29, 20, 34, 27, 32, 60, 28, 43, 35, 49, 31, 41, 64, 59, 32, 54, 47, 63]
    },
    {
      label: "AI Visibility Score",
      value: "78",
      unit: "/100",
      change: "15%",
      icon: "badge",
      color: "#df9346",
      points: [38, 47, 36, 51, 31, 42, 69, 32, 54, 45, 61, 48, 70, 36, 74, 39, 68, 58]
    },
    {
      label: "Page Speed Score",
      value: "92",
      unit: "/100",
      change: "8%",
      icon: "gauge",
      color: "#935de5",
      points: [37, 45, 31, 39, 48, 52, 73, 36, 54, 42, 49, 46, 62, 55, 76, 58, 68, 59]
    }
  ],
  deliverables: [
    { title: "Website Redesign v3", date: "May 7, 2024", status: "Completed", style: "photo" },
    { title: "SEO Audit Report", date: "May 6, 2024", status: "Completed", style: "wire" },
    { title: "Blog Post: Mortgage Tips", date: "May 5, 2024", status: "Published", style: "article" },
    { title: "UX Audit & Wireframes", date: "Apr 28, 2024", status: "Completed", style: "wire" },
    { title: "Competitor Analysis", date: "Apr 26, 2024", status: "Completed", style: "report" }
  ],
  tasks: [
    { title: "Optimize blog content for target keywords", date: "May 18" },
    { title: "Create 2 new service pages", date: "May 20" },
    { title: "Technical SEO improvements", date: "May 24" },
    { title: "AI visibility optimization", date: "May 28" }
  ]
};

const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;

function renderNav() {
  const nav = document.querySelector("#portal-nav");
  nav.innerHTML = dashboardData.nav
    .map(
      (item) => `
        <a class="nav__item ${item.active ? "is-active" : ""}" href="#" ${item.active ? 'aria-current="page"' : ""}>
          ${icon(item.icon)}
          <span>${item.label}</span>
          ${item.badge ? `<span class="badge" aria-label="${item.badge} unread messages">${item.badge}</span>` : ""}
        </a>
      `
    )
    .join("");
}

function renderIdentity() {
  document.querySelector("#client-name").textContent = dashboardData.clientName;
  document.querySelector("#user-name").textContent = dashboardData.clientName;
  document.querySelector("#avatar-initials").textContent = dashboardData.clientInitials;
  document.querySelector("#client-summary").textContent = `Here's what's happening with ${dashboardData.projectName}.`;
  document.querySelector("#status-message").textContent = dashboardData.statusMessage;
}

function renderKpis() {
  const grid = document.querySelector("#kpi-grid");
  grid.innerHTML = dashboardData.kpis
    .map((card, index) => {
      if (card.type === "progress") {
        return `
          <article class="card kpi-card" style="animation-delay:${index * 70}ms">
            <p class="kpi-card__label">${card.label}</p>
            <div class="kpi-card__body">
              <div class="progress-ring" role="img" aria-label="${dashboardData.progress}% overall progress">
                <span class="progress-ring__value" data-count="${dashboardData.progress}">0%</span>
              </div>
              <div class="kpi-card__content">
                <span class="status-dot">${card.status}</span>
                <p>${card.description}</p>
                <a class="text-link kpi-card__link" href="#"><span>${card.cta}</span>${icon("arrow-right")}</a>
              </div>
            </div>
          </article>
        `;
      }

      return `
        <article class="card kpi-card" style="animation-delay:${index * 70}ms">
          <p class="kpi-card__label">${card.label}</p>
          <div class="kpi-card__body">
            <div class="kpi-card__icon" ${card.tone === "mint" ? 'style="color:#199e86;background:#def7ee"' : ""}>
              ${icon(card.icon)}
            </div>
            <div class="kpi-card__content">
              ${card.status ? `<span class="status-dot">${card.status}</span>` : `<h3>${card.title}</h3>`}
              <p>${card.description}</p>
              <a class="text-link kpi-card__link" href="#"><span>${card.cta}</span>${icon("arrow-right")}</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRoadmap() {
  const roadmap = document.querySelector("#roadmap");
  roadmap.innerHTML = dashboardData.roadmap
    .map((step, index) => {
      const completed = step.status === "completed";
      const current = step.status === "current";
      const label = completed ? "Completed" : current ? "In Progress" : "Upcoming";

      return `
        <article class="roadmap-step is-${step.status}" style="animation-delay:${index * 80}ms">
          <div class="roadmap-step__marker">${completed ? icon("check") : index + 1}</div>
          <h3>${step.phase}</h3>
          <p>${label}</p>
          <time>${step.date}</time>
        </article>
      `;
    })
    .join("");
}

function chartPath(points, width = 164, height = 43) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const spread = max - min || 1;
  const step = width / (points.length - 1);

  return points
    .map((point, index) => {
      const x = Number((index * step).toFixed(2));
      const y = Number((height - ((point - min) / spread) * (height - 8) - 4).toFixed(2));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function renderMetrics() {
  const metrics = document.querySelector("#metrics");
  metrics.innerHTML = dashboardData.metrics
    .map(
      (metric) => `
        <article class="metric" style="--metric-color:${metric.color}">
          <div class="metric__icon">${icon(metric.icon)}</div>
          <div>
            <p class="metric__label">${metric.label}</p>
            <span class="metric__value" data-count="${metric.value.replace(/,/g, "")}">
              0<span class="metric__unit">${metric.unit || ""}</span>
            </span>
            <span class="metric__change">↑ ${metric.change}</span>
          </div>
          <svg class="metric__chart" viewBox="0 0 164 43" role="img" aria-label="${metric.label} trend">
            <path d="${chartPath(metric.points)}"></path>
          </svg>
        </article>
      `
    )
    .join("");
}

function renderDeliverables() {
  const deliverables = document.querySelector("#deliverables");
  deliverables.innerHTML = dashboardData.deliverables
    .map(
      (item, index) => `
        <article class="deliverable" style="animation-delay:${index * 65}ms">
          <div class="deliverable__thumb" data-style="${item.style}" aria-hidden="true"></div>
          <h3>${item.title}</h3>
          <time>${item.date}</time>
          <span class="status-pill ${item.status === "Published" ? "status-pill--purple" : ""}">
            ${icon(item.status === "Published" ? "circle-check" : "check-circle-2")}
            ${item.status}
          </span>
        </article>
      `
    )
    .join("");
}

function renderTasks() {
  const tasks = document.querySelector("#tasks");
  tasks.innerHTML = dashboardData.tasks
    .map(
      (task) => `
        <li class="task">
          <span class="task__check">${icon("check")}</span>
          <span>${task.title}</span>
          <time>${task.date}</time>
        </li>
      `
    )
    .join("");
}

function animateNumbers() {
  const counters = document.querySelectorAll("[data-count]");
  counters.forEach((counter) => {
    const target = Number(counter.dataset.count);
    const isPercent = counter.classList.contains("progress-ring__value");
    const unit = counter.querySelector(".metric__unit")?.outerHTML || "";
    const duration = 1100;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);

      if (isPercent) {
        counter.textContent = `${current}%`;
      } else {
        counter.innerHTML = `${current.toLocaleString()}${unit}`;
      }

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

function animateProgressRing() {
  const ring = document.querySelector(".progress-ring");
  if (!ring) return;

  let start;
  const duration = 1100;

  function step(timestamp) {
    start ||= timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    ring.style.setProperty("--progress", (dashboardData.progress * eased).toFixed(2));
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function setupMobileNav() {
  const toggle = document.querySelector("#menu-toggle");
  const sidebar = document.querySelector("#sidebar");

  toggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    toggle.setAttribute("aria-expanded", String(open));
  });

  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a") && window.matchMedia("(max-width: 1024px)").matches) {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
    }
  });
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "aria-hidden": "true"
      }
    });
  }
}

function init() {
  renderNav();
  renderIdentity();
  renderKpis();
  renderRoadmap();
  renderMetrics();
  renderDeliverables();
  renderTasks();
  setupMobileNav();
  refreshIcons();
  animateNumbers();
  animateProgressRing();
}

document.addEventListener("DOMContentLoaded", init);
