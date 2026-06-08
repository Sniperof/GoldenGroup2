# ذاكرة البيئة — Environment Memory

> **حقائق ثابتة عن السيرفر، الـ DB، الـ Git، والـ PM2.**

---

## 🛠️ السيرفرات

| البيئة | القيمة |
|---------|--------|
| **Staging** | `golden_crm_staging` on localhost:5432 |
| **Production** | `golden_crm` on localhost:5432 — ❌ NEVER TOUCH |
| **المسار** | `postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging` |
| **الـ PM2 staging** | `golden-crm-staging` — port 3001 |
| **الـ PM2 production** | `golden-crm` — port 3000 — ❌ NEVER TOUCH |

---

## 📁 المسارات

| المسار | الوصف |
|------|--------|
| `main` | الإنتاج — مرتبط بـ `golden-crm` (port 3000) |
| `staging` | التطوير — مرتبط بـ `golden-crm-staging` (port 3001) |
| **القاعدة** | دايماً اشتغل على `staging` |

---

## 🚀 الأوامر الشائعة

```bash
# إعادة تشغيل الـ staging
pm2 restart golden-crm-staging

# مشاهدة الـ logs
pm2 logs golden-crm-staging

# الـ TypeScript check
pnpm --filter @golden-crm/api exec tsc --noEmit

# تشغيل الـ dev server
pnpm --filter @golden-crm/api dev
```

---

## 🎭 الـ Stack

| الطبقة | التكنولوجيا |
|--------|------------|
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + Tailwind CSS |
| DB | PostgreSQL |
| PM | pnpm monorepo |
| المسارات | SQL files numbered 001→┋ (migrations/) |

---

## 📑 مسارات الملفات الرئيسية

| المسار | الوصف |
|------|--------|
| `/opt/golden-crm/apps/staging` | التطوير (العمل دايماً هون) |
| `/opt/golden-crm/app/GoldenGroup2` | الإنتاج — ❌ NEVER TOUCH |
| `/root/docs/constitution/` | الدستور الكامل (النسخة الجديدة) |
| `/root/docs/constitution/hermes/` | هي ملفات ذاكرة Hermes |

---

## 🤝 اتفاقية العمل

1. **Hermes = planner/analyst** — لا ينفّذ كود
2. **الـ Prompts** تبعث لـ Claude/Codex يدوياً — أبراهيم بيحدد الأداة
3. **Git commit قبل كل prompt**
4. **staging قبل production** — دايماً
5. **لغة واحدة للمستند** — عربي أو إنجليزي

---

## 🎯 الأولويات الحالية (موجزة من MASTER.md)

1. `location_basis` drift (`contract` → `device`) — الأكبر
2. Mini ClientSnapshot موحد — 4 أماكن
3. Name Collections + Referral Sheets — `client_snapshot` JSONB
