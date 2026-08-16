function valueOrDash(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
function yesNoUnknown(value: unknown) {
  return value === true ? 'نعم' : value === false ? 'لا' : 'لم يحدد';
}
function Field({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold text-slate-500">{label}</div>
    <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800">{valueOrDash(value)}</div>
  </div>;
}
export default function AgentLicensePanel({ request }: { request: any }) {
  const applicant = request.submittedPayload?.applicant ?? request.requesterExternal ?? {};
  const form = request.submittedPayload?.data ?? {};
  const address = request.serviceAddress ?? {};
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  return <div className="space-y-4">
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Field label="الاسم الأول" value={applicant.firstName} />
      <Field label="اسم الأب" value={applicant.middleName} />
      <Field label="الكنية" value={applicant.lastName} />
      <Field label="رقم الهوية" value={applicant.idNumber} />
      <Field label="تاريخ الميلاد" value={applicant.birthDate} />
      <Field label="رقم الموبايل الرئيسي" value={applicant.primary_phone} />
      <Field label="واتساب الرقم الرئيسي" value={yesNoUnknown(applicant.primaryPhoneHasWhatsapp)} />
      <Field label="رقم الموبايل الثانوي" value={applicant.secondary_phone} />
      <Field label="واتساب الرقم الثانوي" value={yesNoUnknown(applicant.secondaryPhoneHasWhatsapp)} />
      <Field label="يوجد سجل تجاري" value={yesNoUnknown(form.hasCommercialRegistration)} />
      <Field label="رقم السجل التجاري" value={form.commercialRegistrationNumber} />
      <Field label="نوع النشاط التجاري" value={form.businessActivityType} />
      <Field label="سنوات الخبرة" value={form.yearsOfExperience} />
      <Field label="الخبرات السابقة" value={form.previousExperience} />
      <Field label="وصف العمل الحالي" value={form.currentJobDescription} />
      <Field label="المحافظة" value={applicant.addressLabels?.governorate ?? address.labels?.governorate} />
      <Field label="المنطقة" value={applicant.addressLabels?.cityOrArea ?? address.labels?.city_or_area} />
      <Field label="الناحية" value={applicant.addressLabels?.subArea ?? address.labels?.sub_area} />
      <Field label="الحي" value={applicant.addressLabels?.neighborhood ?? address.labels?.neighborhood} />
      <Field label="العنوان التفصيلي" value={applicant.detailedAddress} />
      <Field label="الإحداثيات" value={applicant.location ? `${applicant.location.lat}, ${applicant.location.lng}` : null} />
      <Field label="ملاحظات إضافية" value={form.additionalNotes} />
    </section>
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h3 className="font-bold text-slate-800">المستندات والصور</h3>
      {attachments.length === 0 ? <p className="mt-2 text-sm text-slate-500">لا توجد مرفقات.</p> :
        <div className="mt-2 flex flex-wrap gap-2">{attachments.map((attachment: any, index: number) =>
          <a key={`${attachment.url}-${index}`} href={attachment.url} target="_blank" rel="noreferrer"
            className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700">
            {attachment.category === 'document' ? 'مستند' : 'صورة'} {index + 1}
          </a>)}</div>}
    </section>
  </div>;
}
