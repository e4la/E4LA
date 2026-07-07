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
    setTimeout(function(){sub.textContent='â†’';sub.disabled=false},3000);
  });
}

}());

(() => {
  const grid = document.querySelector('.services-grid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.svc-card'));
  const setActive = (card) => {
    cards.forEach((item) => {
      const active = item === card;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-expanded', String(active));
    });
  };
  const clearActive = () => {
    cards.forEach((item) => {
      item.classList.remove('is-active');
      item.setAttribute('aria-expanded', 'false');
    });
  };
  cards.forEach((card) => {
    card.addEventListener('mouseenter', () => {
      if (window.matchMedia('(hover:hover)').matches) setActive(card);
    });
    card.addEventListener('focusin', () => setActive(card));
    card.addEventListener('click', (event) => {
      if (event.target.closest('.svc-card__arr')) return;
      if (card.classList.contains('is-active')) clearActive();
      else setActive(card);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (card.classList.contains('is-active')) clearActive();
      else setActive(card);
    });
  });
  grid.addEventListener('mouseleave', () => {
    if (window.matchMedia('(hover:hover)').matches) clearActive();
  });
})();
