// ============================================================
// services/appNotifications/notificationCatalog.ts
// ============================================================
// DEC-019 D-N1 + D-N13 — the closed list of notification types, the screen each
// one points at, and the ready text stored on the row.
//
// Text is composed HERE and stored verbatim (D-N13): there is no template key
// and no render-time localization. The language is chosen once, at creation,
// from the recipient's newest device registration.
//
// The `destination` belongs to the type, not to the caller. A caller supplies
// only the id of the thing it is talking about; it cannot send a maintenance
// notification to the warranty screen.
// ============================================================

export type NotificationType =
  | 'service_request_status_changed'
  | 'visit_scheduled'
  | 'visit_cancelled'
  | 'visit_completed'
  | 'visit_reminder'
  | 'maintenance_due'
  | 'warranty_expiring'
  | 'warranty_activated'
  | 'complaint_update'
  | 'general';

export type NotificationLocale = 'ar' | 'en';

/**
 * Wire values the mobile destination resolver understands (§E.1).
 *
 * `visit` is pending on the mobile side — it is one of the mandatory asks in
 * DEC-019 §3. Until that ships, a visit notification opens the notifications
 * list instead of the visit, which is the app's documented fallback for an
 * unknown destination. That is a degraded landing, not a broken payload, so we
 * send the correct value now rather than encoding their gap in our data.
 */
export type NotificationDestination =
  | 'service_request'
  | 'visit'
  | 'device'
  | 'warranty'
  | 'complaint'
  /**
   * Opens the INTAKE FORM for a request type — not an existing request.
   *
   * The odd one out: its `destination_id` is a request_type slug
   * (`water_check`, `periodic_maintenance`, …), not a numeric entity id. The app
   * already has this route — it is the same target a home banner's
   * `target_request_type` opens — so nothing new has to be built there, only the
   * destination value mapped.
   *
   * Needed because the app has no "my requests" or "request details" screen at
   * all: `/service-request` takes `ServiceRequestArgs` and IS the intake flow.
   * So "here is your request" cannot be linked, while "submit this request" can.
   */
  | 'service_request_form';

/** Which machinery produces the type — see DEC-019 D-N1. */
export type NotificationFamily = 'reactive' | 'scheduled' | 'manual';

/** The four service-request terminals that notify (DEC-019 D-N2). */
export type NotifiableRequestStatus = 'promoted' | 'completed' | 'rejected' | 'cancelled';

/** Per-type variables. Keyed by type so call sites are checked at compile time. */
export interface NotificationVars {
  service_request_status_changed: { requestId: string | number; status: NotifiableRequestStatus };
  /** ISO date (YYYY-MM-DD). Formatted per locale by the builder, not the caller. */
  visit_scheduled: { date: string | null };
  visit_cancelled: { date: string | null };
  visit_completed: Record<string, never>;
  visit_reminder: { timeLabel?: string | null };
  maintenance_due: { deviceLabel?: string | null };
  warranty_expiring: { daysLeft: number };
  warranty_activated: Record<string, never>;
  /**
   * The message is the staff- or system-authored text already stored on the
   * complaint's public update. It is passed through verbatim rather than
   * rewritten: a resolution's public summary was written for this customer by a
   * person, and paraphrasing it would be worse than quoting it.
   */
  complaint_update: { refNumber: string; message: string };
  /** Free-form admin send (D-N6): the admin wrote both lines. */
  general: { title: string; message: string };
}

export interface NotificationText {
  title: string;
  message: string;
}

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Formats a visit date for a customer. The caller passes a bare ISO date and
 * this decides how it reads, because the language is only known per recipient —
 * one event can produce an Arabic and an English notification at once.
 *
 * Parsed at midday UTC on purpose: parsing 'YYYY-MM-DD' as midnight makes the
 * weekday slip by a day for anyone east or west of UTC, which would print the
 * wrong day name on a message whose entire purpose is telling someone which day
 * to be home.
 */
function formatVisitDate(date: string | null, locale: NotificationLocale): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const [y, m, d] = date.split('-');
  const weekday = (locale === 'ar' ? AR_WEEKDAYS : EN_WEEKDAYS)[parsed.getUTCDay()];
  return locale === 'ar' ? `${weekday} ${d}/${m}/${y}` : `${weekday}, ${d}/${m}/${y}`;
}

/**
 * Arabic counted-noun agreement for days. "خلال 7 يوماً" is wrong in a way a
 * customer notices; the two default warranty windows (30 and 7) land on
 * opposite sides of the rule, so both forms occur in production.
 */
function arabicDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

const REQUEST_STATUS_LABEL: Record<NotifiableRequestStatus, Record<NotificationLocale, string>> = {
  // 'promoted' is internal vocabulary for "became real work". The customer is
  // told what that means for them, not what our state machine called it.
  promoted: { ar: 'قيد التنفيذ', en: 'in progress' },
  completed: { ar: 'مكتمل', en: 'completed' },
  rejected: { ar: 'مرفوض', en: 'rejected' },
  cancelled: { ar: 'ملغى', en: 'cancelled' },
};

type TextBuilder<T extends NotificationType> = (
  locale: NotificationLocale,
  vars: NotificationVars[T],
) => NotificationText;

interface CatalogEntry<T extends NotificationType> {
  destination: NotificationDestination | null;
  family: NotificationFamily;
  /** True when the type carries dedup coordinates (entity_id + window_key). */
  deduped: boolean;
  text: TextBuilder<T>;
}

type Catalog = { [T in NotificationType]: CatalogEntry<T> };

export const NOTIFICATION_CATALOG: Catalog = {
  service_request_status_changed: {
    /**
     * DEPARKED to null 2026-08-18. The app has no request-details screen: its
     * `service_request` destination routes to `/service-request`, which is the
     * INTAKE form and casts `state.extra` to `ServiceRequestArgs` — so a tap
     * carrying a request id fails at runtime rather than degrading.
     *
     * Unlike `visit` and `complaint`, which the app does not recognise and
     * therefore safely falls back to the inbox for, `service_request` IS
     * recognised — so sending it is the one case that can break the app instead
     * of merely landing dully. The notification stays in the inbox until mobile
     * either builds that screen or tells us it never will (handoff §1.5).
     *
     * The request id is not lost: it rides in `data.service_request_id` (see
     * notify.ts), which the app preserves verbatim, so restoring the deep link
     * later is a one-line change here.
     */
    destination: null,
    family: 'reactive',
    deduped: false,
    text: (locale, { requestId, status }) => {
      const label = REQUEST_STATUS_LABEL[status][locale];
      return locale === 'ar'
        ? { title: 'طلب الخدمة', message: `تم تحديث حالة طلب الخدمة رقم ${requestId}: ${label}` }
        : { title: 'Service request', message: `Service request #${requestId} is now ${label}.` };
    },
  },

  visit_scheduled: {
    destination: 'visit',
    family: 'reactive',
    deduped: false,
    text: (locale, { date }) => {
      const when = formatVisitDate(date, locale);
      return locale === 'ar'
        ? {
          title: 'موعد زيارة',
          message: when ? `تم تحديد موعد زيارتك يوم ${when}` : 'تم تحديد موعد زيارتك',
        }
        : {
          title: 'Visit scheduled',
          message: when ? `Your visit is scheduled for ${when}.` : 'Your visit has been scheduled.',
        };
    },
  },

  visit_cancelled: {
    destination: 'visit',
    family: 'reactive',
    deduped: false,
    text: (locale, { date }) => {
      const when = formatVisitDate(date, locale);
      return locale === 'ar'
        ? {
          title: 'إلغاء زيارة',
          message: when ? `تم إلغاء زيارتك المقررة يوم ${when}` : 'تم إلغاء زيارتك المقررة',
        }
        : {
          title: 'Visit cancelled',
          message: when ? `Your visit on ${when} has been cancelled.` : 'Your visit has been cancelled.',
        };
    },
  },

  visit_completed: {
    destination: 'visit',
    family: 'reactive',
    deduped: false,
    text: (locale) => (locale === 'ar'
      ? { title: 'إنجاز زيارة', message: 'تم إنجاز زيارتك. شكراً لتعاونك معنا' }
      : { title: 'Visit completed', message: 'Your visit is complete. Thank you.' }),
  },

  visit_reminder: {
    destination: 'visit',
    family: 'scheduled',
    deduped: true,
    text: (locale, { timeLabel }) => (locale === 'ar'
      ? {
        title: 'تذكير بالزيارة',
        message: timeLabel
          ? `تذكير: لديك زيارة اليوم الساعة ${timeLabel}`
          : 'تذكير: لديك زيارة اليوم',
      }
      : {
        title: 'Visit reminder',
        message: timeLabel
          ? `Reminder: you have a visit today at ${timeLabel}.`
          : 'Reminder: you have a visit today.',
      }),
  },

  maintenance_due: {
    destination: 'device',
    family: 'scheduled',
    deduped: true,
    text: (locale, { deviceLabel }) => (locale === 'ar'
      ? {
        title: 'صيانة دورية',
        message: deviceLabel
          ? `حان موعد الصيانة الدورية لجهازك ${deviceLabel}`
          : 'حان موعد الصيانة الدورية لجهازك',
      }
      : {
        title: 'Periodic maintenance',
        message: deviceLabel
          ? `Periodic maintenance is due for your ${deviceLabel}.`
          : 'Periodic maintenance is due for your device.',
      }),
  },

  warranty_expiring: {
    destination: 'warranty',
    family: 'scheduled',
    deduped: true,
    text: (locale, { daysLeft }) => (locale === 'ar'
      ? { title: 'الكفالة', message: `تنتهي كفالة جهازك خلال ${arabicDays(daysLeft)}` }
      : { title: 'Warranty', message: `Your device warranty expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` }),
  },

  warranty_activated: {
    destination: 'warranty',
    family: 'reactive',
    deduped: false,
    text: (locale) => (locale === 'ar'
      ? { title: 'الكفالة', message: 'تم تفعيل كفالة جهازك' }
      : { title: 'Warranty', message: 'Your device warranty is now active.' }),
  },

  complaint_update: {
    destination: 'complaint',
    family: 'reactive',
    deduped: false,
    // Only the title is localized. The body has exactly one authored version —
    // written in Arabic by whoever handled the complaint — and there is no
    // English counterpart to switch to, so an 'en' recipient gets an English
    // heading over the original text instead of a machine paraphrase of it.
    text: (locale, { refNumber, message }) => (locale === 'ar'
      ? { title: `الشكوى ${refNumber}`, message }
      : { title: `Complaint ${refNumber}`, message }),
  },

  general: {
    // Free-form sends may or may not point somewhere; the admin decides per
    // send, so the catalog cannot fix a destination here.
    destination: null,
    family: 'manual',
    deduped: false,
    text: (_locale, { title, message }) => ({ title, message }),
  },
};

export function buildNotificationText<T extends NotificationType>(
  type: T,
  locale: NotificationLocale,
  vars: NotificationVars[T],
): NotificationText {
  return (NOTIFICATION_CATALOG[type].text as TextBuilder<T>)(locale, vars);
}

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return value === 'ar' || value === 'en';
}
