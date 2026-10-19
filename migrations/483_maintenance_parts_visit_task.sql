-- 483: tie each maintenance part to the visit attempt it was recorded in.
--
-- نتيجة الصيانة تراكمية على مستوى المهمة (المحاولة الثانية تكمل على الأولى)،
-- لكن القطع كانت تُحفظ بلا أي إشارة إلى الزيارة التي بُدّلت فيها، فكان حفظ
-- المحاولة الثانية يعيد كتابة قطع الأولى ويضيع تاريخها. visit_task_id يحدد
-- الزيارة؛ قطع الزيارات السابقة تصبح للقراءة فقط (يفرضه PUT /emergency-result/:taskId/parts).

ALTER TABLE public.emergency_result_parts
  ADD COLUMN IF NOT EXISTS visit_task_id INTEGER REFERENCES public.visit_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.device_installed_parts
  ADD COLUMN IF NOT EXISTS visit_task_id INTEGER REFERENCES public.visit_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_erp_visit_task ON public.emergency_result_parts (visit_task_id);
CREATE INDEX IF NOT EXISTS idx_dip_visit_task ON public.device_installed_parts (visit_task_id);

-- Backfill: the latest visit attempt of the task that already existed when the part
-- was recorded (falls back to the task's first attempt).
UPDATE public.emergency_result_parts p
   SET visit_task_id = COALESCE(
         (SELECT vt.id FROM public.visit_tasks vt
           WHERE vt.source_open_task_id = p.open_task_id AND vt.created_at <= p.created_at
           ORDER BY vt.created_at DESC, vt.id DESC LIMIT 1),
         (SELECT vt.id FROM public.visit_tasks vt
           WHERE vt.source_open_task_id = p.open_task_id
           ORDER BY vt.created_at, vt.id LIMIT 1))
 WHERE p.visit_task_id IS NULL AND p.open_task_id IS NOT NULL;

UPDATE public.device_installed_parts p
   SET visit_task_id = COALESCE(
         (SELECT vt.id FROM public.visit_tasks vt
           WHERE vt.source_open_task_id = p.open_task_id AND vt.created_at <= p.created_at
           ORDER BY vt.created_at DESC, vt.id DESC LIMIT 1),
         (SELECT vt.id FROM public.visit_tasks vt
           WHERE vt.source_open_task_id = p.open_task_id
           ORDER BY vt.created_at, vt.id LIMIT 1))
 WHERE p.visit_task_id IS NULL AND p.open_task_id IS NOT NULL;
