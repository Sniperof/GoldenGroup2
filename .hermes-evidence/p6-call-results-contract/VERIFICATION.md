# VERIFICATION — message_sent investigation

## Root Causes Found (4 issues)

### Issue 1 — Silent failure in addCallLog (CRITICAL)
`useTelemarketingStore.ts:82-87` — try/catch swallowed all errors:
```typescript
// BEFORE (broken)
try {
    const saved = await api.telemarketing.createCallLog(newLog);
    set(state => ({ callLogs: [saved, ...state.callLogs] }));
} catch (error) {
    console.error('Failed to save telemarketing call log:', error);
    // caller gets void — no error propagated
}
```
If the API returned 4xx/5xx, the log was never added to the store and the user saw nothing wrong.

**Fix:** Removed try/catch. `addCallLog` now throws on failure.
`handleSaveOutcome` wraps it in try/catch and sets `callLogSaveError` state → shown as a red banner.

---

### Issue 2 — cellular_text mapped to communicationMethod='phone' (WRONG ICON)
`TelemarketerWorkspace.tsx:367-371`:
```typescript
// BEFORE
if (ch === 'whatsapp_text') communicationMethod = 'whatsapp_text';
else if (ch === 'whatsapp_call') communicationMethod = 'whatsapp_voice';
else communicationMethod = 'phone';  // cellular_text fell here
```
Result: `communicationMethod = 'phone'` → `isWhatsApp = false` → Headset icon (phone).

**Fix:** Added `'cellular_text'` branch. Also added `'cellular_text'` to `CallLog.communicationMethod` type in `shared/types.ts`.

---

### Issue 3 — "محاولة تواصل" label for text messages (MISLEADING)
Journey events used "محاولة تواصل" for ALL call logs including message_sent.

**Fix:** Shows "رسالة مُرسَلة" when `log.outcome === 'message_sent'` + "منتظر رد" badge.

---

### Issue 4 — MessageSquare icon not shown for cellular text (WRONG ICON)
`isWhatsApp` check only caught whatsapp, not cellular_text.

**Fix:** `isTextMsg = log.outcome === 'message_sent' || log.communicationMethod === 'cellular_text'`
→ MessageSquare icon for all text messages. Amber color scheme to distinguish from calls.

---

## Build Verification
```
✓ built in 6.67s  (no TypeScript errors)
PM2: golden-crm-staging online
```

## Verification Steps
1. Send a text message (cellular_text or whatsapp_text) in TelemarketerWorkspace
2. Verify call log appears immediately in journey tab with:
   - MessageSquare icon (not phone headset)
   - "رسالة مُرسَلة" header
   - "منتظر رد" amber badge
   - "تعديل نتيجة الرسالة" button
3. If API is offline/errors: red banner appears at bottom of panel with dismiss button
