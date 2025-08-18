(function(){
  const pill = document.getElementById('pill');
  const params = new URLSearchParams(location.search);
  const size = params.get('size');
  const align = params.get('align');
  const bottom = params.get('bottom');
  const marquee = (params.get('marquee')||'auto'); // auto | always | off

  if (size) document.documentElement.style.setProperty('--size', /px$/.test(size)?size:(size+"px"));
  if (align) document.documentElement.style.setProperty('--align', align);
  if (bottom) document.documentElement.style.setProperty('--bottom', bottom);

  function show(txt){
    pill.classList.remove('show');
    // replace content with span for marquee measurement
    pill.innerHTML = `<span>${escapeHTML(txt)}</span>`;
    requestAnimationFrame(()=>{
      pill.classList.add('show');
      applyMarquee();
    });
  }

  function applyMarquee(){
    const span = pill.querySelector('span');
    if (!span) return;
    const need = marquee === 'always' || (marquee === 'auto' && span.scrollWidth > pill.clientWidth);
    pill.classList.toggle('marquee', !!need);
  }

  function escapeHTML(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function connect(){
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.addEventListener('open', ()=> show('…'));
    ws.addEventListener('message', ev => {
      try{
        const j = JSON.parse(ev.data);
        if (j.type === 'track') show(j.title);
      }catch{}
    });
    ws.addEventListener('close', ()=> setTimeout(connect, 1000));
  }

  window.addEventListener('resize', applyMarquee);
  connect();
})();
