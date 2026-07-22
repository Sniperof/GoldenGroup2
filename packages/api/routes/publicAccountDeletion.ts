// ============================================================
// routes/publicAccountDeletion.ts
// ============================================================
// Phase 6b (DEC-013 §8) — public, unauthenticated account-deletion web page
// required by Google Play. Discoverable URL (does not require installing or
// signing into the app). Drives the same public API: OTP send/verify (purpose
// account_deletion) → POST /api/app/account/deletion-request.
// ============================================================

import { Router } from 'express';

const router = Router();

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>حذف حساب تطبيق الزبائن — Golden</title>
<style>
  :root { --ink:#1f1b14; --muted:#6b6252; --line:#e4dccb; --gold:#a9781f; --bg:#f6f3ec; --card:#fffdf8; --ok:#1f7a4d; --bad:#b04a4a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Segoe UI",Tahoma,sans-serif; line-height:1.7; }
  .wrap { max-width:560px; margin:0 auto; padding:2rem 1.2rem 3rem; }
  h1 { font-size:1.4rem; margin:.2rem 0 .3rem; }
  .sub { color:var(--muted); font-size:.9rem; margin-bottom:1.4rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:1.2rem; margin-bottom:1.2rem; }
  .card h2 { font-size:1rem; margin:.1rem 0 .6rem; color:var(--gold); }
  ul { margin:.3rem 0; padding-inline-start:1.2rem; font-size:.92rem; }
  label { display:block; font-size:.85rem; font-weight:600; margin:.6rem 0 .3rem; }
  input { width:100%; padding:.6rem .7rem; border:1px solid var(--line); border-radius:8px; font-size:1rem; font-family:inherit; }
  button { margin-top:.9rem; width:100%; padding:.7rem; border:none; border-radius:8px; background:var(--gold); color:#fff; font-size:1rem; font-weight:700; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  button.danger { background:var(--bad); }
  .hidden { display:none; }
  .msg { margin-top:.9rem; padding:.6rem .8rem; border-radius:8px; font-size:.9rem; }
  .msg.ok { background:#e6f4ec; color:var(--ok); }
  .msg.err { background:#f7e2df; color:var(--bad); }
  .step { color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>حذف حساب تطبيق الزبائن</h1>
    <div class="sub">يمكنك طلب حذف حسابك من هنا دون الحاجة لفتح التطبيق أو تسجيل الدخول.</div>

    <div class="card">
      <h2>ماذا سيُحذف وماذا يُحتفظ به</h2>
      <p style="margin:.2rem 0 .4rem">يُحذف <b>وصولك للتطبيق فقط</b> (حساب الدخول وكل الجلسات).</p>
      <ul>
        <li>يُحذف: حساب الدخول ورموز الجلسات.</li>
        <li>يُحتفظ به قانونياً/تجارياً: سجل الزبون وعقوده وأجهزته وسجلّه المالي.</li>
      </ul>
      <p class="step" style="margin-top:.5rem">يمكنك لاحقاً التسجيل من جديد بنفس الرقم.</p>
    </div>

    <div class="card">
      <h2>تأكيد الملكية عبر رمز التحقق</h2>

      <div id="s1">
        <label for="phone">رقم الموبايل الرئيسي</label>
        <input id="phone" inputmode="numeric" placeholder="09XXXXXXXX" autocomplete="off" />
        <button id="sendBtn">إرسال رمز التحقق</button>
      </div>

      <div id="s2" class="hidden">
        <div class="step">أُرسل رمز إلى رقمك. أدخله للمتابعة.</div>
        <label for="code">رمز التحقق</label>
        <input id="code" inputmode="numeric" placeholder="------" autocomplete="off" />
        <button id="verifyBtn">تحقّق</button>
      </div>

      <div id="s3" class="hidden">
        <div class="step">تم التحقق. اضغط لتأكيد حذف الحساب نهائياً.</div>
        <button id="deleteBtn" class="danger">تأكيد حذف الحساب</button>
      </div>

      <div id="msg" class="msg hidden"></div>
    </div>
  </div>

<script>
(function () {
  var phone = document.getElementById('phone');
  var code = document.getElementById('code');
  var s1 = document.getElementById('s1'), s2 = document.getElementById('s2'), s3 = document.getElementById('s3');
  var sendBtn = document.getElementById('sendBtn'), verifyBtn = document.getElementById('verifyBtn'), deleteBtn = document.getElementById('deleteBtn');
  var msg = document.getElementById('msg');
  var handle = null;

  function show(type, text) { msg.className = 'msg ' + type; msg.textContent = text; msg.classList.remove('hidden'); }
  function clearMsg() { msg.classList.add('hidden'); }
  async function post(url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: data };
  }

  sendBtn.onclick = async function () {
    clearMsg(); sendBtn.disabled = true;
    var res = await post('/api/app/otp/send', { phone: phone.value.trim(), purpose: 'account_deletion' });
    sendBtn.disabled = false;
    if (!res.ok) return show('err', res.data.error || 'تعذّر إرسال الرمز');
    s1.classList.add('hidden'); s2.classList.remove('hidden');
  };

  verifyBtn.onclick = async function () {
    clearMsg(); verifyBtn.disabled = true;
    var res = await post('/api/app/otp/verify', { phone: phone.value.trim(), code: code.value.trim(), purpose: 'account_deletion' });
    verifyBtn.disabled = false;
    if (!res.ok) return show('err', res.data.error || 'رمز غير صحيح');
    handle = res.data.handle;
    s2.classList.add('hidden'); s3.classList.remove('hidden');
  };

  deleteBtn.onclick = async function () {
    clearMsg(); deleteBtn.disabled = true;
    var res = await post('/api/app/account/deletion-request', { phone: phone.value.trim(), handle: handle });
    if (!res.ok) { deleteBtn.disabled = false; return show('err', res.data.error || 'تعذّر حذف الحساب'); }
    s3.classList.add('hidden');
    show('ok', 'تم حذف حسابك بنجاح. يمكنك التسجيل من جديد لاحقاً بنفس الرقم.');
  };
})();
</script>
</body>
</html>`;

router.get('/', (_req, res) => {
  res.type('html').send(PAGE);
});

export default router;
