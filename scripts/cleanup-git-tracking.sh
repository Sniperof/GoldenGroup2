#!/bin/bash
# ============================================================
# cleanup-git-tracking.sh
# يزيل الملفات المتتبّعة في git التي يجب أن تُتجاهل
# شغّله مرة واحدة بعد إغلاق VS Code وأي تطبيق git آخر
# ============================================================

set -e

echo "🔒 إزالة الملفات الحساسة والمولّدة من تتبع git..."

# 1. SSH Keys (حرج جداً)
git rm --cached newssh newssh.pub 2>/dev/null || true

# 2. node_modules (ضخمة ومولّدة)
git rm -r --cached node_modules/ 2>/dev/null || true
git rm -r --cached packages/api/node_modules/ 2>/dev/null || true
git rm -r --cached packages/web/node_modules/ 2>/dev/null || true
git rm -r --cached packages/shared/node_modules/ 2>/dev/null || true

# 3. Build output
git rm -r --cached dist/ 2>/dev/null || true
git rm -r --cached packages/web/dist/ 2>/dev/null || true

# 4. TypeScript build info
git rm --cached tsconfig.app.tsbuildinfo 2>/dev/null || true
git rm --cached packages/web/tsconfig.app.tsbuildinfo 2>/dev/null || true
git rm --cached .tsbuildinfo 2>/dev/null || true

# 5. Log files & temp files
git rm --cached branch_error.log build_utf8.txt errors.txt ts_errors.log ts_out.txt 2>/dev/null || true
git rm --cached server_run_err.txt server_tsc_errors.txt server_tsc_errors.utf8.txt 2>/dev/null || true
git rm --cached server_tsc_errors_2.txt server_tsc_errors_3.txt 2>/dev/null || true

# 6. Test/scratch files at root
git rm --cached hello.ts test_api.ts test_db_insert.ts test_db_insert_v2.ts test_job_applications.ts 2>/dev/null || true

# 7. AI tool metadata
git rm -r --cached .claude/ 2>/dev/null || true
git rm -r --cached .agent/ 2>/dev/null || true
git rm -r --cached .specify/ 2>/dev/null || true
git rm --cached .replit replit.md 2>/dev/null || true

# 8. Uploads folder (user data)
git rm -r --cached uploads/ 2>/dev/null || true

# 9. Archive files
git rm --cached *.rar *.zip 2>/dev/null || true

echo ""
echo "✅ تم! الآن نفّذ:"
echo "   git add .gitignore .env.example"
echo "   git commit -m 'chore: enforce .gitignore — remove tracked sensitive & generated files'"
echo ""
echo "⚠️  تحذير: مفتاح SSH (newssh) كان مرفوعاً على GitHub."
echo "   إذا كنت استخدمته في مكان حقيقي، اعتبره مخترَقاً وولّد مفتاحاً جديداً."
