(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = Array.prototype.slice.call(document.querySelectorAll("[data-r]"));

  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (element) { element.classList.add("in"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
    reveals.forEach(function (element) { observer.observe(element); });
  }

  var burger = document.getElementById("js-nav-burger");
  var mobile = document.getElementById("js-nav-mobile");
  var closeMenu = function () {
    if (!burger || !mobile) return;
    mobile.classList.remove("is-open");
    mobile.setAttribute("aria-hidden", "true");
    burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
  };

  if (burger && mobile) {
    burger.addEventListener("click", function () {
      var open = !mobile.classList.contains("is-open");
      mobile.classList.toggle("is-open", open);
      mobile.setAttribute("aria-hidden", open ? "false" : "true");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("nav-open", open);
    });
    mobile.querySelectorAll("a").forEach(function (link) { link.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeMenu(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 980) closeMenu(); }, { passive: true });
  }

}());
