# Hermes Memory — Master Index

> **أول ملف بقراه بكل جلسة جديدة.**
> بيختصر 148 ملف دستور بـ 50 سطر.

---

## 🎯 أولويات هذا الأسبوع (Active Fronts)

| # | الموضوع | القرار | الحالة |
|---|---------|--------|--------|
| 1 | `location_basis` drift (`contract` → `device`) | DEC-005 D27 | 🔴 كود بيقرأ `installed_devices` عبر `customer_id` مش عبر `device_id` |
| 2 | `work_location_geo_unit_id` not used as grain | DEC-005 D27 | 🔴 `syncAssignedTasks` لسه ما بيستخدم `work_location_geo_unit_id` |
| 3 | Mini ClientSnapshot موحد | INDEX pending tasks | ⏳ 4 أماكن لسه flat fields |
| 4 | Name Collections + Referral Sheets | INDEX pending tasks | ⏳ `client_snapshot` JSONB |

---

## 📁 نقاط الدخول السريعة

| بدّك... | روح ع... | الحجم |
|---------|---------|-------|
| فهم كيان كامل | `domains/{entity}.md` | 300-700 سطر |
| شو الـ drift بين الدستور والكود | `hermes/GAPS_QUICKREF.md` | 15 gap |
| قرار معماري ولماذا | `hermes/DECISION_LOG.md` | 7 قرار |
| وين function بالكود | `hermes/CODE_MAP.md` | 20 ملف |
| حقول DB باختصار | `hermes/ENTITY_CHEAT_SHEET.md` | 22 كيان |
| بيئة السيرفر | `hermes/MEMORY.md` | — |

---

## 🧠 قواعد ذاكرة Hermes (يُحدّث عند تغيير جوهري)

1. **Hermes = مخطط فقط.** لا ينفّذ كود. يكتب prompts دقيقة.
2. **الكود هو الحقيقة.** الدستور تفسير — إذا في تناقض، الكود يفوز.
3. **Commit قبل كل prompt.** أبراهيم بده `git commit` قبل ما يبعت لـ Codex/Claude.
4. **لا رجوع صامت.** أي fallback لازم يكون explicit + logged + surfaced بالـ UI.
5. **سكّر باب قبل ما تفتح باب.** ما تبدأ صيانة إذا الدستور ناقص.

---

## 🗣️ التواصل

- **اللهجة:** سورية
- **اللغة:** عربي للشرح، إنجليزي للحقول والكود
- **لا خلط:** مستند واحد = لغة واحدة
- **التنبيه:** تدقيق لغوي قبل الإرسال (لا صيني/روسي)

---

## 📅 آخر تحديث

2026-06-05 — بعد تحليل `location_basis` drift (`contract` vs `device`)
