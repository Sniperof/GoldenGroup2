

\# تقرير تحليل مسار "الزبون المقترح / Candidate"

\## Golden CRM — تحليل نظام، بدون تعديل



\---



\## A) هل Candidate يسمح بالتكرار؟



\### آلية التحقق عند الإنشاء — \[`useCandidateStore.ts:92`](packages/web/src/hooks/useCandidateStore.ts)



يوجد \*\*مستويان\*\* من التحقق:



\*\*المستوى 1 — حظر صارم (hard block):\*\*

\- إذا كان نفس رقم الهاتف موجوداً في \*\*نفس الجلسة\*\* (referralSheetId)، أو

\- إذا كان نفس الرقم أدخله \*\*نفس المستخدم في نفس اليوم\*\* (direct mode بلا sheet)



في هذه الحالة يُرمى error وتُمنع العملية كلياً.



\*\*المستوى 2 — سماح مع تعليم (flagged duplicate):\*\*

\- إذا كان الرقم موجوداً في \*\*جلسة مختلفة\*\* أو عند \*\*مشرفة أخرى\*\*:

&#x20; - يُسمح بالإنشاء

&#x20; - يُعيَّن `duplicateFlag = true`

&#x20; - يُعيَّن `duplicateType = 'Client'` أو `'Candidate'`

&#x20; - يُحفظ `duplicateReferenceId` = id السجل المطابق



\*\*الخلاصة:\*\* لا يوجد `UNIQUE` constraint على `mobile` في جدول `candidates` في قاعدة البيانات. الحماية كلها في الواجهة فقط (client-side Zustand store). في حالات التكرار عبر السياقات المختلفة، يُسمح بالإدخال مع تعليم `duplicateFlag`.



\*\*نعم — Candidate مقصود كمساحة مرنة للترشيحات.\*\* الفكرة أن التكرار مقبول عبر المشرفات المختلفة، لكنه يُعلَّم ولا يُخفى.



\---



\## B) كيف يتم تأهيل Candidate؟



\### المكوّن: \[`QualificationModal.tsx`](packages/web/src/components/candidates/QualificationModal.tsx)



التأهيل عبر \*\*مودال ثنائي الخطوات:\*\*



\*\*الخطوة 1 — التحقق من التكرار:\*\*



| الحالة | ما يظهر | ما يمكن فعله |

|--------|---------|--------------|

| `NO\_MATCH` | "الرقم جديد كلياً" | زر "متابعة الإجراء" يظهر |

| `MATCH\_VISIBLE` | بيانات الزبون الموجود | ربطه بالزبون الموجود فقط |

| `MATCH\_RESTRICTED` | "السجل خارج نطاق صلاحيتك" | مسدود كلياً |



\*\*الخطوة 2 — متاحة فقط عند `NO\_MATCH`:\*\*

1\. \*\*تحويل لاسم مرشح جديد\*\* → إنشاء Client جديد

2\. \*\*استبعاد\*\* → status = 'Junk'

3\. \*\*مراجعة لاحقاً\*\* → status = 'FollowUp'



\*\*ملاحظة مهمة:\*\* عند `MATCH\_VISIBLE` لا يوجد خيار "إنشاء زبون جديد" — الخيار الوحيد هو الربط أو الإلغاء.



\*\*آلية اكتشاف Client الموجود:\*\*

\- \*\*آلي:\*\* عبر `api.clients.smartMatch({ phone: candidate.mobile })` → مطابقة رقم الهاتف مع تطبيع (normalize) — \[`clients.ts:473`](packages/api/routes/clients.ts)

\- \*\*يدوي:\*\* بحث نصي حر (اسم، رقم، ID، منطقة) مع عربية normalized (`أإآ→ا`، `ة→ه`، `ى→ي`)



\*\*لا يوجد smart match بالاسم تلقائياً\*\* — المطابقة الآلية بالهاتف فقط. البحث بالاسم يدوي.



\---



\## C) عند وجود Client مطابق، ماذا يحدث؟



\### الدالة: \[`linkCandidateToClient`](packages/web/src/hooks/useCandidateStore.ts#L224)



```

linkCandidateToClient(candidateId, clientId):

&#x20; 1. تجلب بيانات Client الموجود

&#x20; 2. تُنشئ كائن newReferrer من بيانات Candidate:

&#x20;      { referrerType, referralEntityId, referrerName, sourceChannel,

&#x20;        referralDate, referralReason, referralSheetId }

&#x20; 3. تُضيف newReferrer إلى client.referrers\[] (JSONB array)

&#x20; 4. إذا كان client.referrerName فارغاً → تملأ الحقول الرئيسية أيضاً

&#x20; 5. تحدّث Candidate: status='Qualified', convertedToLeadId=clientId, duplicateFlag=true

```



\*\*الجدول الموجز:\*\*



| السؤال | الإجابة |

|--------|---------|

| هل يُنشأ Client جديد؟ | \*\*لا\*\* — ممنوع صراحةً |

| هل يُربط Candidate بالـ Client؟ | \*\*نعم\*\* — `convertedToLeadId = clientId` |

| هل تُحدَّث بيانات الـ Client؟ | \*\*نعم\*\* — فقط `referrers\[]` يُضاف إليه |

| هل يُضاف الوسيط كمصدر؟ | \*\*نعم\*\* — في `referrers\[]` |

| هل تُحفظ قناة الترشيح والسبب والتاريخ؟ | \*\*نعم\*\* — في كائن الـ referrer المضاف |



\---



\## D) ما معنى "الوسيط" حالياً؟



\### حقول الـ Candidate المتعلقة بالمصدر والوسيط:



| الحقل | المعنى |

|-------|--------|

| `referralNameSnapshot` | \*\*اسم الوسيط\*\* — الشخص الذي رشّح الاسم (مثلاً: زبون قديم، موظف، معارف) |

| `referralType` | نوع الوسيط: `Personal / Client / Employee / Unknown` |

| `referralEntityId` | ID الموظف أو الزبون إذا كان النوع Employee/Client |

| `referralOriginChannel` | قناة الوصول: `Acquaintance / PhoneCall / SocialMedia / Campaign / App` |

| `referralDate` | تاريخ الترشيح |

| `referralReason` | سبب الترشيح |

| `referralSheetId` | الجلسة/اللائحة المرتبطة بها |

| `createdBy` / `ownerUserId` | \*\*المشرفة التي أدخلت الاسم المقترح\*\* — هي منشئة الـ Candidate |



\*\*الفرق الجوهري:\*\*

\- \*\*الوسيط (`referralNameSnapshot`)\*\* = الشخص الخارجي الذي أعطى الاسم (مثلاً: "أحمد الزبون القديم أحال صديقه")

\- \*\*المنشئة (`createdBy`)\*\* = المشرفة الداخلية التي أدخلت البيانات في النظام



\*\*هل يمكن أن يكون الوسيط شخصاً آخر؟\*\* نعم — إذا كان النوع `Employee`، يتم البحث بـ ID الموظف وملء اسمه تلقائياً. إذا كان `Client`، يتم اختيار الزبون من القائمة. الوسيط ليس بالضرورة نفس المنشئة.



\*\*هل يُنقل الوسيط إلى Client عند التأهيل؟\*\* نعم — `referralNameSnapshot` يُحفظ في `client.referrers\[].referrerName`.



\---



\## E) ماذا يحدث للإسناد (Assignment)؟



\### عند تأهيل Candidate إلى Client جديد — \[`qualifyCandidate`](packages/web/src/hooks/useCandidateStore.ts#L155)



```typescript

savedClient = await api.clients.create({

&#x20;   firstName: candidate.firstName,

&#x20;   // ... بيانات أخرى

&#x20;   sourceChannel: candidate.referralOriginChannel,

&#x20;   referrerType: candidate.referralType,

&#x20;   referrerName: candidate.referralNameSnapshot,

&#x20;   // ... لا يوجد assignments أو assignmentUserIds

});

```



\*\*لا يُضاف أي assignment\*\* في `api.clients.create()`. لا توجد حقل `assignmentUserIds` في الـ payload.



\### عند ربط Candidate بـ Client موجود — \[`linkCandidateToClient`](packages/web/src/hooks/useCandidateStore.ts#L224)



```typescript

await api.clients.update(clientId, {

&#x20;   referrers: \[...existingReferrers, newReferrer]

&#x20;   // لا يوجد assignments أو assignmentUserIds

});

```



\*\*لا يُضاف أي assignment\*\* هنا أيضاً.



\*\*الجدول الموجز:\*\*



| السؤال | الإجابة |

|--------|---------|

| هل يُسنَد Client لمن أدخل Candidate؟ | \*\*لا\*\* |

| هل تُضاف المنشئة إلى client.assignments؟ | \*\*لا\*\* |

| هل يُضاف الوسيط إلى assignments؟ | \*\*لا\*\* — فقط إلى `referrers\[]` كمصدر |

| هل يُحافَظ على الإسناد القديم؟ | \*\*نعم\*\* — لأنه لا يُمس أصلاً |

| هل يُضاف إسناد جديد بجانب القديم؟ | \*\*لا\*\* |

| الفرق بين source/referrer وassignment؟ | `referrers\[]` = سجل تاريخي للمصادر. `assignments` = إسناد تشغيلي نشط. النظام يُحدّث الأول فقط. |



\---



\## F) سيناريو المشرفة الثانية مع زبون موجود عند المشرفة الأولى



| المرحلة | ما يحدث فعلياً في الكود |

|---------|------------------------|

| إنشاء Candidate | \*\*مسموح\*\* — يُعلَّم `duplicateFlag=true, duplicateType='Client'` إذا اكتُشف التكرار |

| عند فتح التأهيل | يُجري smart-match تلقائياً بالهاتف |

| إذا كان Client ضمن صلاحية المشرفة 2 | يظهر `MATCH\_VISIBLE` — تستطيع الربط |

| إذا كان Client خارج صلاحيتها | يظهر `MATCH\_RESTRICTED` — \*\*مسدودة كلياً\*\* |

| عند الربط (إذا أمكن) | يُضاف referrer جديد في `client.referrers\[]` |

| هل تُضاف المشرفة 2 كإسناد؟ | \*\*لا\*\* |

| هل يظهر لها الزبون لاحقاً؟ | \*\*لا\*\* — لأنه لم يُضَف إلى assignments الخاصة بها |

| هل يتأثر إسناد المشرفة 1؟ | \*\*لا\*\* — يبقى كما هو |

| هل يوجد إشعار أو conflict أو طلب موافقة؟ | \*\*لا\*\* — لا يوجد أي آلية من هذا القبيل |



\---



\## G) مقتطفات من الكود تثبت الاستنتاجات



\*\*1. إنشاء Candidate مع تعليم التكرار:\*\*

```typescript

// useCandidateStore.ts:128

const clientDupe = clients.find((c: any) => c.mobile === candidateData.mobile);

const candidateDupe = state.candidates.find(c => c.mobile === candidateData.mobile);



if (clientDupe) { isDupe = true; dupeType = 'Client'; refId = clientDupe.id; }

else if (candidateDupe) { isDupe = true; dupeType = 'Candidate'; refId = candidateDupe.id; }



await api.candidates.create({

&#x20;   ...candidateData,

&#x20;   duplicateFlag: isDupe,    // يُسجَّل لكن لا يُمنع

&#x20;   duplicateType: dupeType,

&#x20;   duplicateReferenceId: refId,

});

```



\*\*2. حظر إنشاء Client مكرر في API:\*\*

```typescript

// clients.ts:549

const duplicate = await findDuplicateClientByPhone(c.mobile);

if (duplicate) {

&#x20;   return res.status(409).json({ error: 'DUPLICATE\_CLIENT\_PHONE', ... });

}

```



\*\*3. Smart match بالهاتف فقط:\*\*

```typescript

// clients.ts:258

WHERE c.is\_candidate = FALSE

&#x20; AND (phoneNormalizationSql('c.mobile') = $1

&#x20;      OR EXISTS (SELECT 1 FROM jsonb\_array\_elements(c.contacts) AS contact

&#x20;                 WHERE phoneNormalizationSql(contact->>'number') = $1))

```



\*\*4. ربط Candidate بـ Client موجود — إضافة referrer فقط، بلا assignment:\*\*

```typescript

// useCandidateStore.ts:235

const newReferrer = {

&#x20;   id: Date.now().toString(),

&#x20;   referrerType: candidate.referralType,

&#x20;   referralEntityId: candidate.referralEntityId,

&#x20;   referrerName: candidate.referralNameSnapshot,

&#x20;   sourceChannel: candidate.referralOriginChannel,

&#x20;   referralDate: candidate.referralDate,

&#x20;   referralReason: candidate.referralReason,

&#x20;   referralSheetId: candidate.referralSheetId

};

await api.clients.update(clientId, {

&#x20;   referrers: \[...existingReferrers, newReferrer]

&#x20;   // لا يوجد assignmentUserIds هنا

});

```



\*\*5. تأهيل لـ Client جديد — بلا assignment للمنشئة:\*\*

```typescript

// useCandidateStore.ts:178

savedClient = await api.clients.create({

&#x20;   firstName: candidate.firstName || '',

&#x20;   // ... حقول الزبون

&#x20;   referrerType: candidate.referralType,

&#x20;   referrerName: candidate.referralNameSnapshot,

&#x20;   // لا يوجد assignmentUserIds

});

```



\---



\## H) الاستنتاج النهائي



| السؤال | الجواب |

|--------|--------|

| \*\*1. هل Candidate هو المدخل المرن للأسماء حتى لو كانت مكررة؟\*\* | \*\*نعم جزئياً\*\* — مسموح بالتكرار عبر السياقات المختلفة مع تعليم `duplicateFlag`. الحظر الصارم فقط داخل نفس الجلسة/اليوم/المشرفة. |

| \*\*2. هل جدول Client يبقى نظيفاً وغير مكرر؟\*\* | \*\*نعم\*\* — API يرفض إنشاء Client بهاتف مكرر بـ HTTP 409 على مستوى الـ backend. |

| \*\*3. هل تأهيل Candidate يربطه بزبون موجود عند التطابق؟\*\* | \*\*نعم\*\* — لكن فقط عندما يظهر `MATCH\_VISIBLE` (ضمن صلاحية المستخدم). عند `MATCH\_RESTRICTED` النظام مسدود. |

| \*\*4. هل وسيط أو منشئ Candidate يُضاف كمصدر للزبون الموجود؟\*\* | \*\*الوسيط نعم\*\* — `referralNameSnapshot` يُضاف إلى `client.referrers\[]`. \*\*المنشئة (المشرفة) لا\*\* — هي لا تُضاف لا كمصدر ولا كإسناد. |

| \*\*5. هل يُضاف أيضاً كإسناد تشغيلي؟\*\* | \*\*لا\*\* — لا `qualifyCandidate` ولا `linkCandidateToClient` يُعدّلان `client\_assignments`. |

| \*\*6. هل يحدث ذلك حتى لو كان الزبون مسنداً لمشرفة أخرى؟\*\* | \*\*لا فرق\*\* — النتيجة نفسها، والإسناد القديم لا يُمس. |

| \*\*7. هل النظام يحقق الفكرة بالكامل أم جزئياً؟\*\* | \*\*جزئياً فقط\*\* — الجزء المحقق: الزبون لا يتكرر في clients، يمكن إدخال Candidate مكرر، وعند التأهيل يُربط بالزبون الموجود ويُسجَّل الوسيط كمصدر. الجزء الغائب: تسجيل المنشئة (المشرفة) كإسناد إضافي أو كمصدر. |

| \*\*8. الفجوة المتبقية\*\* | \*\*ثلاث فجوات:\*\* |



\### الفجوات التفصيلية:



\*\*الفجوة 1 — عدم إسناد المنشئة:\*\*

عند تأهيل Candidate أو ربطه بـ Client موجود، لا يُضاف `createdBy` الـ Candidate (المشرفة التي أدخلته) إلى `client\_assignments`. هذا يعني أنها لن ترى الزبون في قائمتها حتى لو أسهمت بالإيصال إليه.



\*\*الفجوة 2 — التمييز بين وسيط الـ Candidate ومنشئته:\*\*

الحقل المنقول إلى `referrers\[]` هو `referralNameSnapshot` (الوسيط الخارجي)، وليس `createdBy` (المشرفة الداخلية). إذا كان المطلوب هو \*\*تسجيل المشرفة كمصدر إضافي\*\*، هذا غير موجود حالياً.



\*\*الفجوة 3 — `MATCH\_RESTRICTED` يمنع أي إجراء:\*\*

إذا كان الزبون الموجود خارج صلاحية المشرفة 2، لا يمكنها الربط ولا إنشاء زبون جديد ولا تسجيل نفسها كمصدر. النظام يعطل التأهيل كلياً في هذه الحالة، وهي حالة شائعة جداً في سيناريو "مشرفتان على نفس الزبون".

