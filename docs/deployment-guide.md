# Golden CRM — دليل النشر الكامل

> من الصفر حتى CI/CD على أي سيرفر جديد

---

## المتطلبات الأولية

- سيرفر Linux (Ubuntu 22.04+)
- Domain مضبوط DNS على IP السيرفر
- Jenkins master يعمل (jenkins.itlandfz.com)
- صلاحية root أو sudo على السيرفر

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

```bash
mkdir -p /opt/nginx-server/conf.d
cd /opt/nginx-server
```

أنشئ `/opt/nginx-server/docker-compose.yml`:

```yaml
name: nginx-server
services:
  nginx:
    image: nginx:1.27-alpine
    container_name: nginx-server
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./conf.d:/etc/nginx/conf.d:ro
    networks:
      - proxy-net

networks:
  proxy-net:
    name: proxy-net
    driver: bridge
```

أنشئ `/opt/nginx-server/conf.d/golden-crm.conf`:

```nginx
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
```

> غيّر `YOUR_DOMAIN` للدومين الفعلي.

شغّل nginx:

```bash
cd /opt/nginx-server
docker compose up -d
docker ps | grep nginx
```

---

## 3. تجهيز مجلد المشروع

```bash
mkdir -p /root/golden-crm
cd /root/golden-crm
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

```bash
cd /root/golden-crm
docker compose up -d --build
```

تحقق من الـ migrations:

```bash
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

```bash
docker compose exec app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/seed-superadmin.ts
```

---

## 7. إصلاح النصوص العربية (Mojibake) — مرة واحدة فقط

يصلح: `branches`, `geo_units`, `roles`, `system_lists`, `permissions`, `task_type_config`, `emergency_action_types`, `system_settings`

```bash
docker compose exec -T db \
  psql -U golden -d golden_crm < scripts/fix-mojibake.sql
```

---

## 8. إعداد Jenkins Agent على السيرفر الجديد

### على السيرفر:

```bash
mkdir -p /home/Docker/jenkins-agent
apt-get install -y openjdk-17-jre
```

### على Jenkins master:

1. **Manage Jenkins → Nodes → New Node**
   - Node name: `qa` (أو اسم السيرفر)
   - Type: Permanent Agent
2. الإعدادات:
   - Remote root directory: `/home/Docker/jenkins-agent`
   - Labels: `qa`
   - Launch method: **Launch agents via SSH**
   - Host: IP السيرفر
   - Credentials: أضف SSH key أو username/password
   - Host Key Verification: `Non verifying`
3. احفظ → سيتصل تلقائياً

---

## 9. إعداد Jenkins Pipeline

### على Jenkins master:

1. **New Item → Pipeline**
2. اسم الـ job مثلاً: `goldengroup-qa`
3. تحت **Build Triggers**: فعّل **Trigger builds remotely**
   - Token: `golden-crm-qa-deploy`
4. تحت **Pipeline → Pipeline script** الصق:

```groovy
pipeline {
    agent { label 'qa' }

    options {
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }

    stages {

        stage('Pull') {
            steps {
                sh '''
                    cd /root/golden-crm
                    git fetch origin dev
                    git reset --hard origin/dev
                '''
            }
        }

        stage('Build & Deploy') {
            steps {
                sh 'cd /root/golden-crm && docker compose up -d --build'
            }
        }

        stage('Migrate') {
            steps {
                sh '''
                    cd /root/golden-crm
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

5. احفظ

---

## 10. إعداد GitHub Webhook

احصل على Jenkins API Token:
- Jenkins → اسمك أعلى اليمين → **Configure → API Token → Add new Token**

أضف الـ webhook على GitHub (**Settings → Webhooks → Add webhook**):

| الحقل | القيمة |
|-------|--------|
| Payload URL | `https://USERNAME:API_TOKEN@jenkins.itlandfz.com/job/GoldenGroup/job/goldengroup-qa/build?token=golden-crm-qa-deploy` |
| Content type | `application/json` |
| Which events | `Just the push event` |
| Active | ✓ |

> غيّر `USERNAME` و`API_TOKEN` و`goldengroup-qa` للقيم الصحيحة.

---

## التحقق النهائي

```bash
# التطبيق يعمل
curl -sf http://YOUR_DOMAIN/api/health

# الـ containers شغّالة
docker ps

# الـ logs
docker compose -f /root/golden-crm/docker-compose.yml logs app --tail=50
```

---

## ملاحظات مهمة

| الموضوع | التفصيل |
|---------|---------|
| الـ migrations | تعمل تلقائياً مع كل deploy — آمنة للتشغيل المتكرر |
| الـ uploads | محفوظة في Docker volume `golden-crm_uploads` — لا تُحذف عند redeploy |
| قاعدة البيانات | محفوظة في Docker volume `golden-crm_pgdata` |
| Mojibake fix | مرة واحدة فقط على قاعدة بيانات جديدة |
| nginx-server | مشترك بين كل المشاريع — لا تحذفه |
