# Golden CRM — دليل النشر الكامل

> من الصفر حتى CI/CD على أي سيرفر جديد

---

## المتطلبات الأولية

- سيرفر Linux (Ubuntu 22.04+)
- Domain مضبوط DNS على IP السيرفر
- Jenkins master يعمل (jenkins.itlandfz.com)
- صلاحية root على السيرفر

---

## 1. تثبيت Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
```

---

## 2. إعداد nginx-server (مشترك بين كل المشاريع)

> لازم يشتغل **قبل** أي مشروع لأنه يُنشئ شبكة `proxy-net`.

### إنشاء المجلدات

```bash
mkdir -p /home/Docker/nginx-reverse-proxy/volume/{conf.d,html,certificates}
```

### إنشاء docker-compose.yml

```bash
cat > /home/Docker/nginx-reverse-proxy/docker-compose.yml << 'EOF'
name: nginx-server
services:
  nginx:
    image: nginx:latest
    container_name: nginx-server
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./volume/conf.d:/etc/nginx/conf.d
      - ./volume/html:/etc/nginx/html
      - ./volume/certificates:/etc/nginx/certificates
    networks:
      - proxy-net

networks:
  proxy-net:
    name: proxy-net
    driver: bridge
EOF
```

### إنشاء كونفيغ Golden CRM

```bash
cat > /home/Docker/nginx-reverse-proxy/volume/conf.d/reverse_proxy.conf << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    client_max_body_size 150m;

    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass         http://golden-crm-app:3000;
        proxy_http_version 1.1;
        proxy_set_header   Connection      "";
        proxy_set_header   Host            $host;
        proxy_set_header   X-Real-IP       $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
EOF
```

> غيّر `YOUR_DOMAIN` للدومين الفعلي.

### تشغيل nginx

```bash
cd /home/Docker/nginx-reverse-proxy
docker compose up -d
docker ps | grep nginx
```

### لإضافة مشروع جديد لاحقاً

أضف `server { }` block جديد داخل `volume/conf.d/reverse_proxy.conf` ثم:

```bash
docker exec nginx-server nginx -s reload
```

---

## 3. تجهيز مجلد المشروع

```bash
mkdir -p /home/Docker/golden-crm
cd /home/Docker/golden-crm
git clone -b dev https://github.com/Sniperof/GoldenGroup2.git .
```

---

## 4. إنشاء ملف .env

```bash
cp .env.example .env
nano .env
```

القيم المطلوبة:

```env
DATABASE_URL=postgresql://golden:STRONG_PASSWORD@db:5432/golden_crm
POSTGRES_DB=golden_crm
POSTGRES_USER=golden
POSTGRES_PASSWORD=STRONG_PASSWORD
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://YOUR_DOMAIN
```

> لإنشاء JWT_SECRET: `openssl rand -hex 32`

---

## 5. النشر الأول

> هاي الخطوة تشتغل **مرة وحدة فقط** على سيرفر جديد. بعدها CI/CD يتولى كل شيء.

```bash
cd /home/Docker/golden-crm

# 1. شغّل قاعدة البيانات (Docker ينتظر healthy تلقائياً قبل ما يبدأ app)
docker compose up -d db

# 2. ابنِ التطبيق وشغّله
docker compose build app
docker compose up -d app

# 3. شغّل الـ migrations
docker compose run --rm --no-deps \
  -e NODE_ENV=production \
  app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/migrate.ts
```

تحقق من الـ health:

```bash
curl -sf http://localhost/api/health
# المتوقع: {"status":"ok"}
```

---

## 6. إنشاء حساب superadmin

> مرة وحدة فقط بعد أول نشر.

```bash
docker compose run --rm --no-deps \
  -e NODE_ENV=development \
  app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/dev-reset-single-superadmin.ts
```

بيانات الدخول الافتراضية:
- **username:** `superadmin`
- **password:** `Password123!`

> غيّر الباسورد فور الدخول الأول.

---

## 7. إعداد Jenkins Agent على السيرفر الجديد

### على السيرفر

```bash
mkdir -p /home/Docker/jenkins-agent
apt-get install -y openjdk-17-jre
```

### على Jenkins master

1. **Manage Jenkins → Nodes → New Node**
   - Node name: اسم السيرفر (مثلاً `prod`)
   - Type: Permanent Agent
2. الإعدادات:
   - Remote root directory: `/home/Docker/jenkins-agent`
   - Labels: نفس اسم الـ Node
   - Launch method: **Launch agents via SSH**
   - Host: IP السيرفر
   - Credentials: أضف SSH username/password أو key
   - Host Key Verification: `Non verifying`
3. احفظ → سيتصل تلقائياً

---

## 8. إعداد Jenkins Pipeline

### على Jenkins master

1. **New Item → Pipeline**
2. تحت **Build Triggers**: فعّل **Trigger builds remotely**
   - Token: `golden-crm-deploy` (أو أي token تختاره)
3. تحت **Pipeline → Pipeline script** الصق (غيّر `label` حسب اسم الـ Node):

```groovy
pipeline {
    agent { label 'prod' }

    options {
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }

    stages {

        stage('Pull') {
            steps {
                sh '''
                    cd /home/Docker/golden-crm
                    git fetch origin dev
                    git reset --hard origin/dev
                '''
            }
        }

        stage('Build & Deploy') {
            steps {
                sh '''
                    cd /home/Docker/golden-crm
                    docker compose build app
                    docker compose up -d app
                '''
            }
        }

        stage('Migrate') {
            steps {
                sh '''
                    cd /home/Docker/golden-crm
                    docker compose run --rm --no-deps \
                        -e NODE_ENV=production \
                        app \
                        node ./node_modules/tsx/dist/cli.mjs packages/api/migrate.ts
                '''
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                    sleep 10
                    curl -sf http://localhost/api/health
                '''
            }
        }
    }

    post {
        success { echo 'Deploy successful!' }
        failure { echo 'Deploy failed — check logs.' }
    }
}
```

4. احفظ

---

## 9. إعداد GitHub Webhook

احصل على Jenkins API Token:
- Jenkins → اسمك أعلى اليمين → **Configure → API Token → Add new Token**

أضف الـ webhook على GitHub (**Settings → Webhooks → Add webhook**):

| الحقل | القيمة |
|-------|--------|
| Payload URL | `https://USERNAME:API_TOKEN@jenkins.itlandfz.com/job/FOLDER/job/JOB_NAME/build?token=TOKEN` |
| Content type | `application/json` |
| Which events | `Just the push event` |
| Active | ✓ |

---

## التحقق النهائي

```bash
# التطبيق يعمل
curl -sf http://YOUR_DOMAIN/api/health

# الـ containers شغّالة
docker ps

# الـ logs
docker compose -f /home/Docker/golden-crm/docker-compose.yml logs app --tail=50
```

---

## مصدر البيانات الأساسية

| البيانات | المصدر |
|----------|--------|
| roles, permissions, role_permission_grants | migration `001` — تلقائي |
| system_lists | migration `001` + migrations لاحقة — تلقائي |
| system_settings, task_type_config, emergency_action_types | migration `001` — تلقائي |
| geo_units, branches | **فارغة** — تُضاف يدوياً بعد النشر |
| superadmin user | يدوي — خطوة 6 |

---

## ملاحظات مهمة

| الموضوع | التفصيل |
|---------|---------|
| الـ migrations | تشتغل يدوياً عبر `migrate.ts` — آمنة للتشغيل المتكرر (idempotent) |
| الـ uploads | محفوظة في Docker volume `golden-crm_uploads` — لا تُحذف عند redeploy |
| قاعدة البيانات | محفوظة في Docker volume `golden-crm_pgdata` — لا تلمسها أبداً في CI/CD |
| بورت الداتا بيز | `5432` مكشوف على الهوست — اتصل مباشرة من DBeaver على IP السيرفر |
| nginx-server | لازم يشتغل أول شيء — ينشئ شبكة `proxy-net` |
| superadmin | شغّل سكريبته مرة وحدة بعد أول deploy فقط |
| CI/CD | يبني ويعيد تشغيل `app` فقط — `db` لا تتأثر أبداً |
