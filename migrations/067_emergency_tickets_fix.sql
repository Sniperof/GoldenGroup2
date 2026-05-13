-- call_receiver صار nullable لأنه بيتعبّأ تلقائياً من المستخدم الحالي
ALTER TABLE emergency_tickets
  ALTER COLUMN call_receiver DROP NOT NULL;
