# تشغيل Golden CRM من الصفر (بيئة التطوير)

> آخر تحقق: 2026-10-04 على Windows 11 + PostgreSQL 18 + pnpm 10.32.1.
> سلسلة قاعدة البيانات كاملة (إنشاء قاعدة فارغة ← تطبيق 266 ملف migration تشمل إصلاح النصوص العربية ← إنشاء المدير ← تشغيل الـ API ← تسجيل الدخول) جُرّبت فعلياً على قاعدة جديدة فارغة ونجحت.

هذا الدليل يأخذك من جهاز لا يحتوي شيئاً حتى تشغيل الباك اند والفرونت اند وقاعدة البيانات وتسجيل الدخول. الأوامر مكتوبة لـ **PowerShell** على Windows (لا تستخدم `&&` في PowerShell 5.1، نفّذ كل أمر لوحده). كل أمر يُنفَّذ من **جذر المشروع** ما لم يُذكر غير ذلك.

---

## الصورة العامة

| المكوّن | التقنية | المنفذ المحلي | المجلد |
|---|---|---|---|
| الباك اند (API) | Node.js + Express + TypeScript (يُشغَّل عبر `tsx`) | `3000` | `packages/api` |
| الفرونت اند | React + Vite + Tailwind | `5000` | `packages/web` |
| أنواع وقواعد مشتركة | TypeScript | — | `packages/shared` |
| قاعدة البيانات | PostgreSQL | `5432` | ملفات الـ schema في `migrations/` |

في وضع التطوير، Vite على المنفذ `5000` يحوّل تلقائياً كل طلبات `/api` و`/trpc` و`/uploads` و`/m` إلى الباك اند على `3000` (الإعداد في `packages/web/vite.config.ts`). لذلك تفتح المتصفح دائماً على `http://localhost:5000`.

> ملاحظة: ملف `CLAUDE.md` يذكر المنفذ `3001` وPM2 — هذا خاص بسيرفر الـ staging، وليس بالتشغيل المحلي.

---

## الخطوة 1 — تثبيت الأدوات الأساسية

| الأداة | الإصدار المطلوب | لماذا هذا الإصدار بالذات |
|---|---|---|
| **Node.js** | **22 LTS** (المحدد في `.nvmrc`؛ الحد الأدنى في `package.json` هو 22) | هذا ما يستخدمه الـ CI والإنتاج |
| **pnpm** | **10.32.1** (المحدد في `packageManager`) | المشروع monorepo بـ workspaces، و`.npmrc` يمنع npm/yarn |
| **PostgreSQL** | **17 أو أحدث، والموصى به 18** | ملف الأساس `001_initial_schema.sql` مأخوذ من PostgreSQL 18.4 ويستخدم `SET transaction_timeout` غير الموجود قبل الإصدار 17؛ على 16 أو أقدم يفشل أول migration |
| **Git** | أي إصدار حديث | لجلب الكود |

### Node.js
حمّل نسخة **22 LTS** من الموقع الرسمي nodejs.org وثبّتها (الإعدادات الافتراضية كافية). إن كان عندك أكثر من مشروع، استخدم `nvm-windows` ثم:

```powershell
nvm install 22
nvm use 22
```

### pnpm
بعد تثبيت Node:

```powershell
npm install -g pnpm@10.32.1
```

إن ظهر خطأ «running scripts is disabled on this system» عند تشغيل `pnpm` في PowerShell، نفّذ مرة واحدة ثم أعد فتح الطرفية:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### PostgreSQL (فقط إن كانت قاعدة البيانات على جهازك)

تخطَّ هذا القسم إن كنت ستتصل بقاعدة بعيدة (الخطوة 4-ب). وإن كان عندك PostgreSQL مثبتاً مسبقاً، تأكد أن إصداره 17 أو أحدث بالأمر `psql --version`؛ إن كان أقدم فثبّت 18 بجانبه (سيأخذ منفذاً آخر مثل `5433`) أو احذف القديم.

الإضافتان اللتان يحتاجهما المشروع (`pg_trgm` و`btree_gist`) تأتيان ضمن التثبيت العادي في كل الطرق التالية، ولا تحتاج تثبيتهما يدوياً؛ الـ migrations تنشئهما بنفسها.

#### على Windows (الطريقة الموصى بها: المثبّت الرسمي)

**أولاً — التحميل.** أمامك طريقان، اختر واحداً:

الطريق الأول من المتصفح: افتح `https://www.postgresql.org/download/windows/` ثم اضغط **Download the installer** (ينقلك لموقع EDB)، واختر نسخة **18.x** لـ **Windows x86-64**.

الطريق الثاني من PowerShell عبر winget (يفتح نفس المثبّت بواجهته العادية):

```powershell
winget install --id PostgreSQL.PostgreSQL.18 -e --interactive
```

**ثانياً — خطوات المثبّت.** شغّل الملف المحمَّل (سيطلب صلاحية المدير، وافق)، ثم تابع الشاشات بهذا الترتيب:

| الشاشة | ماذا تختار |
|---|---|
| Installation Directory | اترك الافتراضي `C:\Program Files\PostgreSQL\18` |
| Select Components | ✅ PostgreSQL Server — ✅ **Command Line Tools** (إلزامي، فيه `psql`) — ✅ pgAdmin 4 (اختياري: واجهة رسومية لتصفح القاعدة) — ⬜ Stack Builder (غير مطلوب، أزل علامته) |
| Data Directory | اترك الافتراضي `C:\Program Files\PostgreSQL\18\data` |
| Password | كلمة مرور المستخدم الرئيسي `postgres`. **احفظها**، ستحتاجها في ملف البيئة. يُفضَّل ألا تحتوي `@` `#` `/` `:` `%` حتى لا تحتاج ترميزاً داخل الرابط |
| Port | `5432`. إن اقترح المثبّت رقماً آخر (مثل `5433`) فهذا يعني أن نسخة أخرى تستخدم 5432؛ اقبل الرقم المقترح واستخدمه لاحقاً في `DATABASE_URL` |
| Advanced Options (Locale) | اترك `[Default locale]` |
| Pre Installation Summary ثم Ready to Install | اضغط Next ثم انتظر انتهاء التثبيت (دقيقة إلى ثلاث) |
| Completing the Setup | **أزل علامة** «Launch Stack Builder at exit» ثم Finish |

**ثالثاً — إضافة `psql` إلى الـ PATH بشكل دائم.** المثبّت لا يفعلها تلقائياً. نفّذ مرة واحدة في PowerShell (لا يحتاج صلاحية مدير):

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\PostgreSQL\18\bin", "User")
```

ثم **أغلق كل نوافذ الطرفية وافتحها من جديد**. (بديل يدوي: ابحث في قائمة ابدأ عن «Edit environment variables for your account»، اختر `Path` ثم Edit ثم New، وأضف `C:\Program Files\PostgreSQL\18\bin`.)

**رابعاً — التحقق.** تأكد أن الخدمة تعمل:

```powershell
Get-Service postgresql-x64-18
```

يجب أن يكون `Status` هو `Running`. الخدمة مضبوطة لتعمل تلقائياً مع تشغيل الجهاز. إن كانت متوقفة، شغّلها من PowerShell **كمسؤول** بالأمر `Start-Service postgresql-x64-18`، أو من `services.msc`.

ثم جرّب الاتصال (سيطلب كلمة المرور التي اخترتها):

```powershell
psql -U postgres -h localhost -c "SELECT version();"
```

يجب أن ترى سطراً يبدأ بـ `PostgreSQL 18`. وتأكد من توفر الإضافتين:

```powershell
psql -U postgres -h localhost -c "SELECT name FROM pg_available_extensions WHERE name IN ('pg_trgm','btree_gist');"
```

يجب أن يظهر سطران.

**اختياري — تجنّب كتابة كلمة المرور مع كل أمر** خلال جلسة الطرفية الحالية فقط:

```powershell
$env:PGPASSWORD = "كلمة_مرور_postgres"
```

#### على Ubuntu / Debian

الطريقة الرسمية عبر مستودع PostgreSQL (لأن مستودع التوزيعة قد يحتوي إصداراً أقدم من 17):

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-18
```

المستخدم `postgres` يُنشأ بدون كلمة مرور؛ اضبط له واحدة لأن المشروع يتصل عبر الشبكة المحلية:

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'كلمة_مرور_قوية';"
```

التحقق:

```bash
sudo systemctl status postgresql
psql -U postgres -h localhost -c "SELECT version();"
```

بقية الدليل مكتوب بصيغة PowerShell؛ على لينكس استبدل `$env:NAME = "value"` بـ `export NAME=value`، و`Copy-Item` بـ `cp`.

#### على macOS

عبر Homebrew:

```bash
brew install postgresql@18
brew services start postgresql@18
echo 'export PATH="$(brew --prefix postgresql@18)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Homebrew يجعل اسم مستخدم الماك هو المستخدم الرئيسي، بدون مستخدم `postgres`. لتعمل أوامر هذا الدليل كما هي، أنشئه مرة واحدة:

```bash
createuser -s postgres
psql -d postgres -c "ALTER USER postgres PASSWORD 'كلمة_مرور_قوية';"
```

(بديل أسهل بواجهة رسومية: تطبيق **Postgres.app** من `postgresapp.com`.)

#### بديل على أي نظام: Docker

إن كان Docker مثبتاً عندك، يمكنك تشغيل PostgreSQL 18 في حاوية بدل تثبيته (الإضافتان مضمّنتان في الصورة الرسمية):

```powershell
docker run -d --name golden-pg --restart unless-stopped -e POSTGRES_PASSWORD=كلمة_مرور_قوية -p 5432:5432 -v golden-pg-data:/var/lib/postgresql postgres:18
```

البيانات تُحفظ في الـ volume `golden-pg-data` ولا تضيع عند إيقاف الحاوية. للأوامر التي تحتاج `psql` بدون تثبيت أدوات سطر الأوامر على جهازك، استخدم `docker exec -it golden-pg psql -U postgres`.

### التحقق من الأدوات
أغلق الطرفية وافتحها من جديد، ثم:

```powershell
node -v
pnpm -v
psql --version
git --version
```

يجب أن ترى `v22.x` و`10.32.1` و`psql (PostgreSQL) 18.x`.

---

## الخطوة 2 — جلب الكود

```powershell
git clone <رابط-المستودع> GoldenGroup2
cd GoldenGroup2
git checkout dev
```

فرع العمل اليومي هو `dev`. لا تعمل مباشرة عليه: أنشئ فرعاً خاصاً بعملك (`git checkout -b feature/اسم-العمل`).

---

## الخطوة 3 — تثبيت المكتبات

```powershell
pnpm install --frozen-lockfile
```

هذا الأمر الواحد يثبّت مكتبات الحزم الثلاث (`api` و`web` و`shared`) دفعة واحدة، بالإصدارات المقفلة في `pnpm-lock.yaml` تماماً (نفس ما يستخدمه الـ CI). لا تثبّت أي مكتبة يدوياً.

### المكتبات الأساسية التي ستُثبَّت (للاطلاع)

| الطبقة | المكتبات الرئيسية |
|---|---|
| الباك اند | `express` 5، `pg` (اتصال PostgreSQL)، `@trpc/server`، `zod`، `jsonwebtoken`، `bcryptjs`، `multer` (رفع الملفات)، `sharp` (معالجة الصور)، `exceljs`، `swagger-ui-express`، `dotenv`، `tsx` |
| الفرونت اند | `react` 18، `react-router-dom` 7، `vite` 6، `tailwindcss` 4، `@trpc/client`، `zustand`، `leaflet` + `react-leaflet` (الخرائط)، `framer-motion`، `lucide-react`، `react-quill`، `sonner` |
| أدوات | `typescript` 5.9، `concurrently` (تشغيل الطرفين معاً)، `cross-env` |

`sharp` مكتبة native لكنها تنزل مبنية مسبقاً لـ Windows؛ لا تحتاج Visual Studio أو Python.

### تحقق
```powershell
pnpm ls --depth 0 -r
```
يجب أن تظهر الحزم الثلاث بدون أخطاء.

---

## الخطوة 4 — قاعدة البيانات: محلية أم بعيدة؟

| | قاعدة محلية على جهازك | قاعدة بعيدة على سيرفر |
|---|---|---|
| السرعة | سريعة جداً | أبطأ بشكل ملحوظ (كل استعلام يمر عبر الإنترنت) |
| الاستقلالية | بياناتك لك وحدك، تجرّب وتحذف بحرية | مشتركة مع غيرك؛ أي تعديل يراه الجميع |
| الـ migrations | تطبّقها أنت متى شئت | **لا تطبّقها** إلا بالاتفاق مع المسؤول عن السيرفر |
| متى تُستخدم | التطوير اليومي (**الموصى به**) | لمعاينة بيانات حقيقية/مشتركة أو عند عدم القدرة على تثبيت PostgreSQL |

> قاعدة ذهبية: لا توجّه بيئة التطوير أبداً إلى قاعدة **الإنتاج**. المستخدم المدير الافتراضي وكلمة سر JWT الافتراضية ومزوّد OTP المحاكي كلها غير آمنة على بيانات حقيقية.

### 4-أ — إنشاء قاعدة محلية (الموصى به)

افتح PowerShell جديدة (بعد إضافة `psql` إلى الـ PATH في الخطوة 1) واضبط ترميز psql، وهو ضروري لعرض العربي بشكل صحيح:

```powershell
$env:PGCLIENTENCODING = "UTF8"
```

أنشئ قاعدة البيانات (سيطلب كلمة مرور المستخدم `postgres`):

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE golden_crm_dev ENCODING 'UTF8' TEMPLATE template0;"
```

لا تضع `LC_COLLATE 'en_US.UTF-8'` كما في سكربت لينكس `scripts/setup-dev-db.sh`؛ هذا الاسم غير موجود على Windows وسيفشل الأمر.

**اختياري — مستخدم مخصص بدل `postgres`:** إن أردت مستخدماً بصلاحيات أقل، اجعله **مالك** القاعدة (ضروري، لأن الـ migrations تنشئ الإضافتين `pg_trgm` و`btree_gist`، ولا يُسمح بذلك إلا لمالك القاعدة أو superuser):

```powershell
psql -U postgres -h localhost -c "CREATE USER crm_dev_user WITH PASSWORD 'ضع_كلمة_مرور_قوية';"
psql -U postgres -h localhost -c "ALTER DATABASE golden_crm_dev OWNER TO crm_dev_user;"
psql -U postgres -h localhost -d golden_crm_dev -c "ALTER SCHEMA public OWNER TO crm_dev_user;"
```

تحقق من الاتصال:

```powershell
psql -U postgres -h localhost -d golden_crm_dev -c "SELECT version();"
```

### 4-ب — الاتصال بقاعدة بعيدة

يوجد طريقان:

**الطريق الأول — اتصال مباشر:** يعمل فقط إن كان السيرفر يسمح باتصال PostgreSQL من عنوانك (`listen_addresses` و`pg_hba.conf` والجدار الناري). الرابط يصبح:

```
postgresql://USER:PASSWORD@SERVER_IP:5432/golden_crm_dev
```

**الطريق الثاني — نفق SSH (الأكثر أماناً، والموصى به):** لا يحتاج فتح منفذ القاعدة على الإنترنت. Windows 11 يحتوي `ssh` مدمجاً. افتح طرفية **منفصلة** واتركها مفتوحة طوال العمل:

```powershell
ssh -N -L 5433:127.0.0.1:5432 -o ServerAliveInterval=60 USER@SERVER_IP
```

ما دامت هذه الطرفية مفتوحة، القاعدة البعيدة متاحة على جهازك على المنفذ `5433`، فيصبح الرابط:

```
postgresql://crm_dev_user:PASSWORD@localhost:5433/golden_crm_dev
```

(نفس الفكرة موجودة كسكربت bash في `scripts/dev-tunnel.sh` لمن يستخدم Git Bash أو لينكس.) إن كانت القاعدة البعيدة جديدة وفارغة، أنشئها على السيرفر بـ `sudo -u postgres bash scripts/setup-dev-db.sh` (سكربت لينكس يُنشئ المستخدم والقاعدة ويطبّق الـ migrations).

تحقق من الوصول:

```powershell
psql "postgresql://crm_dev_user:PASSWORD@localhost:5433/golden_crm_dev" -c "SELECT 1;"
```

> إن كانت كلمة المرور تحتوي رموزاً مثل `@` أو `#` أو `/` أو `:` فيجب ترميزها داخل الرابط (`@` تصبح `%40`، `#` تصبح `%23`، `/` تصبح `%2F`، `:` تصبح `%3A`).

---

## الخطوة 5 — ملف البيئة `.env.development`

الباك اند يقرأ ملف البيئة من **جذر المشروع** بهذا الترتيب (الكود في `packages/api/config/env.ts`):

| `NODE_ENV` | الملف الأساسي | الاحتياطي |
|---|---|---|
| `development` (الافتراضي إن لم يُحدَّد، وهو ما تضبطه أوامر `dev` و`migrate`) | `.env.development` | `.env` |
| `production` | `.env` | — |

متغيرات البيئة المضبوطة مسبقاً في الطرفية لها الأولوية على الملف.

أنشئ الملف `.env.development` في جذر المشروع بهذا المحتوى (عدّل الرابط حسب الخطوة 4):

```dotenv
# قاعدة محلية:
DATABASE_URL=postgresql://postgres:كلمة_مرور_postgres@localhost:5432/golden_crm_dev
# أو قاعدة بعيدة عبر نفق SSH:
# DATABASE_URL=postgresql://crm_dev_user:PASSWORD@localhost:5433/golden_crm_dev

NODE_ENV=development

# أي نص عشوائي طويل؛ إن تُرك فارغاً يُستخدم مفتاح تطوير ثابت (مقبول محلياً فقط)
JWT_SECRET=ضع_هنا_نصا_عشوائيا_طويلا

# OTP لتطبيق الزبائن: simulated لا يرسل SMS ويطبع الرمز في سجل الـ API
OTP_PROVIDER=simulated

# الإشعارات: noop يخزّن الإشعار بدون إرسال فعلي (لا يحتاج مفاتيح Firebase)
PUSH_PROVIDER=noop
```

لتوليد `JWT_SECRET` عشوائي من PowerShell:

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

### المتغيرات المهمة

| المتغير | إلزامي محلياً؟ | الافتراضي إن لم يُحدد | ملاحظة |
|---|---|---|---|
| `DATABASE_URL` | **نعم** | — | بدونه لا يتصل الباك اند بأي قاعدة |
| `JWT_SECRET` | لا | مفتاح تطوير ثابت | **إلزامي في الإنتاج**، والإقلاع يفشل بدونه |
| `PORT` | لا | `3000` | لا تغيّره محلياً؛ Vite يحوّل إلى 3000 تحديداً |
| `OTP_PROVIDER` | لا | `simulated` | القيم المقبولة `simulated` و`sms` فقط، وأي قيمة أخرى توقف الإقلاع |
| `PUSH_PROVIDER` | لا | `noop` | القيم المقبولة `noop` و`fcm` فقط |
| `UPLOADS_DIR` | لا | `<المشروع>/uploads` | — |
| `MEDIA_DIR` | لا | `<المشروع>/media` | — |
| `CORS_ORIGINS` | لا | مفتوح | يهم فقط في الإنتاج |
| `TRUST_PROXY` | لا | معطّل | يهم فقط خلف nginx |

القائمة الكاملة مع الشرح موجودة في `.env.example`. ملفات `.env*` مستثناة من git (عدا `.env.example`)؛ لا ترفع ملف بيئة أبداً.

---

## الخطوة 6 — بناء الجداول (Migrations)

```powershell
pnpm migrate
```

ما يفعله الأمر (`packages/api/migrate.ts`):

| المرحلة | التفاصيل |
|---|---|
| جدول التتبّع | ينشئ `schema_migrations` إن لم يكن موجوداً |
| القراءة | يقرأ كل ملفات `migrations/*.sql` بترتيب الاسم (حالياً 266 ملفاً: من `001_initial_schema.sql` حتى `473_...`) |
| التطبيق | يطبّق كل ملف لم يُطبَّق بعد داخل transaction؛ إن فشل ملف يتراجع عنه ويتوقف |
| التكرار | آمن للتشغيل أكثر من مرة: يتخطى ما طُبّق سابقاً |

على قاعدة فارغة يستغرق دقيقة تقريباً. النجاح يظهر في آخر سطر:

```
=== All pending migrations applied successfully ===
```

تحقق:

```powershell
psql -U postgres -h localhost -d golden_crm_dev -c "SELECT count(*) FROM schema_migrations;"
```

يجب أن يساوي عدد ملفات `.sql` في `migrations/`.

> مجلد `migrations-archive-pre-squash/` أرشيف تاريخي فقط؛ لا تطبّق منه شيئاً. الملف `001_initial_schema.sql` يحل محله بالكامل.

---

## الخطوة 7 — التأكد من سلامة النصوص العربية

ملف الأساس `001_initial_schema.sql` يخزّن بعض النصوص العربية الأولية بترميز مشوّه (مثلاً «مدير النظام» تظهر `ظ…ط¯ظٹط±`). الـ migration رقم `473_fix_seed_arabic_mojibake.sql` يصلحها **تلقائياً** ضمن الخطوة 6، فلا تحتاج أي إجراء يدوي. للتأكد فقط:

```powershell
$env:PGCLIENTENCODING = "UTF8"
psql -U postgres -h localhost -d golden_crm_dev -c "SELECT display_name FROM roles WHERE id = 1;"
```

يجب أن يظهر: **مدير النظام**.

في قائمة «أسباب تخطّي الاستبيان» سيبقى عنصر واحد مشوّه **معطّل** (رقم 125)، لأن نسخة سليمة منه «أخرى» موجودة أصلاً. هذا مقصود: عُطّل بدل حذفه حتى لا تنكسر أي إجابات قديمة مرتبطة به.

---

## الخطوة 8 — إنشاء حساب المدير الأول

```powershell
pnpm --filter @golden-crm/api exec tsx seed-superadmin.ts
```

ينشئ (أو يعيد ضبط) مستخدماً بصلاحيات كاملة:

| الحقل | القيمة |
|---|---|
| اسم المستخدم | `superadmin` |
| كلمة المرور | `Password123!` |
| الدور | `SYSTEM_ADMIN` (`is_super_admin = true`) |
| الفرع | لا شيء، الفروع تُنشأ من الواجهة |

السكربت آمن للتكرار ولا يلمس أي بيانات أخرى. إن ظهر `SYSTEM_ADMIN role not found` فالخطوة 6 لم تكتمل.

> كلمة المرور معروفة ومكتوبة في الكود؛ مقبولة محلياً فقط. في أي بيئة يصل إليها غيرك غيّرها فوراً بعد أول دخول.

---

## الخطوة 9 — تشغيل الباك اند والفرونت اند

### الطريقة الموصى بها: أمر واحد للطرفين

```powershell
pnpm dev
```

يشغّل الطرفين معاً في نفس النافذة (`api` بالأزرق و`web` بالأخضر)، مع إعادة تشغيل تلقائية للباك اند عند تعديل الكود (`tsx watch`) وتحديث فوري للفرونت (Vite HMR). `Ctrl+C` يوقفهما معاً.

### أو كل طرف في طرفية مستقلة (أسهل لقراءة السجلات)

الطرفية الأولى:
```powershell
pnpm dev:api
```

الطرفية الثانية:
```powershell
pnpm dev:web
```

### علامات النجاح

في سجل الـ API يجب أن ترى:

```
API server running on http://localhost:3000
  mode: development (frontend served by Vite on port 5000)
[contactTargetsCleanupJob] started (60s tick)
[outboxJob] started (every 20s, batch 50)
...
```

وفي سجل Vite:

```
VITE v6.x  ready in ... ms
➜  Local:   http://localhost:5000/
```

---

## الخطوة 10 — التحقق النهائي أن كل شيء يعمل

| ما نتحقق منه | الطريقة | النتيجة المتوقعة |
|---|---|---|
| الباك اند حي | افتح `http://localhost:3000/api/health` | `{"status":"ok"}` |
| توثيق الـ API | افتح `http://localhost:3000/api-docs` | واجهة Swagger |
| الفرونت اند | افتح `http://localhost:5000` | صفحة تسجيل الدخول |
| الاتصال بين الطرفين + القاعدة | سجّل دخول بـ `superadmin` / `Password123!` | تدخل إلى لوحة التحكم |
| العربي سليم | افتح إدارة الأدوار | «مدير النظام» مكتوبة بشكل صحيح |

اختبار الدخول من الطرفية مباشرة (بدون متصفح):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType "application/json" -Body '{"username":"superadmin","password":"Password123!"}'
```

يجب أن يعيد كائناً فيه `token`.

**بعد أول دخول:** المدير بلا فرع، فابدأ بإنشاء الفروع من الواجهة، ثم الأدوار والموظفين والمستخدمين.

---

## فحص سلامة الكود (نفس ما يفعله الـ CI)

قبل أي commit يُستحسن تشغيل:

```powershell
pnpm check
```

ينفّذ فحص أنواع الفرونت ثم فحص أنواع الباك اند ثم اختبارات الوحدات. ولتجربة بناء الفرونت للإنتاج:

```powershell
pnpm build
```

---

## استكشاف الأخطاء الشائعة

| رسالة الخطأ / العَرَض | السبب | الحل |
|---|---|---|
| `pnpm : The term 'pnpm' is not recognized` | pnpm غير مثبت أو الطرفية قديمة | الخطوة 1، ثم أغلق الطرفية وافتحها |
| `running scripts is disabled on this system` | سياسة تنفيذ PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `ERR_PNPM_OUTDATED_LOCKFILE` | ملف القفل لا يطابق `package.json` | اسحب آخر نسخة من الفرع؛ لا تعدّل ملف القفل يدوياً |
| `psql : The term 'psql' is not recognized` | مجلد `bin` غير مضاف إلى الـ PATH، أو الطرفية فُتحت قبل إضافته | الخطوة 1 (قسم PostgreSQL، «ثالثاً»)، ثم أعد فتح الطرفية |
| `ECONNREFUSED 127.0.0.1:5432` | خدمة PostgreSQL متوقفة، أو تعمل على منفذ آخر | `Get-Service postgresql-x64-18`، وشغّلها بـ `Start-Service` كمسؤول؛ وإن كان المنفذ غير 5432 فعدّله في `DATABASE_URL` |
| المثبّت اقترح المنفذ `5433` | نسخة PostgreSQL أخرى تستخدم 5432 | استخدم 5433 في `DATABASE_URL`، أو أزل النسخة القديمة |
| نسيت كلمة مرور `postgres` | — | أسهل حل على جهاز تطوير: أزل PostgreSQL وأعد تثبيته (يحذف القواعد المحلية) |
| `password authentication failed for user` | كلمة مرور خاطئة في `DATABASE_URL` | صحّحها، وانتبه لترميز الرموز الخاصة (الخطوة 4-ب) |
| `database "golden_crm_dev" does not exist` | القاعدة لم تُنشأ | الخطوة 4-أ |
| `unrecognized configuration parameter "transaction_timeout"` | PostgreSQL أقدم من 17 | ثبّت PostgreSQL 18، وأنشئ القاعدة من جديد |
| `permission denied to create extension "pg_trgm"` | مستخدم القاعدة ليس مالكها | `ALTER DATABASE golden_crm_dev OWNER TO <المستخدم>;` |
| `✗ <ملف>.sql FAILED — transaction rolled back` | خطأ في migration محدد | اقرأ رسالة الخطأ تحتها، أصلح السبب، ثم أعد `pnpm migrate` (يكمل من حيث توقف) |
| `SYSTEM_ADMIN role not found` | الـ migrations لم تُطبَّق | `pnpm migrate` ثم أعد الخطوة 8 |
| `EADDRINUSE :::3000` أو المنفذ 5000 مشغول | نسخة قديمة ما زالت تعمل | `Get-NetTCPConnection -LocalPort 3000` لمعرفة العملية، ثم `Stop-Process -Id <PID>` |
| الصفحة تفتح لكن كل الطلبات تفشل (502/500 في الشبكة) | الباك اند غير مشغّل | تأكد من `pnpm dev:api` وأن `http://localhost:3000/api/health` يعمل |
| «اسم المستخدم أو كلمة المرور غير صحيحة» عند الدخول | المدير لم يُنشأ أو القاعدة مختلفة | الخطوة 8، وتأكد أن `DATABASE_URL` يشير لنفس القاعدة |
| نصوص عربية مشوّهة مثل `ظ…ط¯ظٹط±` | الـ migration 473 لم يُطبَّق | `pnpm migrate`، ثم تحقق كما في الخطوة 7 |
| `JWT_SECRET must be set in production` | `NODE_ENV=production` بدون مفتاح | محلياً استخدم `development`؛ في الإنتاج اضبط `JWT_SECRET` |
| `OTP_PROVIDER=simulated is refused in production` | مزوّد المحاكاة مرفوض في الإنتاج | محلياً استخدم `development` |

---

## مرجع سريع (بعد أول إعداد)

التشغيل اليومي يقتصر على:

```powershell
git pull
pnpm install --frozen-lockfile
pnpm migrate
pnpm dev
```

ثم افتح `http://localhost:5000`.

## وثائق ذات صلة

| الوثيقة | متى تحتاجها |
|---|---|
| [pm2-production-first-setup.md](pm2-production-first-setup.md) | تجهيز سيرفر إنتاج لأول مرة |
| [pm2-production-operations.md](pm2-production-operations.md) | عمليات الإنتاج اليومية |
| [docker-jenkins-new-server.md](docker-jenkins-new-server.md) | النشر عبر Docker/Jenkins |
| [RASEL-OTP-SETUP.md](RASEL-OTP-SETUP.md) | تفعيل رسائل OTP الحقيقية |
| [APP-NOTIFICATIONS-SETUP.md](APP-NOTIFICATIONS-SETUP.md) | تفعيل إشعارات Firebase |
