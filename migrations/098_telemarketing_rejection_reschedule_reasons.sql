-- Seed telemarketing-specific rejection and reschedule reasons for the outcome modal.
-- These appear in the reason dropdown when a telemarketer rejects scheduling or reschedules.

-- Rejection reasons (رفض الجدولة)
INSERT INTO system_lists (category, value, is_active, display_order) VALUES
  ('telemarketing_rejection_reason', 'تجاوز عدد محاولات الاتصال', TRUE, 1),
  ('telemarketing_rejection_reason', 'الرقم خاطئ أو غير صالح',     TRUE, 2),
  ('telemarketing_rejection_reason', 'طلب عدم الاتصال به',          TRUE, 3),
  ('telemarketing_rejection_reason', 'غير مهتم نهائياً',             TRUE, 4),
  ('telemarketing_rejection_reason', 'خارج نطاق الخدمة',            TRUE, 5),
  ('telemarketing_rejection_reason', 'أخرى',                        TRUE, 6)
ON CONFLICT DO NOTHING;

-- Follow-up / reschedule reasons for telemarketing (متابعة لاحقاً)
INSERT INTO system_lists (category, value, is_active, display_order) VALUES
  ('telemarketing_reschedule_reason', 'الزبون مشغول حالياً',        TRUE, 1),
  ('telemarketing_reschedule_reason', 'طلب المتابعة لاحقاً',        TRUE, 2),
  ('telemarketing_reschedule_reason', 'لديه جهاز من شركة أخرى',    TRUE, 3),
  ('telemarketing_reschedule_reason', 'اطّلع على العرض سابقاً',     TRUE, 4),
  ('telemarketing_reschedule_reason', 'أخرى',                       TRUE, 5)
ON CONFLICT DO NOTHING;
