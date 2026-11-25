(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const config = window.APP_CONFIG || {};
  const state = { lessons: [], session: JSON.parse(localStorage.getItem('session') || 'null'), admin: false, token: null, quiz: [], qi: 0, score: 0, selected: -1, editing: null, tab: 'home', essays: [], openWeeks: new Set() };
  const url = (config.supabaseUrl || '').replace(/\/$/, ''), anon = config.supabaseAnonKey || '';
  const modal = $('#modal'), body = $('#modalBody');
  // ---------- المظهر ----------
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const getTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
  function applyTheme(mode) {
    try { localStorage.setItem('theme', mode); } catch {}
    const dark = mode === 'dark' || (mode === 'auto' && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#15100e' : '#693327';
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });
  function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }
  function esc(s = '') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function open(html, full = false) { body.innerHTML = html; modal.querySelector('.sheet').classList.toggle('full', !!full); modal.classList.remove('hidden'); }
  function hideModal() { modal.classList.add('hidden'); body.innerHTML = ''; modal.querySelector('.sheet').classList.remove('full'); }
  function close() { hideModal(); setNav(state.tab === 'quiz' ? 'quizTab' : 'homeTab'); if (state.tab === 'quiz') drawQuizTab(false); }
  function setNav(id) { document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.id === id)); }
  document.querySelector('.bottom-nav').addEventListener('click', e => { const n = e.target.closest('.nav-item'); if (!n) return; const ico = n.querySelector('.ico'); ico.classList.remove('pop'); void ico.offsetWidth; ico.classList.add('pop'); }, true);
  function tryClose() { if (state.inQuiz && !confirm('الخروج من الاختبار؟ لن تُحفظ إجابات الاختيار التي لم تنتهِ منها.')) return false; state.inQuiz = false; close(); return true; }
  modal.addEventListener('click', e => { if (e.target.matches('[data-close]')) tryClose(); });
  function headers(extra = {}) { return { apikey: anon, Authorization: `Bearer ${state.token || anon}`, ...extra }; }
  async function refreshSession() {
    const rt = state.session?.refresh_token; if (!rt) return false;
    try {
      const res = await fetch(url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      if (!res.ok) return false;
      const data = await res.json(); if (!data.access_token) return false;
      state.session = data; state.token = data.access_token; localStorage.setItem('session', JSON.stringify(data)); return true;
    } catch { return false; }
  }
  async function api(path, opts = {}, retried = false) {
    if (!url || !anon) throw new Error('أضف بيانات Supabase في ملف config.js أولًا.');
    let res;
    try { res = await fetch(url + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } }); }
    catch { throw new Error('تعذّر الاتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى.'); }
    const txt = await res.text(); let data;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if ((res.status === 401 || (res.status === 403 && /bad_jwt|expired|invalid jwt/i.test(txt))) && !retried && state.session?.refresh_token && !path.startsWith('/auth/v1/token') && await refreshSession()) return api(path, opts, true);
    if (!res.ok) throw new Error(data?.message || data?.msg || data?.error_description || `تعذّر الاتصال (${res.status})`);
    return data;
  }
  function setStatus(text, spinner = false) { $('#status').classList.remove('hidden'); $('#status').innerHTML = spinner ? `<span class="spinner"></span> ${esc(text)}` : esc(text); }
  // ---------- التحميل للاستخدام بدون إنترنت (يعمل داخل تطبيق أندرويد فقط) ----------
  const OFF = window.AndroidOffline || null;
  const offHas = (k, id) => { try { return !!OFF && OFF.has(k, String(id)); } catch { return false; } };
  const dlItems = x => [x.media_url && { k: 'audio', url: x.media_url }, x.pdf_url && { k: 'pdf', url: x.pdf_url }].filter(Boolean);
  const isSaved = x => { const it = dlItems(x); return !!OFF && it.length > 0 && it.every(i => offHas(i.k, x.id)); };
  const dlWait = {};
  window.onOfflineProgress = (k, id, p, st) => { const w = dlWait[k + ':' + id]; if (w) w(p, st); };
  const offDownload = (k, id, link, onP) => new Promise((ok, no) => {
    dlWait[k + ':' + id] = (p, st) => { if (st === 'progress') { if (onP) onP(p); } else { delete dlWait[k + ':' + id]; st === 'done' ? ok() : no(new Error('تعذّر التحميل. تأكد من الإنترنت وحاول مرة أخرى.')); } };
    OFF.download(k, String(id), link);
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-pdf]'); if (!a || !OFF) return;
    e.preventDefault(); const x = state.lessons.find(l => String(l.id) === a.dataset.pdf); if (x) openPdf(x);
  });
  async function openPdf(x) {
    open(`<h3>${esc(x.title)}</h3><p class="hint pdf-status"></p><div class="pdf-pages" id="pdfPages"></div>`);
    const st = $('.pdf-status'), box = $('#pdfPages');
    if (!offHas('pdf', x.id)) {
      st.innerHTML = '<span class="spinner"></span> جارٍ تحميل الملف...';
      try { await offDownload('pdf', x.id, x.pdf_url, p => { st.textContent = 'جارٍ التحميل ' + p + '٪'; }); render(); } catch (err) { st.textContent = err.message; return; }
    }
    st.textContent = '';
    const n = OFF.pdfPages(String(x.id)); if (!n) { st.textContent = 'تعذّر عرض الملف.'; return; }
    const w = Math.min(1200, Math.round(innerWidth * (devicePixelRatio || 1)));
    for (let i = 0; i < n && box.isConnected; i++) { const img = new Image(); img.className = 'pdf-page'; img.src = OFF.pdfPage(String(x.id), i, w); box.appendChild(img); await new Promise(r => setTimeout(r, 30)); }
  }
  // ---------- شريط عدم الاتصال ----------
  let netOff = false, netDismissed = false;
  function setNet(off) {
    if (off && netDismissed) { netOff = true; return; }
    if (!off) netDismissed = false;
    if (off === netOff && (off === false || !$('#netBar').classList.contains('hidden'))) return;
    netOff = off; const bar = $('#netBar');
    if (off) {
      bar.innerHTML = `<div class="nb-ico">!</div><div class="nb-txt"><b>لا يوجد اتصال بالإنترنت</b><small>${state.lessons.length ? 'تُعرض المحاضرات المحفوظة، والمحاضرات المحمّلة تعمل بدون إنترنت. نتائج الاختبارات لن تُسجَّل حتى يعود الاتصال.' : 'تحقق من الشبكة. المحاضرات تحتاج اتصالًا في المرة الأولى.'}</small></div><div class="nb-btns"><button id="netRetry">إعادة المحاولة</button><button id="netOk" class="solid">أعلم</button></div>`;
      bar.classList.remove('hidden'); $('#netRetry').onclick = () => { load(); loadNotices(); }; $('#netOk').onclick = () => { netDismissed = true; bar.classList.add('hidden'); };
    } else bar.classList.add('hidden');
  }
  window.addEventListener('offline', () => setNet(true));
  window.addEventListener('online', () => { setNet(false); toast('عاد الاتصال بالإنترنت.'); if (state.session) { load(); loadNotices(); } });
  if (navigator.onLine === false) setTimeout(() => setNet(true), 0);
  async function load() {
    if (!url || !anon) { setStatus('التطبيق جاهز. اربطه بمشروع Supabase لعرض المحاضرات المنشورة.'); return; }
    setStatus('جارٍ تحميل المحاضرات...', true);
    try {
      state.lessons = await api('/rest/v1/lectures?select=id,title,description,media_url,media_type,pdf_url,questions,week,created_at&published=eq.true&order=week.asc,created_at.asc');
      try { localStorage.setItem('lectures-cache', JSON.stringify(state.lessons)); } catch {}
      setNet(false); render();
    } catch (e) {
      let c = null; try { c = JSON.parse(localStorage.getItem('lectures-cache') || 'null'); } catch {}
      const off = /الاتصال|الإنترنت/.test(e.message);
      if (Array.isArray(c) && c.length) { state.lessons = c; render(); if (off) { netOff = false; setNet(true); } else toast(e.message); } else { setStatus(e.message); if (off) { netOff = false; setNet(true); } }
    }
  }
  const qCount = x => Array.isArray(x.questions) ? x.questions.length : 0;
  const qType = q => (q && q.type === 'essay' ? 'essay' : 'mcq');
  const qCounts = x => { const a = Array.isArray(x.questions) ? x.questions : []; const e = a.filter(q => qType(q) === 'essay').length; return { mcq: a.length - e, essay: e }; };
  function lessonCard(x) { return `<article class="lesson-card"><div class="card-top"><div class="card-icon">♫</div><div class="card-info"><h3>${esc(x.title)}</h3><p>${esc(x.description || 'محاضرة جديدة في طريق العلم والعمل.')}</p></div></div><div class="card-meta"><span>◷ ${x.created_at ? new Date(x.created_at).toLocaleDateString('ar-EG') : 'مضافة حديثًا'}</span>${x.pdf_url ? '<span>📄 ملف PDF</span>' : ''}${isSaved(x) ? '<span class="saved">⬇ محمّلة</span>' : ''}</div><div class="card-actions stack">${x.media_url || x.pdf_url ? `<button class="btn-listen" data-view="${esc(x.id)}"><span class="bl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/></svg></span><span class="bl-txt"><b>استمع للمحاضرة</b><small>${isSaved(x) ? 'محمّلة وتعمل بدون إنترنت' : 'اضغط لفتح المحاضرة'}</small></span><span class="bl-go">←</span></button>` : '<div class="no-lec">لا توجد محاضرة لهذا العنوان، الأسئلة فقط في تبويب «الاختبارات»</div>'}</div></article>`; }
  function byWeek(rows) { const m = new Map(); rows.forEach(x => { const w = Number(x.week) || 1; if (!m.has(w)) m.set(w, []); m.get(w).push(x); }); return [...m.entries()].sort((a, b) => a[0] - b[0]); }
  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const rows = state.lessons.filter(x => (x.title + ' ' + (x.description || '')).toLowerCase().includes(q));
    $('#lessonCount').textContent = `${state.lessons.length} محاضرة`;
    $('#status').classList.add('hidden');
    $('#lessonList').innerHTML = rows.length ? byWeek(rows).map(([w, items]) => `<div class="week-head"><div><b>الأسبوع ${w}</b><small>${items.length} محاضرة</small></div></div>` + items.map(lessonCard).join('')).join('') : '<div class="empty">لا توجد محاضرات مطابقة الآن.<br>تابعنا، فالمحتوى الجديد سيظهر تلقائيًا هنا.</div>';
    if (state.tab === 'quiz' && modal.classList.contains('hidden')) drawQuizTab(false);
  }
  $('#lessonList').addEventListener('click', e => {
    const view = e.target.closest('[data-view]')?.dataset.view;
    if (view) showLesson(state.lessons.find(x => String(x.id) === view));
  });
  $('#search').addEventListener('input', render);
  $('#refreshBtn').onclick = () => { loadNotices(); load(); loadEssays(); };
  // السحب لأسفل للتحديث: مؤشر عائم لا يشغل مساحة ولا يغيّر التخطيط، ولا يعمل أثناء فتح نافذة أو الكتابة
  (function () {
    const el = document.createElement('div'); el.id = 'ptr'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<span class="ptr-i">↓</span>'; document.body.appendChild(el);
    let y0 = 0, dy = 0, on = false, busy = false; const TH = 110;
    const allowed = t => !busy && state.session && modal.classList.contains('hidden') && (state.tab === 'home' || state.tab === 'quiz') && !(t && t.closest && t.closest('input,textarea,select,audio,[contenteditable]'));
    const reset = () => { el.classList.remove('pull', 'ready'); el.style.transform = ''; };
    addEventListener('touchstart', e => { on = e.touches.length === 1 && window.scrollY <= 0 && allowed(e.target); y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    addEventListener('touchmove', e => {
      if (!on) return; dy = e.touches[0].clientY - y0;
      if (dy < 12 || window.scrollY > 0) { reset(); return; }
      const p = Math.min(dy * 0.45, 70); el.classList.add('pull'); el.classList.toggle('ready', dy >= TH);
      el.style.transform = `translate(-50%, ${p - 44}px)`;
    }, { passive: true });
    addEventListener('touchend', async () => {
      if (!on) return; on = false; const go = dy >= TH; reset(); if (!go) return;
      busy = true; el.classList.add('load'); el.innerHTML = '<span class="spinner" style="margin:0"></span>';
      try { await Promise.allSettled([load(), loadNotices(), loadEssays()]); if (state.tab === 'quiz' && modal.classList.contains('hidden')) drawQuizTab(false); toast('تم التحديث ✓'); }
      finally { busy = false; el.classList.remove('load'); el.innerHTML = '<span class="ptr-i">↓</span>'; }
    }, { passive: true });
    addEventListener('touchcancel', () => { on = false; reset(); }, { passive: true });
  })();
  // ---------- التبويبات ----------
  function showTab(t) {
    state.tab = t; state.inQuiz = false; hideModal();
    $('#home').classList.toggle('hidden', t !== 'home'); $('#quizView').classList.toggle('hidden', t !== 'quiz');
    setNav(t === 'quiz' ? 'quizTab' : 'homeTab'); window.scrollTo(0, 0);
    if (t === 'quiz') drawQuizTab(true);
  }
  $('#homeTab').onclick = () => { if (state.tab === 'home' && modal.classList.contains('hidden')) window.scrollTo({ top: 0, behavior: 'smooth' }); else showTab('home'); };
  $('#quizTab').onclick = () => showTab('quiz');
  $('#accountTab').onclick = () => { setNav('accountTab'); showAccount(); };
  // ---------- إجابات المقالي ----------
  async function loadEssays() {
    if (!url || !anon || !state.session) return;
    try { state.essays = await api(`/rest/v1/essay_answers?select=id,lecture_id,lecture_title,question_index,question_text,answer_text,points,status,score,feedback,created_at,graded_at&user_id=eq.${encodeURIComponent(state.session.user.id)}&order=created_at.desc&limit=500`); } catch { return; }
    const n = unseenGraded().length; updateQuizBadge();
    if (n && !state.gradedToast) { state.gradedToast = true; toast(n === 1 ? 'تم تصحيح إجابتك المقالية ✓' : `تم تصحيح ${n} من إجاباتك المقالية ✓`); }
  }
  const gKey = () => 'seen-graded-' + (state.session?.user?.id || '');
  const seenGraded = () => { try { return JSON.parse(localStorage.getItem(gKey()) || '[]'); } catch { return []; } };
  const unseenGraded = () => { const s = seenGraded(); return state.essays.filter(e => e.status === 'graded' && !s.includes(e.id)); };
  function updateQuizBadge() { const b = $('#quizBadge'); if (!b) return; const n = unseenGraded().length; b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n); }
  const essayOf = (lid, ix) => state.essays.find(e => String(e.lecture_id) === String(lid) && Number(e.question_index) === Number(ix));
  const essayChip = e => e.status === 'graded' ? `<span class="chip ok">تم التصحيح: ${e.score} من ${e.points}</span>` : '<span class="chip wait">⏳ جاري التصحيح</span>';
  function lecEssayChips(x) {
    const es = state.essays.filter(e => String(e.lecture_id) === String(x.id)); if (!es.length) return '';
    const pend = es.filter(e => e.status !== 'graded').length;
    if (pend) return `<span class="chip wait">جاري التصحيح${es.length > 1 ? ' (' + pend + ')' : ''}</span>`;
    const f = lecFinal(x); return f ? `<span class="chip ok">النتيجة النهائية: ${f.got} من ${f.of}</span>` : '';
  }
  function drawQuizTab(refresh = true) {
    const v = $('#quizView'); if (!v) return;
    const ws = byWeek(state.lessons.filter(x => qCount(x)));
    v.innerHTML = `<div class="qv-head"><span class="eyebrow">راجع ما تعلمت</span><h1>الاختبارات</h1><p>اختبار لكل محاضرة. أسئلة الاختيار تُصحَّح فورًا، والمقالية يصحّحها المشرف. لا يمكن إعادة الاختبار بعد إنهائه، لكن يمكنك الاطلاع على الإجابات.</p></div>${ws.length ? ws.map(([w, items]) => { const op = state.openWeeks.has(w); return `<div class="week-group${op ? ' open' : ''}"><button class="week-head wk-toggle${weekDone(w) ? ' done' : ''}" data-wk="${w}" aria-expanded="${op}"><div><b>${weekDone(w) ? '<span class="tick">✓</span> ' : ''}الأسبوع ${w}</b><small>${items.reduce((n, x) => n + qCount(x), 0)} سؤال</small></div><span class="chev">⌄</span></button><div class="wk-body">` + items.map(x => { const c = qCounts(x); return `<button class="qv-lec" data-quiz="${esc(x.id)}"><span class="qv-info"><span>${lecDone(x.id) ? '<span class="tick">✓</span> ' : ''}${esc(x.title)}</span><small>${c.mcq ? c.mcq + ' اختيار' : ''}${c.mcq && c.essay ? ' · ' : ''}${c.essay ? c.essay + ' مقالي' : ''}</small>${lecEssayChips(x)}${(() => { const f = lecFinal(x); return f && !qCounts(x).essay ? `<span class="chip ok">النتيجة: ${f.got} من ${f.of}</span>` : ''; })()}</span><span class="qv-go">${lecComplete(x) ? 'عرض الإجابات' : (lecDone(x.id) ? 'متابعة' : 'ابدأ')} ←</span></button>`; }).join('') + '</div></div>'; }).join('') : '<div class="empty">لا توجد اختبارات بعد.<br>ستظهر هنا أسئلة المحاضرات عند نشرها.</div>'}`;
    if (refresh) loadEssays().then(() => { if (state.tab === 'quiz' && modal.classList.contains('hidden')) drawQuizTab(false); });
    else { try { localStorage.setItem(gKey(), JSON.stringify(state.essays.filter(e => e.status === 'graded').map(e => e.id))); } catch {} updateQuizBadge(); }
  }
  $('#quizView').addEventListener('click', e => {
    const quiz = e.target.closest('[data-quiz]')?.dataset.quiz, wk = e.target.closest('[data-weekquiz]')?.dataset.weekquiz;
    if (quiz) { const l = state.lessons.find(x => String(x.id) === quiz); if (l && lecComplete(l)) showReview(l); else startQuiz(l ? [l] : [], { scope: 'lecture', label: l?.title, lecture_id: l?.id, week: Number(l?.week) || 1 }); }
    if (wk) startQuiz(state.lessons.filter(x => (Number(x.week) || 1) === Number(wk)), { scope: 'week', label: 'اختبار الأسبوع ' + wk, week: Number(wk) });
    const tg = e.target.closest('[data-wk]'); if (tg) { const w = Number(tg.dataset.wk); state.openWeeks.has(w) ? state.openWeeks.delete(w) : state.openWeeks.add(w); const g = tg.closest('.week-group'); g.classList.toggle('open'); tg.setAttribute('aria-expanded', g.classList.contains('open')); }
  });
  async function showGrading(tab = 'pending') {
    open('<h2>تصحيح المقالي</h2><p class="hint"><span class="spinner"></span> جارٍ التحميل...</p>');
    let rows;
    try { rows = await api(`/rest/v1/essay_answers?select=*&status=eq.${tab}&order=created_at.${tab === 'pending' ? 'asc' : 'desc'}&limit=100`); }
    catch (e) { open(`<h2>تصحيح المقالي</h2><p class="hint">${esc(e.message)}</p><button class="secondary full" id="gBack">رجوع</button>`); $('#gBack').onclick = showAdmin; return; }
    const model = r => { const l = state.lessons.find(x => String(x.id) === String(r.lecture_id)); const q = l && Array.isArray(l.questions) ? l.questions[r.question_index] : null; return q && qType(q) === 'essay' && q.explanation ? q.explanation : ''; };
    open(`<h2>تصحيح المقالي</h2><div class="seg-tabs"><button data-gt="pending" class="${tab === 'pending' ? 'on' : ''}">بانتظار التصحيح</button><button data-gt="graded" class="${tab === 'graded' ? 'on' : ''}">تم تصحيحها</button></div><div id="gList">${rows.length ? rows.map(r => `<div class="essay-card" data-id="${esc(r.id)}"><div class="meta"><span><b>${esc(r.user_name || 'طالب')}</b> <span dir="ltr">${esc(r.user_contact || '')}</span></span><span>${fmtDate(r.created_at)}</span></div><div class="meta"><span>${esc(r.lecture_title || '')}${r.week ? ' · الأسبوع ' + r.week : ''}</span><span>الدرجة من ${r.points}</span></div><div class="q">${esc(r.question_text)}</div><div class="a">${esc(r.answer_text)}</div>${model(r) ? `<div class="model"><b>الإجابة النموذجية:</b> ${esc(model(r))}</div>` : ''}<div class="grade-row"><div class="field" style="width:96px"><label>الدرجة</label><input type="number" data-score min="0" max="${r.points}" inputmode="numeric" value="${r.score ?? ''}"></div><div class="field" style="flex:1"><label>ملاحظة للطالب (اختياري)</label><input data-fb maxlength="500" value="${esc(r.feedback || '')}"></div></div><button class="small-btn" data-save="${esc(r.id)}">${tab === 'pending' ? 'حفظ التصحيح' : 'تعديل التصحيح'}</button></div>`).join('') : `<p class="hint">${tab === 'pending' ? 'لا توجد إجابات بانتظار التصحيح.' : 'لم تصحّح شيئًا بعد.'}</p>`}</div><button class="secondary full" id="gBack">رجوع</button>`);
    $('#gBack').onclick = showAdmin;
    body.querySelectorAll('[data-gt]').forEach(b => b.onclick = () => showGrading(b.dataset.gt));
    $('#gList').onclick = async e => {
      const id = e.target.closest('[data-save]')?.dataset.save; if (!id) return;
      const card = e.target.closest('.essay-card'), r = rows.find(x => String(x.id) === id), sc = card.querySelector('[data-score]').value.trim();
      if (sc === '' || isNaN(Number(sc)) || Number(sc) < 0 || Number(sc) > Number(r.points)) { toast(`اكتب درجة من 0 إلى ${r.points}.`); return; }
      e.target.disabled = true;
      try { await api(`/rest/v1/essay_answers?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'graded', score: Math.round(Number(sc)), feedback: card.querySelector('[data-fb]').value.trim() || null, graded_at: new Date().toISOString() }) }); toast('تم حفظ التصحيح.'); showGrading(tab); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    };
  }
  async function showLesson(x) {
    if (!x) return;
    let media = '';
    if (x.media_url) { const local = offHas('audio', x.id) ? OFF.path('audio', String(x.id)) : x.media_url; const isLocal = local !== x.media_url;
      media = `<div class="player"><audio id="player" preload="metadata" src="${esc(local)}"></audio><div class="p-top"><div class="p-art" id="pArt">♫</div><div class="p-meta"><b>المحاضرة الصوتية</b><small>${isLocal ? '⬇ تعمل من جهازك بدون إنترنت' : 'استماع مباشر'}</small></div></div>
<input type="range" id="pSeek" min="0" max="1000" value="0" dir="rtl" aria-label="موضع التشغيل"><div class="p-times"><span id="pCur">0:00</span><span id="pDur">0:00</span></div>
<div class="p-ctrl"><button class="p-chip" id="pSpeed" aria-label="السرعة">1×</button><button class="p-skip" id="pBack" aria-label="رجوع 15 ثانية"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.3" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">15</text></svg></button><button class="p-play" id="pPlay" aria-label="تشغيل"><svg viewBox="0 0 24 24" id="pIcon"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></button><button class="p-skip" id="pFwd" aria-label="تقدم 15 ثانية"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><text x="12" y="15.3" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">15</text></svg></button><span class="p-chip ghost"></span></div><p class="p-err hidden" id="pErr">تعذّر تشغيل الصوت. تأكد من الإنترنت أو حمّل المحاضرة أولًا.</p></div>`; }
    open(`<div class="lec-screen" style="padding-top:34px"><span class="eyebrow">محاضرة · الأسبوع ${Number(x.week) || 1}</span><h3>${esc(x.title)}</h3>${media}${x.description ? `<p>${esc(x.description)}</p>` : ''}<div id="dlBox"></div>${x.pdf_url ? '<h4 class="lec-sec">📄 ملف المحاضرة</h4><div id="pdfBox"></div>' : ''}</div>`, true);
    wirePlayer(); drawDl(x); if (x.pdf_url) drawPdf(x);
  }
  function drawPdf(x) {
    const box = $('#pdfBox'); if (!box) return;
    if (!OFF) { box.innerHTML = `<iframe class="pdf-frame" src="${esc(x.pdf_url)}" title="ملف المحاضرة"></iframe><a class="small-btn mint" href="${esc(x.pdf_url)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">فتح الملف في صفحة جديدة</a>`; return; }
    if (offHas('pdf', x.id)) { renderPdf(x, box); return; }
    box.innerHTML = '<button class="btn-pdf" id="pdfShow"><span class="bd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg></span><span class="bd-txt"><b>فتح ملف PDF</b><small>اضغط للعرض هنا داخل التطبيق</small></span></button>';
    $('#pdfShow').onclick = () => renderPdf(x, box);
  }
  async function renderPdf(x, box) {
    box.innerHTML = '<p class="hint pdf-status"></p><div class="pdf-pages"></div>';
    const st = box.querySelector('.pdf-status'), pages = box.querySelector('.pdf-pages');
    if (!offHas('pdf', x.id)) {
      st.innerHTML = '<span class="spinner"></span> جارٍ تحميل الملف...';
      try { await offDownload('pdf', x.id, x.pdf_url, p => { st.textContent = 'جارٍ التحميل ' + p + '٪'; }); render(); } catch (err) { st.textContent = err.message; return; }
    }
    st.textContent = '';
    const n = OFF.pdfPages(String(x.id)); if (!n) { st.textContent = 'تعذّر عرض الملف.'; return; }
    const w = Math.min(1200, Math.round(innerWidth * (devicePixelRatio || 1)));
    for (let i = 0; i < n && pages.isConnected; i++) { const img = new Image(); img.className = 'pdf-page'; img.src = OFF.pdfPage(String(x.id), i, w); pages.appendChild(img); await new Promise(r => setTimeout(r, 30)); }
  }
  function wirePlayer() {
    const a = $('#player'); if (!a) return;
    const play = $('#pPlay'), seek = $('#pSeek'), cur = $('#pCur'), dur = $('#pDur'), icon = $('#pIcon'), art = $('#pArt');
    const fmt = t => { if (!isFinite(t)) return '0:00'; t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s2 = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`; };
    const PLAY = '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', PAUSE = '<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/>';
    let drag = false;
    const paint = () => { const f = a.duration ? a.currentTime / a.duration : 0; if (!drag) seek.value = Math.round(f * 1000); seek.style.setProperty('--p', (f * 100) + '%'); cur.textContent = fmt(a.currentTime); };
    a.onloadedmetadata = () => { dur.textContent = fmt(a.duration); paint(); };
    a.ontimeupdate = paint;
    a.onplay = () => { icon.innerHTML = PAUSE; play.classList.add('on'); art.classList.add('spin'); };
    a.onpause = () => { icon.innerHTML = PLAY; play.classList.remove('on'); art.classList.remove('spin'); };
    a.onwaiting = () => play.classList.add('wait'); a.onplaying = () => play.classList.remove('wait'); a.oncanplay = () => play.classList.remove('wait');
    a.onended = () => { a.currentTime = 0; paint(); };
    a.onerror = () => { $('#pErr')?.classList.remove('hidden'); play.classList.remove('wait'); };
    play.onclick = () => { if (a.paused) a.play().catch(() => $('#pErr').classList.remove('hidden')); else a.pause(); };
    $('#pBack').onclick = () => { a.currentTime = Math.max(0, a.currentTime - 15); };
    $('#pFwd').onclick = () => { a.currentTime = Math.min(a.duration || 1e9, a.currentTime + 15); };
    const rates = [1, 1.25, 1.5, 2, 0.75]; let ri = 0;
    $('#pSpeed').onclick = () => { ri = (ri + 1) % rates.length; a.playbackRate = rates[ri]; $('#pSpeed').textContent = rates[ri] + '×'; };
    seek.oninput = () => { drag = true; if (a.duration) { a.currentTime = seek.value / 1000 * a.duration; } paint(); };
    seek.onchange = () => { drag = false; };
    seek.onpointerup = () => { drag = false; };
  }

  function drawDl(x) {
    const box = $('#dlBox'); if (!box || !OFF || !dlItems(x).length) return;
    if (isSaved(x)) {
      box.innerHTML = '<div class="dl-ok">✓ محمّلة على جهازك وتعمل بدون إنترنت</div><button class="btn-del" id="dlDel">حذف التحميل من الجهاز</button>';
      $('#dlDel').onclick = () => { dlItems(x).forEach(i => OFF.remove(i.k, String(x.id))); render(); drawDl(x); toast('تم حذف التحميل.'); };
      return;
    }
    box.innerHTML = '<button class="btn-dl" id="dlGo"><span class="bd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg></span><span class="bd-txt"><b>تحميل المحاضرة</b><small>للاستماع بدون إنترنت في أي وقت</small></span></button><div class="dl-bar hidden" id="dlBar"><i></i></div><p class="hint" id="dlSt"></p>';
    $('#dlGo').onclick = async () => {
      const btn = $('#dlGo'), st = $('#dlSt'); btn.disabled = true; $('#dlBar').classList.remove('hidden');
      const todo = dlItems(x).filter(i => !offHas(i.k, x.id));
      try {
        for (let n = 0; n < todo.length; n++) { const i = todo[n]; await offDownload(i.k, x.id, i.url, p => { st.textContent = `جارٍ تحميل ${i.k === 'pdf' ? 'ملف PDF' : 'الصوت'} (${n + 1}/${todo.length}): ${p}٪`; const bi = $('#dlBar i'); if (bi) bi.style.width = Math.round((n + p / 100) / todo.length * 100) + '%'; }); }
        const pl = $('#player'); if (pl && pl.paused && offHas('audio', x.id)) pl.src = OFF.path('audio', String(x.id));
        render(); drawDl(x); toast('تم التحميل.');
      } catch (err) { btn.disabled = false; st.textContent = err.message; }
    };
  }
  const doneKey = () => 'done-' + (state.session?.user?.id || '');
  const getDone = () => { try { const d = JSON.parse(localStorage.getItem(doneKey()) || '{}'); return { weeks: d.weeks || [], lectures: d.lectures || [] }; } catch { return { weeks: [], lectures: [] }; } };
  const weekDone = w => getDone().weeks.includes(Number(w));
  const lecDone = id => getDone().lectures.includes(String(id));
  function saveDone(d) { try { localStorage.setItem(doneKey(), JSON.stringify(d)); } catch {} }
  function markDone(m) {
    if (!m) return; const d = getDone();
    if (m.scope === 'week' && m.week && !d.weeks.includes(Number(m.week))) d.weeks.push(Number(m.week));
    if (m.scope === 'lecture' && m.lecture_id && !d.lectures.includes(String(m.lecture_id))) d.lectures.push(String(m.lecture_id));
    saveDone(d); render();
  }
  async function loadDone() {
    if (!url || !anon || !state.session) return;
    try {
      const rows = await api(`/rest/v1/quiz_results?select=scope,week,lecture_id,correct,total,created_at&user_id=eq.${encodeURIComponent(state.session.user.id)}&order=created_at.desc&limit=1000`);
      state.myResults = rows; await loadEssays();
      const d = { weeks: [], lectures: [] };
      rows.forEach(r => { if (r.scope === 'lecture' && r.lecture_id && !d.lectures.includes(String(r.lecture_id))) d.lectures.push(String(r.lecture_id)); });
      state.essays.forEach(e => { if (!d.lectures.includes(String(e.lecture_id))) d.lectures.push(String(e.lecture_id)); });
      saveDone(d); render();
    } catch {}
  }
  // النتيجة النهائية لمحاضرة: لا تظهر إلا بعد تصحيح كل المقالي
  function lecFinal(x) {
    const r = (state.myResults || []).find(r => r.scope === 'lecture' && String(r.lecture_id) === String(x.id));
    const nEs = qCounts(x).essay, es = state.essays.filter(e => String(e.lecture_id) === String(x.id));
    if (nEs && (es.length < nEs || es.some(e => e.status !== 'graded'))) return null;
    if (!r && !es.length) return null;
    return { got: (r ? Number(r.correct) : 0) + es.reduce((n, e) => n + Number(e.score || 0), 0), of: (r ? Number(r.total) : 0) + es.reduce((n, e) => n + Number(e.points || 0), 0) };
  }
  // ---------- درجة السؤال + الاكتمال + مراجعة الإجابات ----------
  const ptsLabel = n => n === 1 ? 'درجة واحدة' : n === 2 ? 'درجتان' : n <= 10 ? n + ' درجات' : n + ' درجة';
  const mcqPts = q => Math.max(1, Number(q && q.points) || 1);
  const essPts = q => Math.max(1, Number(q && q.points) || 10);
  function lecComplete(x) {
    const c = qCounts(x); if (!(c.mcq + c.essay)) return false;
    const hasRes = (state.myResults || []).some(r => r.scope === 'lecture' && String(r.lecture_id) === String(x.id));
    const nEs = state.essays.filter(e => String(e.lecture_id) === String(x.id)).length;
    return (!c.mcq || hasRes) && nEs >= c.essay;
  }
  const selKey = () => 'mcq-sel-' + (state.session?.user?.id || '');
  const getSel = lid => { try { return (JSON.parse(localStorage.getItem(selKey()) || '{}'))[String(lid)] || {}; } catch { return {}; } };
  function saveSel(m, quiz) {
    if (!m || m.scope !== 'lecture') return;
    try {
      const all = JSON.parse(localStorage.getItem(selKey()) || '{}'), cur = all[String(m.lecture_id)] || {};
      quiz.filter(q => q.type === 'mcq').forEach(q => { const v = (state.sel || {})[q.lid + ':' + q.qix]; if (v !== undefined) cur[q.qix] = v; });
      all[String(m.lecture_id)] = cur; localStorage.setItem(selKey(), JSON.stringify(all));
    } catch {}
  }
  function failSave(m) {
    if (m && m.scope === 'lecture') {
      state.myResults = (state.myResults || []).filter(r => String(r.lecture_id) !== String(m.lecture_id));
      const d = getDone(); d.lectures = d.lectures.filter(id => id !== String(m.lecture_id)); saveDone(d);
    }
    render(); toast('تعذّر حفظ نتيجتك. تأكد من الإنترنت ثم أعد الاختبار.');
  }
  function showReview(x) {
    const qs = Array.isArray(x.questions) ? x.questions : [], sel = getSel(x.id), L = ['أ','ب','ج','د','هـ','و'], fin = lecFinal(x);
    const items = qs.map((q, i) => {
      if (!q || !q.text) return '';
      if (qType(q) === 'essay') {
        const e = essayOf(x.id, i);
        return `<div class="rv-q"><div class="rv-h"><span class="rv-n">${i + 1}</span><b>${esc(q.text)}</b></div><small class="rv-pts">سؤال مقالي · ${ptsLabel(essPts(q))}</small>${e ? `<div class="essay-card"><div class="meta">${essayChip(e)}</div><div class="a">${esc(e.answer_text)}</div>${e.status === 'graded' && e.feedback ? `<div class="fb"><b>ملاحظة المشرف:</b> ${esc(e.feedback)}</div>` : ''}</div>` : '<p class="hint">لم تُجب عن هذا السؤال.</p>'}</div>`;
      }
      if (!(q.options || []).length) return '';
      const ans = Number(q.answer), mine = sel[i], known = mine !== undefined && mine !== null, pts = mcqPts(q);
      return `<div class="rv-q"><div class="rv-h"><span class="rv-n">${i + 1}</span><b>${esc(q.text)}</b></div><small class="rv-pts">اختيار من متعدد · ${ptsLabel(pts)}${known ? (mine === ans ? ' · <span class="rv-yes">✓ إجابتك صحيحة</span>' : ' · <span class="rv-no">✗ إجابتك خاطئة</span>') : ''}</small>${q.options.map((o, k) => o ? `<div class="rv-opt${k === ans ? ' ok' : (known && k === mine ? ' bad' : '')}"><b>${L[k] || k + 1}</b><span>${esc(o)}</span>${k === ans ? '<em>الإجابة الصحيحة</em>' : (known && k === mine ? '<em>إجابتك</em>' : '')}</div>` : '').join('')}${q.explanation ? `<div class="rv-exp"><b>الشرح:</b> ${esc(q.explanation)}</div>` : ''}</div>`;
    }).join('');
    open(`<h2>إجابات: ${esc(x.title)}</h2>${fin ? `<div class="dl-ok">درجتك النهائية ${fin.got} من ${fin.of}</div>` : ''}<p class="hint">للاطلاع فقط، لا يمكن إعادة الاختبار.</p>${items || '<p class="hint">لا توجد أسئلة.</p>'}<button class="secondary full" id="rvClose">إغلاق</button>`);
    $('#rvClose').onclick = close;
  }
  async function startQuiz(lessons, meta = { scope: 'all', label: 'مراجعة' }) {
    const qs = lessons.flatMap(l => (Array.isArray(l.questions) ? l.questions : []).map((q, i) => ({ ...q, type: qType(q), lessonTitle: l.title, lid: String(l.id), qix: i, week: Number(l.week) || 1 }))).filter(q => q.text && (q.type === 'essay' || q.options?.length >= 2));
    if (!qs.length) { toast('لا توجد أسئلة منشورة لهذه المحاضرات بعد.'); return; }
    await loadEssays();
    const hasRes = meta.scope === 'lecture' && (state.myResults || []).some(r => r.scope === 'lecture' && String(r.lecture_id) === String(meta.lecture_id));
    const mcq = hasRes ? [] : qs.filter(q => q.type === 'mcq').sort(() => Math.random() - .5), es = qs.filter(q => q.type === 'essay');
    state.sel = {};
    state.inQuiz = true; state.quizMeta = meta; state.quiz = [...mcq, ...es]; state.mcqTotal = mcq.reduce((n, q) => n + mcqPts(q), 0); state.qi = 0; state.score = 0; state.selected = -1; showQuestion();
  }
  function qHead(q) {
    const total = state.quiz.length;
    return `<div class="q-top"><span class="eyebrow">${state.qi + 1} / ${total}</span><div class="progress"><i style="width:${Math.round(state.qi / total * 100)}%"></i></div></div><span class="q-type">${esc(q.lessonTitle || 'مراجعة')} · ${q.type === 'essay' ? 'سؤال مقالي' : 'اختيار من متعدد'} · ${ptsLabel(q.type === 'essay' ? essPts(q) : mcqPts(q))}</span><h3 class="q-text">${esc(q.text)}</h3>`;
  }
  function nextQuestion() { state.qi++; state.selected = -1; if (state.qi >= state.quiz.length) showResult(); else showQuestion(); }
  function showQuestion() {
    const q = state.quiz[state.qi], total = state.quiz.length;
    if (q.type === 'essay') { showEssay(q); return; }
    open(`<div class="qscreen">${qHead(q)}<div id="options">${q.options.map((o, i) => `<label class="answer-option" data-option="${i}"><input type="radio" name="answer" hidden><b class="opt-l">${['أ','ب','ج','د','هـ','و'][i] || i + 1}</b><span class="opt-t">${esc(o)}</span></label>`).join('')}</div><div id="feedback"></div><div class="q-act"><button class="primary full" id="checkAnswer">${state.qi === total - 1 && !state.quiz.some(x => x.type === 'essay') ? 'إنهاء وعرض النتيجة' : 'التالي ←'}</button></div></div>`, true);
    $('#options').onclick = e => {
      const row = e.target.closest('[data-option]'); if (!row) return;
            state.selected = Number(row.dataset.option);
      $('#options').querySelectorAll('.answer-option').forEach(n => n.classList.remove('selected'));
      row.classList.add('selected'); row.querySelector('input').checked = true;
    };
    $('#checkAnswer').onclick = () => {
      if (state.selected < 0) { toast('اختر إجابة أولًا.'); return; }
      (state.sel = state.sel || {})[q.lid + ':' + q.qix] = state.selected;
      if (Number(q.answer) === state.selected) state.score += mcqPts(q);
      nextQuestion();
    };
  }
  function showEssay(q) {
    const prev = essayOf(q.lid, q.qix), pts = essPts(q), last = state.qi === state.quiz.length - 1;
    open(`<div class="qscreen">${qHead(q)}<div class="essay-box"><textarea id="essayText" maxlength="4000" placeholder="اكتب إجابتك هنا..." ${prev ? 'disabled' : ''}>${esc(prev ? prev.answer_text : '')}</textarea>${prev ? '' : '<small class="cnt" id="essayCnt">0 / 4000</small>'}</div><div id="feedback">${prev ? `<p>${essayChip(prev)}</p>${prev.status === 'graded' && prev.feedback ? `<p><b>ملاحظة المشرف:</b> ${esc(prev.feedback)}</p>` : ''}` : `<p class="hint">درجة السؤال: ${pts}. يصحّح المشرف إجابتك، وتظهر لك «جاري التصحيح» حتى تُصحَّح.</p>`}</div><div class="q-act"><button class="primary full" id="essayNext">${prev ? (last ? 'إنهاء' : 'السؤال التالي ←') : (last ? 'إرسال وإنهاء' : 'إرسال والتالي ←')}</button></div></div>`, true);
    if (!prev) $('#essayText').oninput = e => { $('#essayCnt').textContent = e.target.value.length + ' / 4000'; };
    $('#essayNext').onclick = async () => {
      const btn = $('#essayNext');
      if (!prev) {
        const t = $('#essayText').value.trim(); if (t.length < 2) { toast('اكتب إجابتك أولًا.'); return; }
        btn.disabled = true; btn.textContent = 'جارٍ الإرسال...';
        try { await submitEssay(q, t, pts); } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = last ? 'إرسال وإنهاء' : 'إرسال والتالي ←'; return; }
      }
      nextQuestion();
    };
  }
  async function submitEssay(q, text, pts) {
    const u = state.session.user, um = u.user_metadata || {}, em = u.email || '';
    const row = { user_id: u.id, user_name: um.full_name || '', user_contact: um.phone || (isPhoneEmail(em) ? '' : em), lecture_id: q.lid, lecture_title: String(q.lessonTitle || '').slice(0, 200), week: q.week, question_index: q.qix, question_text: q.text, answer_text: text, points: pts };
    const res = await api('/rest/v1/essay_answers?on_conflict=user_id,lecture_id,question_index', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify(row) });
    state.essays.unshift(res && res[0] ? res[0] : { ...row, status: 'pending', score: null, feedback: null, created_at: new Date().toISOString() });
  }
  function showResult() {
    const n = state.mcqTotal, ess = state.quiz.filter(q => q.type === 'essay'), m = state.quizMeta || {};
    state.inQuiz = false;
    if (n) { saveResult(n, state.score).catch(() => failSave(m)); if (m.scope === 'lecture') { state.myResults = (state.myResults || []).filter(r => String(r.lecture_id) !== String(m.lecture_id)); state.myResults.unshift({ scope: 'lecture', lecture_id: m.lecture_id, correct: state.score, total: n }); } }
    saveSel(m, state.quiz); markDone(m);
    const lec = state.lessons.find(x => String(x.id) === String(m.lecture_id)), fin = lec ? lecFinal(lec) : null;
    let msg;
    if (ess.length && !fin) msg = `<h2 style="text-align:center;padding:0">تم إرسال إجاباتك</h2><p style="text-align:center"><span class="chip wait">⏳ جاري التصحيح</span></p><p style="text-align:center">ستظهر درجتك كاملة (الاختيار والمقالي معًا) بعد أن يصحّح المشرف أسئلتك المقالية. سنخبرك هنا فور الانتهاء.</p>`;
    else { const g = fin || { got: state.score, of: n }; const p = g.of ? Math.round(g.got / g.of * 100) : 0; msg = `<h2 style="text-align:center;padding:0">أحسنت المراجعة</h2><p style="text-align:center">درجتك <b>${g.got}</b> من <b>${g.of}</b> (${p}٪).</p>`; }
    open(`<div class="about-mark">ض</div>${msg}${lec && m.scope === 'lecture' ? '<button class="secondary full" id="resultReview" style="margin-bottom:8px">عرض الإجابات</button>' : ''}<button class="primary full" id="resultDone">العودة</button>`);
    $('#resultDone').onclick = close;
    if ($('#resultReview')) $('#resultReview').onclick = () => showReview(lec);
  }
  $('#adminOpen').onclick = () => { if (state.admin) showAdmin(); };
  function showAdmin() {
    open(`<h2>إدارة المحاضرات</h2><div class="admin-banner">المحتوى الذي تنشره يظهر لجميع مستخدمي التطبيق عند التحديث.</div><button class="primary full" id="newLesson">＋ إضافة محاضرة</button><button class="secondary full" id="noticeAdmin">🔔 الإشعارات</button><button class="secondary full" id="gradeAdmin">📝 تصحيح الأسئلة المقالية <span class="chip wait hidden" id="gradeCnt"></span></button><button class="secondary full" id="studentsAdmin">📊 متابعة الطلاب</button><div class="field"><button class="secondary full" id="logout">تسجيل الخروج</button></div><div id="adminRows"></div>`);
    $('#newLesson').onclick=()=>lessonForm(null); $('#noticeAdmin').onclick=showNoticeAdmin; $('#studentsAdmin').onclick=showStudents; $('#gradeAdmin').onclick=()=>showGrading('pending'); api('/rest/v1/essay_answers?select=id&status=eq.pending&limit=500').then(r=>{const c=$('#gradeCnt');if(c&&r.length){c.textContent=r.length+' جديد';c.classList.remove('hidden');}}).catch(()=>{}); $('#logout').onclick=logout;
    $('#adminRows').innerHTML=state.lessons.length?state.lessons.map(x=>`<article class="lesson-card"><b>${esc(x.title)}</b><span class="week-badge">الأسبوع ${Number(x.week)||1}</span><div class="card-actions"><button class="small-btn" data-edit="${esc(x.id)}">تعديل</button><button class="small-btn danger" data-delete="${esc(x.id)}">حذف</button></div></article>`).join(''):'<p class="hint">لا توجد محاضرات منشورة حاليًا.</p>';
    $('#adminRows').onclick=e=>{const id=e.target.closest('[data-edit]')?.dataset.edit, del=e.target.closest('[data-delete]')?.dataset.delete;if(id)lessonForm(state.lessons.find(x=>String(x.id)===id));if(del)deleteLesson(del);};
  }
  function lessonForm(x) {
    state.editing=x;
    open(`<h2>${x?'تعديل المحاضرة':'إضافة محاضرة'}</h2><div class="field"><label>عنوان المحاضرة</label><input id="title" maxlength="120" value="${esc(x?.title||'')}" placeholder="مثال: الجملة الاسمية والفعلية"></div><div class="field"><label>نبذة مختصرة</label><textarea id="description" maxlength="800" placeholder="اكتب وصفًا موجزًا">${esc(x?.description||'')}</textarea></div><div class="field"><label>رقم الأسبوع</label><input id="week" type="number" min="1" max="100" inputmode="numeric" value="${Number(x?.week)||Math.max(1,...state.lessons.map(l=>Number(l.week)||1))}"></div><div class="field"><label>ملف المحاضرة الصوتي</label><input id="mediaFile" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav"><span class="hint">ملف صوت (MP3 أو M4A) أقل من 50 ميجابايت. يمكن إضافة رابط MP3 عام بدل الرفع.</span></div><div class="field"><label>ملف PDF (اختياري)</label><input id="pdfFile" type="file" accept="application/pdf,.pdf"><span class="hint">${x?.pdf_url ? 'يوجد ملف PDF حاليًا، اختر ملفًا جديدًا لاستبداله. ' : ''}الحد الأقصى 50 ميجابايت.</span>${x?.pdf_url ? '<label class="hint"><input type="checkbox" id="pdfRemove"> حذف ملف PDF الحالي</label>' : ''}</div><div class="field"><label>أو رابط MP3 مباشر</label><input id="mediaUrl" type="url" value="${esc(x?.media_url||'')}" placeholder="https://..."></div><div class="section-head" style="margin:20px 0 8px"><h2 style="font-size:19px">أسئلة المحاضرة</h2></div><div id="questionFields">${(x?.questions||[]).map(questionEditor).join('')}</div><button class="secondary full" id="addQuestion">＋ إضافة سؤال</button><button class="primary full" id="saveLesson">${x?'حفظ التعديلات ونشرها':'نشر المحاضرة'}</button><p class="hint" id="saveStatus"></p>`);
    $('#addQuestion').onclick=()=>{$('#questionFields').insertAdjacentHTML('beforeend',questionEditor());};
    $('#saveLesson').onclick=()=>saveLesson(x);
  }
  let questionNumber=0;
  function questionEditor(q={type:'mcq',text:'',options:['','','',''],answer:0,explanation:'',points:1}) {
    const essay=q.type==='essay',opts=[...(q.options||[])];while(opts.length<4)opts.push('');
    const group=`correct-${questionNumber++}`;
    return `<div class="qbox"><div class="field q-type-sel"><label>نوع السؤال</label><select data-qtype><option value="mcq" ${essay?'':'selected'}>اختيار من متعدد</option><option value="essay" ${essay?'selected':''}>مقالي (يصحّحه المشرف)</option></select></div><div class="field"><label>السؤال</label><input data-qtext maxlength="300" value="${esc(q.text||'')}" placeholder="اكتب السؤال"></div><div class="q-mcq ${essay?'hidden':''}">${opts.slice(0,4).map((o,i)=>`<div class="qrow"><div class="field" style="flex:1"><label>الخيار ${i+1}</label><input data-optiontext value="${esc(o)}" placeholder="نص الإجابة"></div><label><input type="radio" data-correct name="${group}" ${!essay&&Number(q.answer)===i?'checked':''}> صحيح</label></div>`).join('')}</div><div class="field"><label>درجة السؤال</label><input type="number" data-points min="1" max="100" inputmode="numeric" value="${Number(q.points)||(essay?10:1)}"></div><div class="field"><label data-explabel>${essay?'إجابة نموذجية للمصحّح':'شرح اختياري'}</label><input data-explanation value="${esc(q.explanation||'')}" placeholder="${essay?'تظهر لك أنت عند التصحيح':'توضيح الإجابة'}"></div><button class="secondary danger" data-remove-q>حذف السؤال</button></div>`;
  }
  $('#modalBody').addEventListener('change',e=>{const s=e.target.closest('[data-qtype]');if(!s)return;const box=s.closest('.qbox'),es=s.value==='essay';box.querySelector('.q-mcq').classList.toggle('hidden',es);{const pi=box.querySelector('[data-points]');const v=parseInt(pi.value,10)||0;if(es&&v<=1)pi.value=10;if(!es&&v===10)pi.value=1;}box.querySelector('[data-explabel]').textContent=es?'إجابة نموذجية للمصحّح':'شرح اختياري';});
  $('#modalBody').addEventListener('click',e=>{if(e.target.matches('[data-remove-q]'))e.target.closest('.qbox').remove();});
  async function saveLesson(x) {
    const status=$('#saveStatus'), title=$('#title').value.trim(); if(!title){toast('اكتب عنوان المحاضرة.');return;}
    const questions=[...document.querySelectorAll('.qbox')].map(box=>{const type=box.querySelector('[data-qtype]').value,text=box.querySelector('[data-qtext]').value.trim(),explanation=box.querySelector('[data-explanation]').value.trim(),points=Math.min(100,Math.max(1,parseInt(box.querySelector('[data-points]').value,10)||(type==='essay'?10:1)));if(type==='essay')return{type:'essay',text,points,explanation};return{type:'mcq',text,options:[...box.querySelectorAll('[data-optiontext]')].map(i=>i.value.trim()),answer:[...box.querySelectorAll('[data-correct]')].findIndex(i=>i.checked),explanation,points};}).filter(q=>q.text);
    if(questions.some(q=>q.type==='mcq'&&(q.options.filter(Boolean).length<2||q.answer<0||!q.options[q.answer]))){toast('أكمل خيارات كل سؤال اختيار وحدد الإجابة الصحيحة.');return;}
    status.textContent='جارٍ حفظ المحتوى...';
    try {
      let mediaUrl=$('#mediaUrl').value.trim(), mediaType='audio'; const file=$('#mediaFile').files[0];
      if(file){if(file.size>50*1024*1024)throw new Error('الملف أكبر من 50 ميجابايت.');if(state.session?.expires_at&&state.session.expires_at*1000<Date.now()+60000)await refreshSession();if(!(file.type||'').startsWith('audio/')&&!/\.(mp3|m4a|aac|ogg|wav)$/i.test(file.name))throw new Error('اختر ملفًا صوتيًا (MP3 أو M4A).');const path=`lectures/${Date.now()}-${file.name.normalize('NFKD').replace(/[^\w.-]+/g,'-')}`;const upload=await fetch(`${url}/storage/v1/object/lecture-media/${path}`,{method:'POST',headers:{...headers(), 'Content-Type':file.type||'application/octet-stream','x-upsert':'true'},body:file});if(!upload.ok)throw new Error('تعذّر رفع الملف. راجع إعدادات التخزين في Supabase.');mediaUrl=`${url}/storage/v1/object/public/lecture-media/${path}`;}
      let pdfUrl=x?.pdf_url||'';if($('#pdfRemove')?.checked)pdfUrl='';const pdf=$('#pdfFile').files[0];if(pdf){if(pdf.size>50*1024*1024)throw new Error('ملف الـ PDF أكبر من 50 ميجابايت.');if(state.session?.expires_at&&state.session.expires_at*1000<Date.now()+60000)await refreshSession();const pp=`lectures/${Date.now()}-${pdf.name.normalize('NFKD').replace(/[^\w.-]+/g,'-')}`;const up=await fetch(`${url}/storage/v1/object/lecture-media/${pp}`,{method:'POST',headers:{...headers(),'Content-Type':'application/pdf','x-upsert':'true'},body:pdf});if(!up.ok)throw new Error('تعذّر رفع ملف PDF.');pdfUrl=`${url}/storage/v1/object/public/lecture-media/${pp}`;}
      const week=Math.min(100,Math.max(1,parseInt($('#week').value,10)||1));const row={title,week,description:$('#description').value.trim(),media_url:mediaUrl,media_type:mediaType,pdf_url:pdfUrl,questions,published:true,updated_at:new Date().toISOString()};
      if(x)await api(`/rest/v1/lectures?id=eq.${encodeURIComponent(x.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(row)});
      else await api('/rest/v1/lectures',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(row)});
      toast('تم نشر المحاضرة بنجاح.');await load();showAdmin();
    } catch(e){status.textContent=e.message;}
  }
  async function deleteLesson(id){if(!confirm('حذف المحاضرة وأسئلتها؟'))return;try{await api(`/rest/v1/lectures?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});await load();showAdmin();toast('تم حذف المحاضرة.');}catch(e){toast(e.message);}}

  // ---------- الإشعارات داخل التطبيق ----------
  const seenKey = () => 'seen-ann-' + (state.session?.user?.id || '');
  const fmtDate = d => new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  async function loadNotices() {
    if (!url || !anon || !state.session) return;
    try {
      state.notices = await api('/rest/v1/announcements?select=id,title,body,created_at&order=created_at.desc&limit=30');
      let seen = ''; try { seen = localStorage.getItem(seenKey()) || ''; } catch {}
      const n = seen ? state.notices.filter(a => a.created_at > seen).length : state.notices.length;
      const b = $('#bellCount'); b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n); $('#bellOpen').classList.toggle('ring', n > 0);
    } catch {}
  }
  const noticeHtml = (a, del) => `<article class="notice"><b>${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}<small>${fmtDate(a.created_at)}</small>${del ? `<button class="small-btn danger" data-delnotice="${esc(a.id)}">حذف</button>` : ''}</article>`;
  $('#bellOpen').onclick = async () => {
    await loadNotices();
    const list = state.notices || [];
    open(`<h2>الإشعارات</h2>${list.length ? list.map(a => noticeHtml(a)).join('') : '<p class="hint">لا توجد إشعارات حتى الآن.</p>'}`);
    if (list.length) { try { localStorage.setItem(seenKey(), list[0].created_at); } catch {} $('#bellCount').classList.add('hidden'); }
  };
  async function showNoticeAdmin() {
    await loadNotices();
    open(`<h2>إرسال إشعار</h2><div class="admin-banner">يصل الإشعار لكل الطلاب: يظهر في الجرس فورًا، وفي إشعارات الهاتف خلال دقائق (ربع ساعة تقريبًا).</div><div class="field"><label>عنوان الإشعار</label><input id="nTitle" maxlength="120" placeholder="مثال: محاضرة جديدة"></div><div class="field"><label>نص الإشعار</label><textarea id="nBody" maxlength="1000" placeholder="اكتب الرسالة"></textarea></div><button class="primary full" id="nSend">إرسال الإشعار</button><p class="hint" id="nStatus"></p><h2 style="font-size:19px">الإشعارات السابقة</h2><div id="nList"></div><button class="secondary full" id="nBack">رجوع</button>`);
    const draw = () => { $('#nList').innerHTML = (state.notices || []).length ? state.notices.map(a => noticeHtml(a, true)).join('') : '<p class="hint">لم ترسل أي إشعار بعد.</p>'; };
    draw();
    $('#nBack').onclick = showAdmin;
    $('#nSend').onclick = async () => {
      const title = $('#nTitle').value.trim(), bodyText = $('#nBody').value.trim();
      if (!title) { toast('اكتب عنوان الإشعار.'); return; }
      $('#nSend').disabled = true; $('#nStatus').textContent = 'جارٍ الإرسال...';
      try { await api('/rest/v1/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ title, body: bodyText }) }); toast('تم إرسال الإشعار.'); showNoticeAdmin(); }
      catch (e) { $('#nStatus').textContent = e.message; $('#nSend').disabled = false; }
    };
    $('#nList').onclick = async e => {
      const id = e.target.closest('[data-delnotice]')?.dataset.delnotice; if (!id || !confirm('حذف هذا الإشعار؟')) return;
      try { await api(`/rest/v1/announcements?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('تم الحذف.'); showNoticeAdmin(); } catch (err) { toast(err.message); }
    };
  }
  // ---------- نتائج الاختبارات ----------
  function saveResult(total, correct) {
    const u = state.session?.user; if (!u || !state.quizMeta) return Promise.resolve();
    const m = state.quizMeta, um = u.user_metadata || {}, em = u.email || '';
    const row = { user_id: u.id, user_name: um.full_name || '', user_contact: um.phone || (/@phone\.bildad\.app$/.test(em) ? '' : em), scope: m.scope, label: String(m.label || '').slice(0, 200), week: m.week || null, lecture_id: m.lecture_id || null, correct, total };
    return api('/rest/v1/quiz_results', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify(row) });
  }
  const pct = (c, t) => Math.round(c * 100 / t);
  async function showStudents() {
    open('<h2>متابعة الطلاب</h2><p class="hint"><span class="spinner"></span> جارٍ التحميل...</p>');
    let rows;
    try { rows = await api('/rest/v1/rpc/admin_students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
    catch (e) { open(`<h2>متابعة الطلاب</h2><p class="hint">${esc(e.message)}</p><button class="secondary full" id="stBack">رجوع</button>`); $('#stBack').onclick = showAdmin; return; }
    const active = rows.filter(r => Number(r.attempts) > 0), totalAtt = rows.reduce((n, r) => n + Number(r.attempts), 0);
    const overall = active.length ? Math.round(active.reduce((n, r) => n + Number(r.avg_pct) * Number(r.attempts), 0) / totalAtt) : 0;
    open(`<h2>متابعة الطلاب</h2><div class="stat-row"><div><b>${rows.length}</b><small>طالب</small></div><div><b>${totalAtt}</b><small>محاولة</small></div><div><b>${overall}٪</b><small>المتوسط العام</small></div></div><div class="field"><input id="stSearch" placeholder="ابحث بالاسم أو الرقم أو الإيميل"></div><div class="field"><select id="stSort"><option value="recent">الأحدث نشاطًا</option><option value="high">الأعلى نسبة</option><option value="low">الأقل نسبة</option><option value="most">الأكثر محاولات</option><option value="none">لم يختبروا بعد</option></select></div><div id="stList"></div><button class="secondary full" id="stBack">رجوع</button>`);
    $('#stBack').onclick = showAdmin;
    const draw = () => {
      const q = $('#stSearch').value.trim().toLowerCase(), mode = $('#stSort').value;
      let list = rows.filter(r => (r.name + ' ' + r.contact).toLowerCase().includes(q));
      const num = v => v == null ? -1 : Number(v);
      if (mode === 'high') list.sort((a, b) => num(b.avg_pct) - num(a.avg_pct));
      if (mode === 'low') list = list.filter(r => Number(r.attempts) > 0).sort((a, b) => num(a.avg_pct) - num(b.avg_pct));
      if (mode === 'most') list.sort((a, b) => Number(b.attempts) - Number(a.attempts));
      if (mode === 'none') list = list.filter(r => Number(r.attempts) === 0);
      $('#stList').innerHTML = list.length ? list.map(r => `<button class="student" data-uid="${esc(r.uid)}"><span class="s-main"><b>${esc(r.name)}</b><small dir="ltr">${esc(r.contact || '')}</small></span><span class="s-score">${Number(r.attempts) ? `<b>${Math.round(Number(r.avg_pct))}٪</b><small>${r.attempts} محاولة</small>` : '<small>لم يختبر</small>'}</span></button>`).join('') : '<p class="hint">لا يوجد طلاب مطابقون.</p>';
    };
    draw(); $('#stSearch').oninput = draw; $('#stSort').onchange = draw;
    $('#stList').onclick = e => { const id = e.target.closest('[data-uid]')?.dataset.uid; if (id) showStudent(rows.find(r => r.uid === id), showStudents); };
  }
  async function showStudent(r, back) {
    open(`<h2>${esc(r.name)}</h2><p class="hint" dir="ltr" style="text-align:right">${esc(r.contact || '')}</p><p class="hint"><span class="spinner"></span> جارٍ التحميل...</p>`);
    let res;
    try { res = await api(`/rest/v1/quiz_results?select=label,scope,correct,total,created_at&user_id=eq.${encodeURIComponent(r.uid)}&order=created_at.desc&limit=100`); }
    catch (e) { toast(e.message); back(); return; }
    open(`<h2>${esc(r.name)}</h2><p class="hint" dir="ltr" style="text-align:right">${esc(r.contact || '')}</p><div class="stat-row"><div><b>${r.attempts}</b><small>محاولة</small></div><div><b>${Number(r.attempts) ? Math.round(Number(r.avg_pct)) + '٪' : '—'}</b><small>المتوسط</small></div><div><b>${Number(r.attempts) ? Math.round(Number(r.best_pct)) + '٪' : '—'}</b><small>الأفضل</small></div></div><p class="hint">سجّل: ${fmtDate(r.joined_at)}${r.last_login ? ' · آخر دخول: ' + fmtDate(r.last_login) : ''}</p>${res.length ? res.map(x => `<div class="result-row"><span><b>${esc(x.label || 'اختبار')}</b><small>${fmtDate(x.created_at)}</small></span><span class="s-score"><b>${pct(x.correct, x.total)}٪</b><small>${x.correct} من ${x.total}</small></span></div>`).join('') : '<p class="hint">لم يؤدِّ أي اختبار بعد.</p>'}<button class="secondary full" id="stBack2">رجوع للقائمة</button>`);
    $('#stBack2').onclick = back;
  }
  // يرجع true إذا تعامل التطبيق مع زر الرجوع، وfalse إذا كان يجب إغلاق التطبيق.
  window.appBack=()=>{if(!$('#auth').classList.contains('hidden'))return false;if(!modal.classList.contains('hidden')){tryClose();return true;}if(state.tab==='quiz'){showTab('home');return true;}if(window.scrollY>40){window.scrollTo({top:0,behavior:'smooth'});return true;}return false;};


  // ---------- الحسابات ----------
  const AUTH_ERRORS = [['phone_exists','هذا الرقم مسجّل بالفعل، جرّب تسجيل الدخول.'],['invalid_phone','رقم الهاتف غير صحيح.'],['weak_password','كلمة المرور قصيرة، استخدم 6 أحرف على الأقل.'],['name_required','اكتب اسمك.'],['invalid login','البريد/الهاتف أو كلمة المرور غير صحيحة، أو أن هذا الحساب تم حذفه. إن كنت متأكدًا من بياناتك فأنشئ حسابًا جديدًا أو تواصل مع المشرف.'],['already registered','هذا البريد مسجّل بالفعل، جرّب تسجيل الدخول.'],['already been registered','هذا البريد مسجّل بالفعل، جرّب تسجيل الدخول.'],['not confirmed','أكّد بريدك الإلكتروني من الرسالة التي وصلتك ثم سجّل الدخول.'],['at least','كلمة المرور قصيرة، استخدم 6 أحرف على الأقل.'],['valid email','اكتب بريدًا إلكترونيًا صحيحًا.'],['rate limit','محاولات كثيرة، انتظر قليلًا ثم حاول مرة أخرى.'],['weak','كلمة المرور ضعيفة، اختر كلمة أقوى.']];
  const friendly = m => { const l = String(m || '').toLowerCase(); const hit = AUTH_ERRORS.find(([k]) => l.includes(k)); return hit ? hit[1] : m; };
  // يحوّل المُدخل إلى {email} أو {phone} بصيغة دولية (الافتراضي مصر +20)، أو null إن لم يكن صالحًا.
  const PHONE_DOMAIN = 'phone.bildad.app';
  const isPhoneEmail = e => String(e || '').endsWith('@' + PHONE_DOMAIN);
  function ident(v) {
    v = String(v || '').trim();
    if (v.includes('@')) return /^\S+@\S+\.\S+$/.test(v) ? { email: v } : null;
    let d = v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
    if (d.startsWith('00')) d = '+' + d.slice(2); else if (d.startsWith('0')) d = '+20' + d.slice(1); else if (!d.startsWith('+')) d = '+' + d;
    return /^\+\d{8,15}$/.test(d) ? { email: d.slice(1) + '@' + PHONE_DOMAIN, phone: d } : null;
  }
  function setSession(data) { state.session = data; state.token = data.access_token; localStorage.setItem('session', JSON.stringify(data)); }
  function clearSession() { state.session = null; state.token = null; state.admin = false; localStorage.removeItem('session'); }
  function showAuth(mode = 'login', note = '', warn = false) {
    close(); $('#adminOpen').classList.add('hidden'); $('#bellOpen').classList.add('hidden'); state.notices = [];
    document.querySelector('.topbar').classList.add('hidden'); $('#home').classList.add('hidden'); $('#quizView').classList.add('hidden'); state.tab = 'home'; state.essays = []; document.querySelector('.bottom-nav').classList.add('hidden');
    const a = $('#auth'); a.classList.remove('hidden');
    const signup = mode === 'signup';
    a.innerHTML = `<div class="auth-box"><div class="auth-mark">ض</div><h1>بالضاد نتكلم</h1><p class="sub">${signup ? 'أنشئ حسابك لتبدأ رحلتك مع العربية' : 'أهلًا بك، سجّل دخولك لتتابع'}</p><div class="auth-card"><div class="auth-tabs"><button class="${signup ? '' : 'on'}" data-mode="login">تسجيل الدخول</button><button class="${signup ? 'on' : ''}" data-mode="signup">إنشاء حساب</button></div>${signup ? '<div class="field"><label>الاسم</label><input id="aName" maxlength="60" autocomplete="name" placeholder="اسمك الكريم"></div>' : ''}<div class="field"><label>البريد الإلكتروني أو رقم الهاتف</label><input id="aEmail" type="text" dir="ltr" autocomplete="username" placeholder="name@example.com أو 01012345678"></div><div class="field"><label>كلمة المرور</label><input id="aPass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="6 أحرف على الأقل"></div>${signup ? '<div class="field"><label>تأكيد كلمة المرور</label><input id="aPass2" type="password" autocomplete="new-password"></div>' : ''}<p class="auth-err" id="aErr"></p>${note ? `<div class="${warn ? 'auth-warn' : 'auth-ok'}">${esc(note)}</div>` : ''}<button class="primary full" id="aGo">${signup ? 'إنشاء الحساب' : 'دخول'}</button></div></div>`;
    a.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => showAuth(b.dataset.mode));
    const go = $('#aGo'), err = $('#aErr');
    const submit = async () => {
      err.textContent = ''; const idf = ident($('#aEmail').value), pass = $('#aPass').value;
      if (!$('#aEmail').value.trim() || !pass) { err.textContent = 'اكتب البريد أو رقم الهاتف وكلمة المرور.'; return; }
      if (!idf) { err.textContent = 'اكتب بريدًا إلكترونيًا أو رقم هاتف صحيحًا.'; return; }
      if (signup) {
        const name = $('#aName').value.trim();
        if (!name) { err.textContent = 'اكتب اسمك.'; return; }
        if (pass.length < 6) { err.textContent = 'كلمة المرور قصيرة، استخدم 6 أحرف على الأقل.'; return; }
        if (pass !== $('#aPass2').value) { err.textContent = 'كلمتا المرور غير متطابقتين.'; return; }
      }
      go.disabled = true; go.textContent = 'لحظة...';
      try {
        if (signup && idf.phone) {
          await api('/rest/v1/rpc/signup_with_phone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: $('#aName').value.trim(), p_phone: idf.phone, p_password: pass }) });
          const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: idf.email, password: pass }) });
          setSession(data); state.fresh = true; await enterApp(); return;
        }
        if (signup) {
          const data = await api('/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: idf.email, password: pass, data: { full_name: $('#aName').value.trim(), ...(idf.phone ? { phone: idf.phone } : {}) } }) });
          if (data?.access_token) { setSession(data); state.fresh = true; await enterApp(); return; }
          showAuth('login', 'تم إنشاء حسابك. أرسلنا رسالة تأكيد إلى بريدك، افتحها ثم سجّل الدخول.'); return;
        }
        const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: idf.email, password: pass }) });
        setSession(data); state.fresh = true; await enterApp();
      } catch (e) { err.textContent = friendly(e.message); go.disabled = false; go.textContent = signup ? 'إنشاء الحساب' : 'دخول'; }
    };
    go.onclick = submit; a.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  }
  async function enterApp() {
    $('#auth').classList.add('hidden'); $('#auth').innerHTML = '';
    document.querySelector('.topbar').classList.remove('hidden'); $('#home').classList.remove('hidden'); $('#quizView').classList.add('hidden'); state.tab = 'home'; setNav('homeTab'); document.querySelector('.bottom-nav').classList.remove('hidden');
    state.token = state.session.access_token; state.admin = false;
    try { const rows = await api(`/rest/v1/lecture_admins?select=user_id&user_id=eq.${encodeURIComponent(state.session.user.id)}`); state.admin = rows.length > 0; } catch {}
    $('#adminOpen').classList.toggle('hidden', !state.admin); $('#bellOpen').classList.remove('hidden');
    window.scrollTo(0, 0); loadNotices(); await load(); loadDone(); loadEssays();
    if (state.fresh) { state.fresh = false; themePrompt(); }
  }
  function themePrompt() {
    open(`<h2>اختر شكل التطبيق</h2><p class="hint">يمكنك تغييره في أي وقت من «حسابي».</p><div class="theme-pick"><button data-t="light"><i class="sw light">✦</i><b>☀ فاتح</b></button><button data-t="dark"><i class="sw dark">✦</i><b>☾ غامق</b></button></div>`);
    body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { applyTheme(b.dataset.t); close(); });
  }
  async function logout() { try { await api('/auth/v1/logout', { method: 'POST' }); } catch {} clearSession(); state.lessons = []; showAuth('login'); }
  const getStats = () => { let t = 0, c = 0, q = 0; state.lessons.forEach(x => { const f = lecFinal(x); if (f) { q++; t += f.of; c += f.got; } }); return { quizzes: q, total: t, correct: c }; };
  function saveStats() {}
  function mergeUser(nu) { state.session.user = { ...state.session.user, ...nu }; localStorage.setItem('session', JSON.stringify(state.session)); }
  async function toAvatarBlob(file) {
    const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
    c.width = c.height = 256; c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('تعذّر معالجة الصورة.')), 'image/jpeg', 0.85));
  }
  async function setAvatar(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('اختر ملف صورة.'); return; }
    toast('جارٍ رفع الصورة...');
    try {
      const blob = await toAvatarBlob(file);
      if (state.session?.expires_at && state.session.expires_at * 1000 < Date.now() + 60000) await refreshSession();
      const path = `${state.session.user.id}/avatar.jpg`;
      const up = await fetch(`${url}/storage/v1/object/avatars/${path}`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
      if (!up.ok) throw new Error('تعذّر رفع الصورة. حاول مرة أخرى.');
      const nu = await api('/auth/v1/user', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { avatar_url: `${url}/storage/v1/object/public/avatars/${path}?v=${Date.now()}` } }) });
      mergeUser(nu); toast('تم تحديث الصورة.'); showAccount();
    } catch (e) { toast(e.message); }
  }
  async function removeAvatar() {
    try {
      await fetch(`${url}/storage/v1/object/avatars/${state.session.user.id}/avatar.jpg`, { method: 'DELETE', headers: headers() });
      const nu = await api('/auth/v1/user', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { avatar_url: null } }) });
      const um = { ...(nu.user_metadata || {}) }; delete um.avatar_url; mergeUser({ ...nu, user_metadata: um }); toast('تم حذف الصورة.'); showAccount();
    } catch (e) { toast(e.message); }
  }
  function showAccount() {
    const u = state.session?.user; if (!u) { showAuth(); return; }
    const name = u.user_metadata?.full_name || '', avatar = u.user_metadata?.avatar_url || '', st = getStats(), pct = st.total ? Math.round(st.correct / st.total * 100) : 0;
    const d = v => v ? new Date(v).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    open(`<h2>حسابي</h2><div class="avatar-wrap"><div class="avatar">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc((name || (isPhoneEmail(u.email) ? '' : u.email) || '؟').trim().charAt(0).toUpperCase())}</div><button class="cam" id="pickAvatar" aria-label="تغيير الصورة"><svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button><input id="avatarFile" type="file" accept="image/*" hidden></div>${avatar ? '<button class="link-btn" id="rmAvatar">حذف الصورة</button>' : ''}<p class="acc-name">${esc(name || 'بدون اسم')}</p><span class="role-pill ${state.admin ? '' : 'student'}">${state.admin ? 'مشرف' : 'طالب'}</span><div class="info-row"><span>${isPhoneEmail(u.email) ? 'رقم الهاتف' : 'البريد الإلكتروني'}</span><b dir="ltr">${esc(isPhoneEmail(u.email) ? (u.user_metadata?.phone || '+' + u.email.split('@')[0]) : (u.email || '—'))}</b></div><div class="info-row"><span>تاريخ الانضمام</span><b>${d(u.created_at)}</b></div><div class="info-row"><span>معرّف الحساب</span><b style="font-size:10px">${esc(String(u.id).slice(0, 8))}…</b></div><div class="stats"><div class="stat"><b>${st.quizzes || 0}</b><span>اختبارات</span></div><div class="stat"><b>${st.correct || 0}</b><span>إجابات صحيحة</span></div><div class="stat"><b>${pct}٪</b><span>نسبة النجاح</span></div></div><div class="field"><label>المظهر</label><div class="seg" id="themeSeg"><button data-theme="auto">تلقائي</button><button data-theme="light">فاتح</button><button data-theme="dark">داكن</button></div></div><div class="field"><label>تعديل الاسم</label><input id="newName" maxlength="60" value="${esc(name)}"></div><button class="secondary full" id="saveName">حفظ الاسم</button>${state.admin ? '<button class="primary full" id="goAdmin">لوحة إدارة المحاضرات</button>' : ''}<button class="secondary full danger" id="accLogout">تسجيل الخروج</button>`);
    $('#accLogout').onclick = logout;
    $('#pickAvatar').onclick = () => $('#avatarFile').click();
    $('#avatarFile').onchange = e => setAvatar(e.target.files[0]);
    if (avatar) $('#rmAvatar').onclick = removeAvatar;
    const seg = $('#themeSeg'), cur = getTheme();
    seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.theme === cur); b.onclick = () => { applyTheme(b.dataset.theme); seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }; });
    if (state.admin) $('#goAdmin').onclick = showAdmin;
    $('#saveName').onclick = async () => { const v = $('#newName').value.trim(); if (!v) { toast('اكتب الاسم.'); return; } try { const nu = await api('/auth/v1/user', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { full_name: v } }) }); state.session.user = { ...state.session.user, ...nu }; localStorage.setItem('session', JSON.stringify(state.session)); toast('تم حفظ الاسم.'); showAccount(); } catch (e) { toast(e.message); } };
  }
  // ---------- جملة اليوم: تتغيّر في كل مرة يُفتح فيها التطبيق ----------
  const QUOTES = [
    "اللغة العربية هي لغة القرآن وهوية الأمة.",
    "تعلّم العربية فإنها تزيد في العقل وتثبّت المروءة.",
    "الضاد حرفٌ تنفرد به العربية، ولهذا سُمّيت لغة الضاد.",
    "من أتقن لغته أتقن التعبير عن نفسه.",
    "النحو في الكلام كالملح في الطعام.",
    "القراءة كل يوم تبني لسانًا فصيحًا.",
    "كل كلمة جديدة تتعلمها تفتح لك بابًا من المعرفة.",
    "اللغة العربية بحر واسع، وكل يوم نغرف منه قطرة.",
    "ابدأ بخطوة صغيرة كل يوم، وستتقن العربية بإذن الله.",
    "الفصاحة تُكتسب بالممارسة والاستماع والقراءة.",
    "العربية ليست مادة تُدرس فقط، بل هوية تُعاش.",
    "بالضاد نتكلم، وبالعلم نرتقي."
  ];
  function showQuote() {
    let i;
    try { const last = parseInt(localStorage.getItem('quoteIdx'), 10); i = Number.isInteger(last) ? (last + 1) % QUOTES.length : Math.floor(Math.random() * QUOTES.length); localStorage.setItem('quoteIdx', String(i)); }
    catch { i = Math.floor(Math.random() * QUOTES.length); }
    const el = $('#quoteText'); el.textContent = QUOTES[i]; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  }
  $('#quote').onclick = showQuote;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 20000) { hiddenAt = 0; showQuote(); } });
  showQuote();
  async function boot() {
    if (!url || !anon) { showAuth(); $('#aErr').textContent = 'أضف بيانات Supabase في ملف config.js أولًا.'; return; }
    if (!state.session?.access_token) { showAuth(); return; }
    state.token = state.session.access_token;
    if (state.session.expires_at && state.session.expires_at * 1000 < Date.now() + 60000) await refreshSession();
    try { const u = await api('/auth/v1/user'); state.session.user = { ...state.session.user, ...u }; await enterApp(); }
    catch (e) {
      if (/اتصال|الإنترنت/.test(e.message)) { await enterApp(); return; }
      const gone = /does not exist|user_not_found|user not found|sub claim/i.test(e.message);
      clearSession();
      showAuth('login', gone ? 'تم حذف هذا الحساب أو حدثت مشكلة فيه. سجّل الدخول ببيانات أخرى أو أنشئ حسابًا جديدًا، وإن كنت تظن أن هذا خطأ فتواصل مع المشرف.' : 'انتهت جلستك أو حدثت مشكلة في حسابك. سجّل الدخول مرة أخرى.', true);
    }
  }
  boot();
})();
