const FUNCTIONS_BASE = 'https://swtdgghjpcvyhrdwggae.functions.supabase.co';
const params = new URLSearchParams(window.location.search);
const slug = params.get('slug');
const app = document.getElementById('app');

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

function renderError(message) {
  app.innerHTML = `<h1>אופס</h1><p>${message}</p>`;
}

function renderConsent(brandName) {
  const platform = detectPlatform();
  const enrollUrl = `${FUNCTIONS_BASE}/enroll?slug=${encodeURIComponent(slug)}&confirm=1&platform=${platform}`;

  if (platform === 'other') {
    const qrTarget = `${FUNCTIONS_BASE}/enroll?slug=${encodeURIComponent(slug)}`;
    app.innerHTML = `
      <h1>${brandName}</h1>
      <p>סרקו את הקוד הזה מהטלפון כדי להוסיף את הכרטיס לארנק הדיגיטלי.</p>
      <div class="qr-fallback">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrTarget)}" width="240" height="240" alt="QR code">
      </div>`;
    return;
  }

  app.innerHTML = `
    <h1>${brandName}</h1>
    <p>אנחנו נשמור את השם שלכם, מספר טלפון/אימייל (אם תמסרו), מונה התווים שלכם, ומועדי הביקור — כדי להפעיל את כרטיס הנאמנות ולזהות אתכם בעסק. פרטים מלאים ב<a href="/privacy.html" target="_blank">מדיניות הפרטיות</a>.</p>
    <label for="nameInput" style="display:block; font-size:14px; margin-bottom:6px; cursor:default;">שם מלא</label>
    <input type="text" id="nameInput" placeholder="ישראל ישראלי" style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--ink); color:var(--paper); font-size:15px; margin-bottom:16px; box-sizing:border-box;">
    <label for="phoneInput" style="display:block; font-size:14px; margin-bottom:6px; cursor:default;">טלפון (לא חובה)</label>
    <input type="tel" id="phoneInput" placeholder="050-0000000" style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--ink); color:var(--paper); font-size:15px; margin-bottom:20px; box-sizing:border-box;">
    <label>
      <input type="checkbox" id="acceptTerms">
      <span>קראתי ואני מסכימ/ה ל<a href="/terms.html" target="_blank">תנאי השימוש</a> ול<a href="/privacy.html" target="_blank">מדיניות הפרטיות</a></span>
    </label>
    <label>
      <input type="checkbox" id="promo">
      <span>אני מעוניין/ת לקבל מ-${brandName} עדכונים על מבצעים והטבות (ניתן להסיר בכל עת מגב הכרטיס)</span>
    </label>
    <button id="submitBtn" disabled>הוסיפו לארנק הדיגיטלי</button>
  `;

  const nameInput = document.getElementById('nameInput');
  const acceptTerms = document.getElementById('acceptTerms');
  const submitBtn = document.getElementById('submitBtn');
  const updateSubmitState = () => {
    submitBtn.disabled = !acceptTerms.checked || !nameInput.value.trim();
  };
  acceptTerms.addEventListener('change', updateSubmitState);
  nameInput.addEventListener('input', updateSubmitState);

  submitBtn.addEventListener('click', () => {
    if (submitBtn.disabled) return;
    const promo = document.getElementById('promo').checked ? '1' : '0';
    const name = encodeURIComponent(nameInput.value.trim());
    const phone = encodeURIComponent(document.getElementById('phoneInput').value.trim());
    window.location.href = `${enrollUrl}&promo=${promo}&name=${name}&phone=${phone}`;
  });
}

if (!slug) {
  renderError('קישור לא תקין — חסר מזהה עסק.');
} else {
  fetch(`${FUNCTIONS_BASE}/enroll-info?slug=${encodeURIComponent(slug)}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.error || !data.hasActiveCard) {
        renderError('העסק הזה לא נמצא או שאין לו כרטיס פעיל כרגע.');
        return;
      }
      renderConsent(data.brandName);
    })
    .catch(() => renderError('שגיאה בטעינת הנתונים. נסו שוב.'));
}
