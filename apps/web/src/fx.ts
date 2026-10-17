// Vanilla ports of React Bits (reactbits.dev, MIT + Commons Clause) effects:
// DecryptedText, CountUp, SpotlightCard. All no-ops under prefers-reduced-motion.
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLYPHS = "0123456789abcdef#$%&*+<>/=";

/** DecryptedText: scramble then reveal left-to-right (text nodes only, keeps markup). */
export function decrypt(el: HTMLElement, speed = 28) {
  if (reduce()) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: { n: Text; t: string }[] = [];
  while (walker.nextNode()) { const n = walker.currentNode as Text; if (n.data.trim()) nodes.push({ n, t: n.data }); }
  const total = nodes.reduce((a, x) => a + x.t.length, 0);
  el.setAttribute("aria-label", el.textContent ?? "");
  let i = 0;
  const tick = () => {
    let k = 0;
    for (const { n, t } of nodes) {
      n.data = Array.from(t).map((c) => (k++ < i || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
    }
    i += Math.max(1, Math.ceil(total / 40));
    if (i <= total) setTimeout(tick, speed); else nodes.forEach(({ n, t }) => (n.data = t));
  };
  tick();
}

/** CountUp: animates numbers inside [data-count] once visible. data-count="72", data-decimals, data-prefix, data-suffix. */
export function countUp(root: ParentNode = document) {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
  const fmt = (el: HTMLElement, v: number) => `${el.dataset.prefix ?? ""}${v.toFixed(Number(el.dataset.decimals ?? 0))}${el.dataset.suffix ?? ""}`;
  els.forEach((el) => (el.textContent = fmt(el, reduce() ? Number(el.dataset.count) : Number(el.dataset.from ?? 0))));
  if (reduce()) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const el = e.target as HTMLElement, to = Number(el.dataset.count), from = Number(el.dataset.from ?? 0), t0 = performance.now(), d = 1400;
    const step = (t: number) => { const p = Math.min(1, (t - t0) / d), ease = 1 - Math.pow(2, -10 * p); el.textContent = fmt(el, from + (to - from) * (p === 1 ? 1 : ease)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
}

/** SpotlightCard: radial highlight follows the pointer (CSS vars, rAF-throttled). */
export function spotlight(sel: string) {
  if (reduce() || !matchMedia("(hover: hover)").matches) return;
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    el.classList.add("spot"); let raf = 0;
    el.addEventListener("pointermove", (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const r = el.getBoundingClientRect(); el.style.setProperty("--mx", `${e.clientX - r.left}px`); el.style.setProperty("--my", `${e.clientY - r.top}px`); });
    });
  });
}
