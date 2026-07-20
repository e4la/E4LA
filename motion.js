// Motion for JavaScript (vanilla) — https://motion.dev
// Pinned version (not @latest) per Motion's own recommendation, so the CDN
// import can't change out from under this site without an explicit bump.
import { animate, inView, scroll } from "https://cdn.jsdelivr.net/npm/motion@12.42.2/+esm";

if (document.body.classList.contains("auth-page")) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) {
    const media = document.querySelector(".auth-media__video");
    const card = document.querySelector(".auth-card");
    if (media) {
      animate(media, { opacity: [0, 1], scale: [0.94, 1] }, { duration: 0.9, easing: "ease-out" });
      animate(media, { y: [0, -14, 0] }, { duration: 6, repeat: Infinity, easing: "ease-in-out" });
    }
    if (card) {
      animate(card, { opacity: [0, 1], y: [16, 0] }, { duration: 0.7, delay: 0.1, easing: "ease-out" });
    }
  }
}
