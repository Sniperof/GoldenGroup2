# 🚀 دليل الإعداد — Golden CRM

## الحالة الحالية

- ✅ **نظام الترحيلات**: 7 ملفات SQL جاهزة
- ✅ **بيئة التطوير**: منفصلة عن الإنتاج
- ✅ **الأمان**: SSH Tunnel بدلاً من فتح المنافذ
- ✅ **package.json**: مُحدّث مع أوامر dev صحيحة

---

## الخطوة 1️⃣: إعداد قاعدة البيانات على السيرفر

على السيرفر (تشغيل كـ root أو sudo):

```bash
sudo -u postgres bash scripts/setup-dev-db.sh
```

هذا يُنشئ:
- مستخدم PostgreSQL: `crm_dev_user`
- قاعدة بيانات: `golden_crm_dev`
- يطبّق جميع الترحيلات تلقائياً

---

## الخطوة 2️⃣: إعداد SSH Tunnel (بدون فتح المنافذ)

### على السيرفر: تحديث pg_hba.conf

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

**تأكد من وجود هذا السطر (localhost فقط):**
```
host    golden_crm_dev    crm_dev_user    127.0.0.1/32    scram-sha-256
```

ثم أعد التحميل:
```bash
sudo systemctl reload postgresql
```

### على جهاز المطور: فتح النفق

```bash
SERVER_IP=1.2.3.4 SSH_USER=ubuntu bash scripts/dev-tunnel.sh
```

هذا يفتح:
- **localhost:5433** ← يمرر إلى **السيرفر:5432**

---

## الخطوة 3️⃣: إعدادات المطور المحلية

### تعديل `.env.development` بقيمك الخاصة:

```bash
# قم بنسخ النموذج (إن لم يكن موجوداً):
cp .env.development .env.development

# ثم عدّل هذا السطر بكلمة المرور الصحيحة:
DATABASE_URL=postgresql://crm_dev_user:YOUR_PASSWORD@localhost:5433/golden_crm_dev
```

**ملاحظة:** البورت **5433** وليس 5432 (لأن الاتصال عبر SSH Tunnel)

---

## الخطوة 4️⃣: تشغيل المشروع

### Terminal 1️⃣ — فتح النفق:
```bash
SERVER_IP=1.2.3.4 SSH_USER=ubuntu bash scripts/dev-tunnel.sh
```

### Terminal 2️⃣ — تشغيل السيرفر والفرونتإند:
```bash
npm run dev
```

السكريبت يحمّل تلقائياً:
- `.env.development` (NODE_ENV=development)
- يبدأ السيرفر على http://localhost:3000
- يبدأ الفرونتإند على http://localhost:5173

---

## 🔒 تحذيرات أمنية

| ⚠️ | الخطر | الحل |
|----|------|------|
| كلمة المرور بالنص | `.env` موجود في Git history | **غيّر كلمة المرور في الإنتاج فوراً** |
| المنافذ مفتوحة | البورت 5432 يُفتح على الإنترنت | استخدم SSH Tunnel فقط |
| بيئات مختلطة | نفس المستخدم في التطوير والإنتاج | استخدم `crm_dev_user` للتطوير فقط |

---

## 📝 أوامر مفيدة

```bash
# تطبيق الترحيلات يدوياً (إن لزم):
npm run migrate

# حذف البيانات (تطوير فقط):
psql -h localhost -p 5433 -U crm_dev_user -d golden_crm_dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# التحقق من اتصال النفق:
psql -h localhost -p 5433 -U crm_dev_user -d golden_crm_dev
```

---

## ✅ قائمة التحقق

- [ ] قاعدة البيانات تم إعدادها على السيرفر
- [ ] pg_hba.conf تم تحديثه
- [ ] .env.development تم تعديله بكلمة المرور
- [ ] SSH Tunnel يعمل بدون أخطاء
- [ ] `npm run dev` يشتغل بدون مشاكل
- [ ] يمكنك الوصول إلى http://localhost:5173

---

## 🆘 استكشاف الأخطاء

### خطأ: "connection refused"
```
→ تحقق من أن SSH Tunnel مفتوح في terminal آخر
```

### خطأ: "password authentication failed"
```
→ تحقق من كلمة المرور في .env.development
→ تأكد أن المستخدم crm_dev_user موجود
```

### خطأ: "database does not exist"
```
→ شغّل: npm run migrate
→ أو: sudo -u postgres bash scripts/setup-dev-db.sh (على السيرفر)
```

---

**آخر تحديث:** 31 مارس 2026 | **الإصدار:** 1.0.0
