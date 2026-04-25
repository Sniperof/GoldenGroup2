\*\*تحليل\*\*

عدّلت ملفين فقط: \[packages/api/routes/clients.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts:1) و\[packages/api/policies/clientPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/clientPolicy.ts:1). الاستبدال كان مباشرًا:

\- إزالة `req.scope`

\- بناء القرار من `req.authContext`

\- حل branch الهدف عبر `resolveActingBranch(...)`

\- ثم تمرير `branchId` إلى policy helper التي تستدعي `authorize()`



بنيت policy helper بسيطة:

\- `canListClients`

\- `canViewClient`

\- `canCreateClient`

\- `canEditClient`

\- `canDeleteClient`



وكلها تعتمد فقط على:

\- `permission`

\- `branchId`



بدون أي `assignedUserId` أو ownership logic.



\*\*التنفيذ\*\*

أدخلت `clients` إلى الـ pipeline الرسمي:

\- `GET /` خلف `requirePermission('clients.view\_list')`

\- `GET /:id` خلف `requirePermission('clients.view')`

\- `POST /` خلف `requirePermission('clients.create')`

\- `PUT /:id` خلف `requirePermission('clients.edit')`

\- `DELETE /:id` خلف `requirePermission('clients.delete')`

\- `POST /bulk-delete` خلف `requirePermission('clients.delete')`



وفي داخل الوحدة:

\- `list` صار branch-aware رسميًا عبر `authContext` و`canListClients`

\- `get/update/delete` تحل `client.branch\_id` أولاً ثم تمرره إلى policy helper

\- `create` يرفض إذا لم يوجد branch target صالح

\- `bulk-delete` لم يعد يعتمد على `scope.branchId`، بل يحمّل فروع السجلات المستهدفة ويمررها إلى policy helper



شغّلت التحقق:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير\*\*

نعم، `clients` دخلت الآن في authorization pipeline رسميًا. لم يعد هناك `req.scope` داخل \[clients.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts:1)، وكل routes أصبحت تستخدم `requirePermission` وتمر عبر policy helper ثم `authorize()`.



نعم، الوحدة أصبحت branch-aware رسميًا، وكل access path داخلها يمر عبر `authorize()` بشكل مباشر أو عبر policy helper. لم أفعّل `ASSIGNED`، ولم أستخدم `referrer\_id` أو `referral\_sheet\_id` أو أي field business في القرار.



ملاحظة واحدة مهمة: لأن هذه المرحلة تمنع schema/data changes، فقد استخدمت مفاتيح:

\- `clients.view\_list`

\- `clients.view`

\- `clients.create`

\- `clients.edit`

\- `clients.delete`



في الكود فقط. إذا لم تكن هذه المفاتيح موجودة بالفعل في `permissions`/`role\_permission\_grants` داخل قاعدة البيانات في بيئتكم، فستحتاج seeding منفصل لاحقًا قبل أن تعمل الصلاحيات Runtime كما هو متوقع.

