# Mobile Recruitment API Reference

**Audience:** Mobile application developers
**Feature:** Public vacancy discovery and direct job application submission
**Authentication:** None
**Content type:** `application/json`, except file upload
**Post-submission communication:** External; the mobile application does not track application status

## 1. Scope and Product Flow

This integration allows a mobile user to:

1. view job vacancies that are currently open for applications;
2. open the details of a specific vacancy;
3. optionally upload a CV or personal photo;
4. submit a direct application for that vacancy;
5. receive an immediate submission confirmation.

The recruitment team contacts the applicant externally using the contact details supplied in the application. The mobile application must not provide a **My Applications**, application-status, withdrawal, editing, interview, or messaging flow.

The minimum navigation flow is:

```text
Vacancies
  -> GET /api/public/vacancies
Vacancy details
  -> GET /api/public/vacancies/{vacancyId}
Optional CV or photo upload
  -> POST /api/upload
Application form
  -> POST /api/public/applications
Submission confirmation
  -> show the returned application ID as an optional reference
```

## 2. Base URL and Common Rules

Use the API origin configured for the target environment:

```text
{API_BASE_URL}/api/public/vacancies
```

Examples in this document use relative paths. Do not hard-code a development, staging, or production hostname in the mobile application.

The recruitment endpoints in this guide are public:

- do not require a Bearer token;
- do not require OTP verification;
- do not require an app account;
- do not require `X-Device-Id` or `X-Visitor-Handle`;
- do not require `X-Branch-Id`.

For JSON requests, send:

```http
Accept: application/json
Content-Type: application/json
```

The public API surface is rate-limited by IP. A `429 Too Many Requests` response must be treated as retryable after a user-visible delay. Avoid reloading the vacancy list on every render.

## 3. Vacancy Availability Rule

A vacancy is available for public display and application only when:

```text
status = Open
and
current date is between startDate and endDate, inclusive
```

The server rechecks this rule inside the application-creation transaction. A vacancy may therefore be visible when the form opens but unavailable when the user submits it.

The current server does not include `vacancyCount > 0` in this availability rule. Mobile must display `vacancyCount`, but it must rely on the submission response as the final authority on whether an application was accepted.

## 4. List Available Vacancies

```http
GET /api/public/vacancies
Accept: application/json
```

### Successful Response (`200 OK`)

The response is a JSON array, not a paginated envelope:

```json
[
  {
    "id": 15,
    "title": "Sales Representative",
    "branch": "Damascus Branch",
    "governorate": "Damascus",
    "cityOrArea": "Al-Mazzeh",
    "subArea": null,
    "neighborhood": null,
    "detailedAddress": "Al-Mazzeh Highway",
    "workType": "Full Time",
    "requiredGender": "Male",
    "requiredAgeMin": 20,
    "requiredAgeMax": 35,
    "email": null,
    "requiredCertificate": "Secondary School",
    "requiredMajor": null,
    "requiredExperienceYears": 1,
    "requiredSkills": "Communication and sales skills",
    "responsibilities": "Customer visits and product sales",
    "drivingLicenseRequired": true,
    "hasCarRequired": false,
    "vacancyCount": 2,
    "startDate": "2026-08-01",
    "endDate": "2026-08-31",
    "status": "Open"
  }
]
```

An empty result is returned as:

```json
[]
```

### Current Query Behavior

The route documentation mentions `branchId`, `search`, `page`, and `limit`, but the current runtime implementation ignores them. Do not depend on server-side search, branch filtering, or pagination until the backend explicitly implements and tests those parameters.

If the mobile product requires search before that change, filter the received list locally. Treat this as a temporary client behavior, because the endpoint may later become paginated.

## 5. Get Vacancy Details

```http
GET /api/public/vacancies/{vacancyId}
Accept: application/json
```

`vacancyId` is the `id` returned by the list endpoint.

### Successful Response (`200 OK`)

The response is one vacancy object with the same public fields returned by the list endpoint.

### Unavailable Vacancy (`404 Not Found`)

The endpoint deliberately returns the same result when the vacancy is missing or no longer applicable:

```json
{
  "error": "الوظيفة غير متاحة"
}
```

On `404`, close or disable the application form and show a neutral message such as:

```text
This vacancy is no longer available for applications.
```

## 6. Optional Geography Selector

The public geography endpoints may be used to provide a consistent address selector:

```http
GET /api/public/areas
GET /api/public/areas?parent_id={areaId}
GET /api/public/areas/search?q={text}&limit={1..20}
```

Only active areas are returned. Search text must contain 2 to 80 characters; `limit` defaults to 15 and must be between 1 and 20.

Important recruitment-specific rule: the job-application API currently stores and accepts geographic **names**, not numeric SmartGeo IDs. After the user selects an area, submit the returned `name` values as:

- `applicant.governorate`;
- `applicant.cityOrArea`;
- `applicant.subArea`;
- `applicant.neighborhood`.

Do not submit the numeric area IDs in these four application fields. Numeric IDs are used by other mobile contracts, but they are not the current recruitment application contract.

`governorate` is required. The deeper administrative levels are optional. `detailedAddress` is required and remains free text.

## 7. Optional CV or Photo Upload

Upload each file separately before submitting the application:

```http
POST /api/upload
Content-Type: multipart/form-data
```

The multipart field name must be `file`.

Example cURL request:

```bash
curl -X POST "${API_BASE_URL}/api/upload" \
  -F "file=@candidate-cv.pdf"
```

### Successful Response (`200 OK`)

```json
{
  "url": "/uploads/1723456789_candidate-cv.pdf"
}
```

Pass the returned URL unchanged as `applicant.cvUrl` or `applicant.photoUrl`. The URL may be relative; resolve it against the API origin only when displaying or downloading it.

Currently accepted extensions include:

- CV documents: `.pdf`, `.doc`, `.docx`;
- images: `.jpg`, `.jpeg`, `.png`, `.webp`.

The server upload limit is currently 150 MB and the generic route also accepts video formats. The recruitment UI should apply a much smaller product-level size limit and should expose only document formats for CVs and image formats for photos. A CV and a photo are both optional.

If an optional upload fails, the user may retry it or explicitly continue without that attachment. Do not submit a locally generated file path; submit only the server URL returned by this endpoint.

## 8. Submit a Direct Job Application

```http
POST /api/public/applications
Accept: application/json
Content-Type: application/json
```

For the mobile application, always send:

```json
{
  "submissionType": "Apply",
  "applicationSource": "Mobile App"
}
```

`submissionType` has no effective server default and must be present. Although `applicationSource` defaults to `Website` when omitted, the mobile client must explicitly send `Mobile App` so that recruitment reporting records the correct source.

### Complete Request Example

```json
{
  "jobVacancyId": 15,
  "submissionType": "Apply",
  "applicationSource": "Mobile App",
  "applicant": {
    "firstName": "Ahmad",
    "lastName": "Mohammad",
    "dob": "1998-05-14",
    "gender": "Male",
    "maritalStatus": "Single",
    "email": "ahmad@example.com",
    "mobileNumber": "0991234567",
    "secondaryMobile": null,
    "governorate": "Damascus",
    "cityOrArea": "Al-Mazzeh",
    "subArea": null,
    "neighborhood": null,
    "detailedAddress": "Al-Mazzeh, Example Street, Building 12",
    "academicQualification": "Bachelor Degree",
    "specialization": "Business Administration",
    "previousEmployment": "Sales Representative",
    "drivingLicense": true,
    "hasCar": false,
    "expectedSalary": 3000000,
    "computerSkills": "Microsoft Office",
    "foreignLanguages": "English",
    "yearsOfExperience": 2,
    "cvUrl": "/uploads/1723456789_candidate-cv.pdf",
    "photoUrl": null,
    "applicantSegment": null,
    "hasWhatsappPrimary": true,
    "hasWhatsappSecondary": false
  }
}
```

### Minimum Valid Request

```json
{
  "jobVacancyId": 15,
  "submissionType": "Apply",
  "applicationSource": "Mobile App",
  "applicant": {
    "firstName": "Ahmad",
    "lastName": "Mohammad",
    "dob": "1998-05-14",
    "gender": "Male",
    "maritalStatus": "Single",
    "mobileNumber": "0991234567",
    "governorate": "Damascus",
    "detailedAddress": "Al-Mazzeh, Example Street",
    "hasCar": false
  }
}
```

## 9. Application Request Fields

### Top-Level Fields

| Field | Type | Required | Mobile rule |
|---|---|---:|---|
| `jobVacancyId` | positive integer | Yes | Use the selected public vacancy ID. |
| `submissionType` | string | Yes | Send exactly `Apply`. |
| `applicationSource` | string | Yes for mobile | Send exactly `Mobile App`. |
| `applicant` | object | Yes | Applicant identity, contact, address, and qualifications. |

Do not send `enteredByUserId`, `enteredByName`, `duplicateFlag`, `branchId`, stage, status, decision, archive, escalation, interview, or internal-note fields. They are server or CRM concerns.

### Applicant Fields

| Field | Type | Required by API | Description |
|---|---|---:|---|
| `firstName` | non-empty string | Yes | Applicant first name. |
| `lastName` | non-empty string | Yes | Applicant family name. |
| `dob` | `YYYY-MM-DD` string | Yes | Applicant date of birth. |
| `gender` | non-empty string | Yes | Use the mobile product's agreed value set. |
| `maritalStatus` | non-empty string | Yes | Use the mobile product's agreed value set. |
| `mobileNumber` | string | Yes | Digits only; server accepts 10 or 11 digits. |
| `email` | string or null | No | When provided, must be a syntactically valid email. |
| `secondaryMobile` | string or null | No | Secondary contact number. |
| `governorate` | non-empty string | Yes | Selected governorate name, not its ID. |
| `cityOrArea` | string or null | No | Selected city or area name. |
| `subArea` | string or null | No | Selected sub-area name. |
| `neighborhood` | string or null | No | Selected neighborhood name. |
| `detailedAddress` | non-empty string | Yes | Free-text address. |
| `hasCar` | boolean | Yes | Must be a JSON boolean; both `true` and `false` are valid. |
| `academicQualification` | string or null | No | Academic certificate or qualification. |
| `specialization` | string or null | No | Academic specialization. |
| `previousEmployment` | string or null | No | Previous employment summary. |
| `drivingLicense` | boolean or string | No | Use a boolean in the mobile payload. |
| `expectedSalary` | integer or numeric string | No | Parsed and stored as an integer. |
| `computerSkills` | string or null | No | Free-text skills. |
| `foreignLanguages` | string or null | No | Send one display string, for example `English, French`. |
| `yearsOfExperience` | non-negative integer or numeric string | No | Parsed and stored as an integer. |
| `cvUrl` | string or null | No | URL returned by `/api/upload`. |
| `photoUrl` | string or null | No | URL returned by `/api/upload`. |
| `applicantSegment` | string or null | No | Omit or send `null` unless the product defines this field. |
| `hasWhatsappPrimary` | boolean | No | Defaults to `false`. |
| `hasWhatsappSecondary` | boolean | No | Defaults to `false`. |

The backend currently enforces only non-empty values for `gender` and `maritalStatus`; it does not enforce a shared enum. Mobile must nevertheless use one consistent product-defined value set rather than arbitrary localized labels.

## 10. Successful Submission

### Response (`201 Created`)

```json
{
  "id": 208,
  "jobVacancyId": 15,
  "applicantId": 341,
  "referrerId": null,
  "branchId": 3,
  "submissionType": "Apply",
  "applicationSource": "Mobile App",
  "currentStage": "Submitted",
  "applicationStatus": "New",
  "duplicateFlag": false,
  "createdAt": "2026-08-12T10:30:00.000Z"
}
```

The response confirms that the application transaction was committed. `id` is the job-application reference. The mobile application may display or log it for support purposes, but it does not need to retain it for application tracking because no mobile tracking flow is in scope.

Recommended confirmation text:

```text
Your job application has been received successfully. The recruitment team will contact you using the contact details you provided if you are selected for the next step.
```

Do not promise a response time, acceptance, interview, or employment. A successful submission means only that the application was received.

## 11. Validation and Error Contract

Error responses use a JSON object containing at least `error`:

```json
{
  "error": "Human-readable message"
}
```

### `400 Bad Request`

Returned when required applicant data is missing or invalid. Examples include:

- missing first or last name;
- missing or invalid mobile number;
- invalid email syntax;
- missing date of birth;
- missing gender or marital status;
- missing governorate or detailed address;
- missing boolean `hasCar`;
- missing or invalid `submissionType`;
- invalid `applicationSource`.

The server currently accepts these application-source values:

```text
Mobile App
Website
External Platforms
Internal
```

The mobile client must use `Mobile App`.

### `409 Conflict`: Vacancy Is Not Applicable

Returned if the vacancy is missing, closed, archived, not yet open, or expired when submission is processed:

```json
{
  "error": "الشاغر غير موجود أو غير متاح للتقديم",
  "code": "vacancy_not_applicable"
}
```

Use `code`, not the localized message, for program logic. Return the user to the vacancy list or disable the current form.

### `409 Conflict`: Existing Active Application

Only one active application is allowed for the same mobile number and vacancy:

```json
{
  "error": "يوجد طلب نشط بالفعل لهذا الرقم والشاغر الوظيفي",
  "duplicateApplicationId": 208
}
```

Show a neutral message such as:

```text
An active application already exists for this phone number and vacancy.
```

Do not expose internal application status or infer that the earlier application was accepted.

A prior terminal application does not block a new submission. In that case, the server accepts the new application and returns `duplicateFlag: true` for internal review.

### Other Status Codes

| Status | Meaning | Mobile behavior |
|---:|---|---|
| `404` | Vacancy detail is unavailable | Show a not-available state and return to the list. |
| `413` | JSON request body is too large | Ask the user to reduce the request size. |
| `429` | Public rate limit exceeded | Show a temporary-rate-limit message and delay retry. |
| `500` | Internal persistence or server failure | Show a generic retry message; never display raw server internals. |

The generic upload route does not currently map Multer's file-size error to a dedicated `413` response and may return `500` for an oversized upload. Mobile should enforce its own smaller attachment limit before upload and treat any non-successful upload as an attachment failure rather than an application-submission result.

## 12. Retry and Duplicate Handling

`POST /api/public/applications` does not currently support an `Idempotency-Key` header. Therefore:

- disable the submit button while a request is in progress;
- do not send concurrent submissions;
- do not automatically retry a timed-out POST without user awareness;
- if a retry returns `409` with `duplicateApplicationId`, tell the user that an active application already exists;
- never create a local success state before receiving `201` or a confirmed duplicate response.

The duplicate rule is based on normalized business identity at the current backend boundary: the same submitted mobile-number string and the same vacancy ID.

## 13. Recommended Mobile State Model

```ts
type Vacancy = {
  id: number;
  title: string;
  branch: string;
  governorate: string | null;
  cityOrArea: string | null;
  subArea: string | null;
  neighborhood: string | null;
  detailedAddress: string | null;
  workType: string | null;
  requiredGender: string | null;
  requiredAgeMin: number | null;
  requiredAgeMax: number | null;
  email: string | null;
  requiredCertificate: string | null;
  requiredMajor: string | null;
  requiredExperienceYears: number | null;
  requiredSkills: string | null;
  responsibilities: string | null;
  drivingLicenseRequired: boolean;
  hasCarRequired: boolean;
  vacancyCount: number;
  startDate: string;
  endDate: string;
  status: 'Open';
};

type ApplicationSubmissionResponse = {
  id: number;
  jobVacancyId: number;
  applicantId: number;
  referrerId: null;
  branchId: number;
  submissionType: 'Apply';
  applicationSource: 'Mobile App';
  currentStage: 'Submitted';
  applicationStatus: 'New';
  duplicateFlag: boolean;
  createdAt: string;
};
```

Fields marked nullable must not be rendered as the string `null`. Hide the row or show an appropriate localized fallback.

## 14. Loading, Empty, and Failure States

The mobile implementation should provide:

- a loading state while retrieving vacancies;
- an empty state when the list response is `[]`;
- a retry action for network and `500` failures;
- an unavailable state for vacancy-detail `404`;
- an upload progress state when attachments are selected;
- a single in-progress state while the application is being submitted;
- a final confirmation state after `201`;
- a clear existing-application state after duplicate `409`.

Do not retain a draft containing identity documents or personal data longer than necessary. Clear sensitive form and attachment state after confirmed submission.

## 15. Out of Scope

The following features are intentionally outside the mobile recruitment integration:

- user authentication for recruitment;
- My Applications;
- application-status retrieval;
- application editing or withdrawal;
- interview or training schedules;
- in-app communication with recruitment staff;
- push notifications about recruitment decisions;
- CRM review, qualification, interview, training, or hiring actions;
- candidate referral (`Refer a Candidate`) from the mobile application.

All post-submission communication is external and uses the contact information supplied by the applicant.

## 16. Mobile Acceptance Checklist

- [ ] The vacancy list uses `GET /api/public/vacancies` and handles a raw array response.
- [ ] The vacancy details screen uses the selected numeric `id`.
- [ ] The application form is disabled when vacancy details return `404`.
- [ ] `submissionType` is exactly `Apply`.
- [ ] `applicationSource` is exactly `Mobile App`.
- [ ] `mobileNumber` contains only 10 or 11 digits before submission.
- [ ] `hasCar` is always sent as a JSON boolean, including when it is `false`.
- [ ] Geographic names, not IDs, are submitted in the current recruitment payload.
- [ ] Optional upload URLs come only from a successful `/api/upload` response.
- [ ] The submit button prevents concurrent requests.
- [ ] `vacancy_not_applicable` and duplicate `409` responses have different user messages.
- [ ] Success text states that the request was received and that later contact is external.
- [ ] No application tracking, status, or withdrawal screen is implemented.
