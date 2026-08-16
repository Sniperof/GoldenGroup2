import { CheckCircle2, HardDrive, Link2, MapPin, UserRound, UsersRound } from 'lucide-react';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fullName(party: any): string {
  if (!party || typeof party !== 'object') return '';
  return text(party.name)
    || [text(party.firstName), text(party.fatherName ?? party.middleName), text(party.lastName)]
      .filter(Boolean)
      .join(' ');
}

function phone(party: any, key: 'primary' | 'secondary'): string {
  if (!party || typeof party !== 'object') return '';
  const value = text(key === 'primary' ? party.primary_phone : party.secondary_phone);
  if (!value) return '';
  const hasWhatsapp = key === 'primary'
    ? party.primaryPhoneHasWhatsapp
    : party.secondaryPhoneHasWhatsapp;
  return `${value}${hasWhatsapp === true ? ' · واتساب' : ''}`;
}

function Field({ label, value }: { label: string; value: unknown }) {
  const empty = value == null || value === '';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${empty ? 'text-slate-300' : 'text-slate-800'}`}>
        {empty ? 'غير متوفر' : String(value)}
      </div>
    </div>
  );
}

function LinkStatus({ id, name, required = false }: { id?: number | null; name?: string | null; required?: boolean }) {
  const linked = id != null;
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${
      linked
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : required
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {linked ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Link2 className="h-4 w-4 shrink-0" />}
      {linked
        ? `مرتبط: ${name ?? `السجل #${id}`}`
        : required ? 'غير مرتبط · مطلوب قبل الحسم أو التسليم' : 'غير مرتبط · اختياري'}
    </div>
  );
}

function PartyCard({
  title,
  party,
  clientId,
  clientName,
  required,
  emptyMessage,
  accent,
}: {
  title: string;
  party: any;
  clientId?: number | null;
  clientName?: string | null;
  required?: boolean;
  emptyMessage: string;
  accent: 'sky' | 'emerald' | 'violet';
}) {
  const accents = {
    sky: 'border-sky-200 bg-sky-50/40 text-sky-600',
    emerald: 'border-emerald-200 bg-emerald-50/40 text-emerald-600',
    violet: 'border-violet-200 bg-violet-50/40 text-violet-600',
  };
  const name = fullName(party);
  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${accents[accent]}`}>
      <div className="mb-3 flex items-center gap-2">
        <UserRound className="h-5 w-5" />
        <h3 className="text-base font-black text-slate-800">{title}</h3>
      </div>
      <div className="mb-3">
        <LinkStatus id={clientId} name={clientName} required={required} />
      </div>
      {name || phone(party, 'primary') || phone(party, 'secondary') ? (
        <div className="grid gap-2">
          <Field label="الاسم" value={name || clientName} />
          <Field label="رقم الهاتف الأساسي" value={phone(party, 'primary')} />
          <Field label="رقم الهاتف الثانوي" value={phone(party, 'secondary')} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-5 text-center text-sm font-semibold text-slate-500">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function geoPath(address: any): string {
  const labels = address?.labels ?? {};
  return [
    labels.governorate ?? address?.governorate,
    labels.city_or_area ?? labels.cityOrArea ?? address?.city_or_area ?? address?.district,
    labels.sub_area ?? labels.subArea ?? address?.sub_area ?? address?.subArea,
    labels.neighborhood ?? address?.neighborhood,
  ].map(text).filter(Boolean).join(' / ');
}

function deviceName(request: any): string {
  const snapshot = request.reportedDeviceSnapshot ?? {};
  return text(snapshot.deviceName)
    || text(snapshot.modelName)
    || text(snapshot.name)
    || text(request.externalDeviceName)
    || text(request.installedDeviceName)
    || (request.installedDeviceId ? `جهاز مسجل #${request.installedDeviceId}` : '');
}

function deviceInterests(request: any): string {
  if (!Array.isArray(request.deviceInterests)) return '';
  return request.deviceInterests
    .map((entry: any) => text(entry?.snapshot?.nameAr) || text(entry?.snapshot?.name) || text(entry?.snapshot?.modelName))
    .filter(Boolean)
    .join('، ');
}

function partyFromClientSnapshot(snapshot: any): any {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  const secondary = contacts.find((contact: any) => text(contact?.number) && text(contact.number) !== text(snapshot.primaryMobile));
  return {
    name: snapshot.fullName,
    firstName: snapshot.firstName,
    fatherName: snapshot.fatherName,
    lastName: snapshot.lastName,
    primary_phone: snapshot.primaryMobile,
    secondary_phone: secondary?.number,
    secondaryPhoneHasWhatsapp: secondary?.hasWhatsApp,
    detailedAddress: snapshot.address?.detailedAddress,
  };
}

export default function RequestOverviewSummary({
  request,
  showDevice = false,
  requesterSnapshot,
  beneficiarySnapshot,
  referrerSnapshot,
}: {
  request: any;
  showDevice?: boolean;
  requesterSnapshot?: any;
  beneficiarySnapshot?: any;
  referrerSnapshot?: any;
}) {
  const submitted = request.submittedPayload?.data ?? request.submittedPayload?.applicant ?? {};
  const requester = { ...partyFromClientSnapshot(requesterSnapshot), ...(request.requesterExternal ?? submitted ?? {}) };
  const beneficiary = { ...partyFromClientSnapshot(beneficiarySnapshot), ...(request.beneficiaryExternal ?? requester) };
  const mediator = request.referrerExternal || referrerSnapshot
    ? { ...partyFromClientSnapshot(referrerSnapshot), ...(request.referrerExternal ?? {}) }
    : null;
  const isNameNomination = request.requestType === 'name_nomination';
  const mediatorParty = isNameNomination && !mediator ? requester : mediator;
  const address = request.serviceAddress ?? beneficiarySnapshot?.address ?? beneficiary?.address ?? {};
  const detailedAddress = text(address.detailedAddress)
    || text(address.detailed_address)
    || text(address.address_text)
    || text(beneficiary?.detailedAddress);
  const nominations = Array.isArray(request.nameNominationItems) ? request.nameNominationItems : [];
  const isDeviceRequest = request.requestType === 'device_request';
  const requestedDevices = deviceInterests(request);
  const mediatorEmptyMessage = request.requestType === 'golden_warranty'
    ? 'الوسيط غير مطبق على طلب الكفالة الذهبية.'
    : request.requestType === 'agent_license'
      ? 'الوسيط غير مطبق على طلب الترخيص الذاتي.'
      : 'لم يُحدّد وسيط لهذا الطلب.';
  const installedDeviceLabel = request.installedDeviceId
    ? `${text(request.installedDeviceName) || 'جهاز مسجل'} (#${request.installedDeviceId})`
    : '';

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-sky-600" />
          <div>
            <h2 className="text-lg font-black text-slate-800">الأطراف والتواصل</h2>
            <p className="text-sm text-slate-500">الأدوار مستقلة، والربط لا يغيّر اللقطة التي قُدّمت مع الطلب.</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <PartyCard
            title="مقدم الطلب"
            party={requester}
            clientId={request.requesterClientId}
            clientName={request.requesterClientName}
            emptyMessage="لم تتوفر بيانات مقدم الطلب في اللقطة."
            accent="sky"
          />
          {isNameNomination ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-emerald-600">
                <UserRound className="h-5 w-5" />
                <h3 className="text-base font-black text-slate-800">المستفيدون</h3>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-white/70 p-3 text-sm font-bold text-emerald-800">
                {nominations.length > 0 ? `${nominations.length} اسم مرشح ببيانات مستقلة` : 'لا توجد أسماء مرشحة في الطلب.'}
              </div>
              <p className="mt-3 text-xs text-slate-500">تظهر هواتف وعناوين المستفيدين في جدول الأسماء أدناه.</p>
            </section>
          ) : (
            <PartyCard
              title="المستفيد"
              party={beneficiary}
              clientId={request.beneficiaryClientId}
              clientName={request.beneficiaryClientName ?? request.beneficiaryCandidateName}
              required={request.requestType !== 'agent_license'}
              emptyMessage="لم تتوفر بيانات المستفيد في اللقطة."
              accent="emerald"
            />
          )}
          <PartyCard
            title="الوسيط"
            party={mediatorParty}
            clientId={isNameNomination && !mediator ? request.requesterClientId : request.referrerClientId}
            clientName={isNameNomination && !mediator ? request.requesterClientName : request.referrerClientName}
            emptyMessage={mediatorEmptyMessage}
            accent="violet"
          />
        </div>
        {isNameNomination && !mediator && (
          <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">
            في طلب ترشيح الأسماء يكون مقدم الطلب هو الوسيط للأسماء المرشحة.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-black text-slate-800">عنوان المستفيد والتغطية</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="المسار الجغرافي" value={isNameNomination ? 'مستقل لكل اسم مرشح' : geoPath(address)} />
          <Field label="العنوان التفصيلي" value={isNameNomination ? 'يعرض ضمن كل اسم عند توفره' : detailedAddress} />
          <Field label="الفرع المرتبط" value={request.branchName} />
          <Field label="حالة حل التغطية" value={request.branchResolutionLabel} />
        </div>
        {request.branchResolutionStatus && !['resolved', 'not_applicable'].includes(request.branchResolutionStatus) && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {request.branchResolutionReason ?? 'يحتاج ربط الفرع إلى مراجعة.'}
          </p>
        )}
      </section>

      {showDevice && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-sky-600" />
            <h2 className="text-lg font-black text-slate-800">الجهاز</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label={isDeviceRequest ? 'الأجهزة المطلوبة' : 'الجهاز كما ورد في الطلب'} value={requestedDevices || deviceName(request)} />
            <Field label="الرقم التسلسلي" value={isDeviceRequest ? 'غير مطبق' : request.reportedDeviceSnapshot?.serialNumber ?? request.externalDeviceSerial ?? request.installedDeviceSerial} />
            <Field label="الجهاز المركب المرتبط" value={isDeviceRequest ? 'غير مطبق' : installedDeviceLabel} />
            <Field
              label={isDeviceRequest ? 'حالة بيانات الجهاز' : 'حالة المطابقة'}
              value={isDeviceRequest
                ? (requestedDevices ? 'تم حفظ خيارات مقدم الطلب' : 'لم يحدد مقدم الطلب جهازاً')
                : request.installedDeviceId ? 'مرتبط بجهاز مسجل' : 'لم يُربط بجهاز مسجل'}
            />
          </div>
        </section>
      )}
    </div>
  );
}
