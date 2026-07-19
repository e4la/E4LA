(function(){
  'use strict';
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveal=[].slice.call(document.querySelectorAll('[data-r]'));
  if(reduce||!('IntersectionObserver' in window)){reveal.forEach(function(el){el.classList.add('in')});}
  else{
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('in');io.unobserve(entry.target);}});
    },{threshold:.08,rootMargin:'0px 0px -30px 0px'});
    reveal.forEach(function(el){io.observe(el);});
  }
  var nav=document.getElementById('js-nav');
  var ticking=false;
  window.addEventListener('scroll',function(){
    if(ticking)return;
    requestAnimationFrame(function(){
      nav.style.borderBottomColor=window.scrollY>40?'rgba(200,168,75,.18)':'rgba(255,255,255,.055)';
      ticking=false;
    });
    ticking=true;
  },{passive:true});
  var burger=document.getElementById('js-nav-burger');
  var mobile=document.getElementById('js-nav-mobile');
  if(burger&&mobile){
    burger.addEventListener('click',function(){
      var open=!mobile.classList.contains('is-open');
      mobile.classList.toggle('is-open',open);
      mobile.setAttribute('aria-hidden',open?'false':'true');
      burger.setAttribute('aria-expanded',open?'true':'false');
    });
    mobile.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){
        mobile.classList.remove('is-open');
        mobile.setAttribute('aria-hidden','true');
        burger.setAttribute('aria-expanded','false');
      });
    });
  }
  var form=document.getElementById('js-nl');
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var input=document.getElementById('nl-email');
      var submit=form.querySelector('.footer__submit');
      if(!input.value)return;
      submit.textContent='OK';submit.disabled=true;input.value='';
      setTimeout(function(){submit.textContent='->';submit.disabled=false;},2400);
    });
  }
}());


