const bizName = document.getElementById('bizName');
const rewardInput = document.getElementById('reward');
const passName = document.getElementById('passName');
const passReward = document.getElementById('passReward');
const passMark = document.getElementById('passMark');
const passCard = document.getElementById('passCard');
const stampsGrid = document.getElementById('stampsGrid');
const passCount = document.getElementById('passCount');
const addStampBtn = document.getElementById('addStampBtn');

const TOTAL_STAMPS = 10;
let filled = 6;
let stampColor = '#49d6c4';

function renderStamps(){
  stampsGrid.innerHTML = '';
  for(let i=0; i<TOTAL_STAMPS; i++){
    const el = document.createElement('div');
    el.className = 'stamp' + (i < filled ? ' filled' : '');
    el.style.setProperty('--stamp-color', stampColor);
    el.textContent = i < filled ? '★' : '';
    stampsGrid.appendChild(el);
  }
  passCount.textContent = filled + ' / ' + TOTAL_STAMPS;
}

function syncText(){
  const name = bizName.value.trim() || 'קפה הפינה';
  passName.textContent = name;
  passMark.textContent = name.charAt(0);
  passReward.textContent = rewardInput.value.trim() || '10 קפים = קפה מתנה';
}

bizName.addEventListener('input', syncText);
rewardInput.addEventListener('input', syncText);

document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
    sw.classList.add('active');
    sw.setAttribute('aria-pressed', 'true');
    passCard.style.setProperty('--pass-c1', sw.dataset.c1);
    passCard.style.setProperty('--pass-c2', sw.dataset.c2);
    passCard.style.setProperty('--stamp-color', sw.dataset.stamp);
    stampColor = sw.dataset.stamp;
    renderStamps();
  });
});

const bgPhoto = document.getElementById('bgPhoto');
const passScrim = document.getElementById('passScrim');
const stampsGridEl = document.getElementById('stampsGrid');
const creditBar = document.getElementById('creditBar');
const modeStampsBtn = document.getElementById('modeStampsBtn');
const modeCreditBtn = document.getElementById('modeCreditBtn');
let rewardMode = 'stamps';

bgPhoto.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    passCard.style.backgroundImage = `url(${ev.target.result})`;
    passCard.classList.add('has-photo');
    passScrim.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

function setMode(mode){
  rewardMode = mode;
  modeStampsBtn.classList.toggle('active', mode === 'stamps');
  modeCreditBtn.classList.toggle('active', mode === 'credit');
  modeStampsBtn.setAttribute('aria-pressed', String(mode === 'stamps'));
  modeCreditBtn.setAttribute('aria-pressed', String(mode === 'credit'));
  stampsGridEl.style.display = mode === 'stamps' ? 'grid' : 'none';
  creditBar.classList.toggle('show', mode === 'credit');
  passReward.textContent = mode === 'stamps'
    ? (rewardInput.value.trim() || '10 קפים = קפה מתנה')
    : 'כל ₪1 שווה נקודה = קרדיט לרכישה הבאה';
  document.getElementById('modeHint').textContent = mode === 'stamps'
    ? '☕ מתאים לבתי קפה — "קפה עשירי חינם"'
    : '🍽 מתאים למסעדות — נקודות שהופכות לקרדיט בשקלים';
}
modeStampsBtn.addEventListener('click', () => setMode('stamps'));
modeCreditBtn.addEventListener('click', () => setMode('credit'));

const toast = document.getElementById('toast');
const toastName = document.getElementById('toastName');
let toastTimer = null;

addStampBtn.addEventListener('click', () => {
  filled = filled >= TOTAL_STAMPS ? 1 : filled + 1;
  renderStamps();
  toastName.textContent = bizName.value.trim() || 'קפה הפינה';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
});

renderStamps();
syncText();

document.querySelectorAll('.why-card, .how-item, .vert-card, .testi-card, .price-card, .cta-block').forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('in'); });
}, {threshold:0.15});
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// subtle 3D tilt on the wallet pass mockup, following the cursor — desktop only,
// disabled under reduced-motion since it's a continuous transform effect
const passStage = document.querySelector('.pass-stage');
const phoneEl = document.querySelector('.phone');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (passStage && phoneEl && !prefersReducedMotion && window.matchMedia('(hover: hover)').matches) {
  passStage.addEventListener('mousemove', (e) => {
    const rect = passStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    phoneEl.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateZ(10px)`;
  });
  passStage.addEventListener('mouseleave', () => {
    phoneEl.style.transform = '';
  });
}

// ===== COMMENTS (Supabase) =====
const SUPABASE_URL = 'https://swtdgghjpcvyhrdwggae.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3dGRnZ2hqcGN2eWhyZHdnZ2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTEzMDgsImV4cCI6MjA5OTc2NzMwOH0.7vB2oEtLtpr3fLdKDLpbpQt3DsidJIgG06MhZih6luM';

const commentsList = document.getElementById('commentsList');
const cName = document.getElementById('cName');
const cBiz = document.getElementById('cBiz');
const cText = document.getElementById('cText');
const cSubmit = document.getElementById('cSubmit');
const cStatus = document.getElementById('cStatus');

let sb = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderComments(rows){
  if(!rows || rows.length === 0){
    commentsList.innerHTML = '<div class="comments-empty">עדיין אין תגובות — היו הראשונים לכתוב אחת.</div>';
    return;
  }
  commentsList.innerHTML = rows.map(r => `
    <div class="comment-item">
      <div class="comment-head">
        <span class="comment-name">${escapeHtml(r.name)}</span>
        <span class="comment-biz">${escapeHtml(r.business || '')}</span>
      </div>
      <div class="comment-text">${escapeHtml(r.text)}</div>
    </div>
  `).join('');
}

async function loadComments(){
  if(!sb){
    commentsList.innerHTML = '<div class="comments-empty">חברו את הפרויקט ל-Supabase (ראו README) כדי להציג ולקבל תגובות אמיתיות.</div>';
    return;
  }
  const { data, error } = await sb.from('comments').select('*').eq('approved', true).order('created_at', {ascending:false}).limit(50);
  if(error){ commentsList.innerHTML = '<div class="comments-empty">שגיאה בטעינת תגובות.</div>'; return; }
  renderComments(data);
}

cSubmit.addEventListener('click', async () => {
  const name = cName.value.trim();
  const text = cText.value.trim();
  if(!name || !text){
    cStatus.textContent = 'נא למלא שם ותגובה.';
    return;
  }
  if(!sb){
    cStatus.textContent = 'החיבור למסד הנתונים עוד לא הוגדר (ראו README).';
    return;
  }
  cSubmit.disabled = true;
  const { error } = await sb.from('comments').insert({
    name, business: cBiz.value.trim(), text, approved: false
  });
  cSubmit.disabled = false;
  if(error){
    cStatus.textContent = 'שגיאה בשליחה, נסו שוב.';
    return;
  }
  cName.value = ''; cBiz.value = ''; cText.value = '';
  cStatus.textContent = 'תודה! התגובה תופיע לאחר אישור קצר.';
});

loadComments();

// ===== WAITLIST =====
const waitlistForm = document.getElementById('waitlistForm');
const waitlistEmail = document.getElementById('waitlistEmail');
const formMsg = document.getElementById('formMsg');

waitlistForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!sb){
    formMsg.textContent = 'החיבור למסד הנתונים עוד לא הוגדר (ראו README).';
    return;
  }
  const submitBtn = waitlistForm.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  const { error } = await sb.functions.invoke('waitlist-submit', {
    body: { email: waitlistEmail.value.trim() }
  });
  submitBtn.disabled = false;
  if(error){
    formMsg.textContent = 'שגיאה בהרשמה, נסו שוב.';
    return;
  }
  waitlistEmail.value = '';
  formMsg.textContent = 'תודה! נחזור אליכם בקרוב.';
});
