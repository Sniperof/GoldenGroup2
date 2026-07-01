# Golden CRM - Unified Service Request Intake Template

> Status: official template draft
>
> Purpose: define one repeatable structure for every request that enters Golden CRM from the mobile app, website, WhatsApp, phone, or an internal operator.
>
> Key rule: a request is an intake record first. It may later create an `open_task`, `job_application`, `candidate`, warranty action, complaint case, or another domain work item.

## 1. Why This Template Exists

The mobile app request forms are not isolated forms. They are the front door for operational work.

Every request must preserve:

- what the user submitted,
- who the request is about,
- who submitted it,
- which data was pre-filled,
- which data was edited,
- which internal record it was linked to,
- which operational work item was created after review.

The template must support people who already exist inside Golden CRM and people who are only names outside the system.

## 2. Core Principles

1. The request is not the task.
2. The submitted data is immutable after submit.
3. External names are first-class request parties, not fake clients.
4. Linking is a review decision, not an automatic assumption.
5. A request can have more than one party.
6. Every terminal decision must be audited.
7. Frontend prefill improves UX only; it is not authorization and not source of truth.
8. The final handoff must target the correct domain, not always `open_tasks`.

## 3. Canonical Request Shape

```ts
type UnifiedServiceRequest = {
  id: number;
  publicRefNumber: string;

  requestType: RequestTypeCode;
  requestSubtype: string | null;
  channel: RequestChannel;
  applicationSource: string | null;
  entryPoint: string | null;

  submitterTier: 'visitor' | 'lead' | 'fop' | 'op' | 'staff';
  submissionMode: 'for_self' | 'for_another' | 'nomination' | 'self_only';

  status: RequestStatus;
  priority: 'Critical' | 'High' | 'Normal' | 'Low' | null;

  parties: RequestParty[];

  prefillSnapshot: Record<string, unknown> | null;
  submittedPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  mismatchFlags: RequestMismatchFlag[];

  attachments: RequestAttachment[];
  duplicateFlag: boolean;
  duplicateOfRequestId: number | null;
  reviewRequiredFlag: boolean;

  linkageRequirements: LinkageRequirement[];
  handoff: RequestHandoff | null;

  branchId: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
```

## 4. Request Type Definition

Every request type must be defined once in a request type catalog.

```ts
type RequestTypeDefinition = {
  code: RequestTypeCode;
  labelAr: string;
  labelEn: string;
  enabledChannels: RequestChannel[];
  supportedSubmitterTiers: Array<'visitor' | 'lead' | 'fop' | 'op' | 'staff'>;
  submissionModes: Array<'for_self' | 'for_another' | 'nomination' | 'self_only'>;

  formSchemaCode: string;
  prefillPolicyCode: string;
  duplicatePolicyCode: string;
  linkagePolicyCode: string;
  handoffPolicyCode: string;

  defaultPriority: 'Critical' | 'High' | 'Normal' | 'Low' | null;
  slaHours: number | null;
  archiveAfterDays: number | null;
};
```

Initial request types:

| Code | Meaning | Default Handoff |
|---|---|---|
| `water_check` | Water check request | `open_task:device_demo` or future water-check task |
| `maintenance` | Emergency or periodic maintenance | `open_task:emergency_maintenance` or `open_task:periodic_maintenance` |
| `golden_warranty` | Golden warranty request | warranty activation or warranty task |
| `device_request` | Request to buy/request a device | `open_task:device_demo` |
| `name_nomination` | Nominate an external person | `candidate` then possible marketing task |
| `job_application` | Employment application | `job_application` |
| `agent_license` | Agent license application | agent/license review work item |
| `complaint` | General, technical, or device complaint | complaint case; may create a task |

## 5. Party Model

A request party is any person or entity involved in the request.

```ts
type RequestParty = {
  role:
    | 'requester'
    | 'beneficiary'
    | 'representative'
    | 'referrer'
    | 'nominated_person'
    | 'applicant'
    | 'complaint_target';

  source: 'internal_link' | 'external_snapshot' | 'mixed';
  externalSnapshot: ExternalPartySnapshot | null;
  linkedPartyRef: LinkedPartyRef | null;
  linkStatus: 'unlinked' | 'suggested' | 'linked' | 'rejected' | 'not_required';
  linkConfidence: 'exact' | 'probable' | 'weak' | 'manual' | null;
  isPrimaryContact: boolean;
};
```

### 5.1 External Names Are First-Class

An external name is a person captured from outside the system. It may be a visitor, another person the request is for, a nominated person, a referrer, a job applicant, or a complaint target.

External names must not be inserted into `clients` just because a form was submitted.

They must first live as snapshots inside the request:

```ts
type ExternalPartySnapshot = {
  displayName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;

  primaryPhone: string | null;
  primaryPhoneHasWhatsApp: boolean | null;
  secondaryPhone: string | null;
  secondaryPhoneHasWhatsApp: boolean | null;

  address: {
    governorateId: number | null;
    regionId: number | null;
    subdistrictId: number | null;
    neighborhoodId: number | null;
    detailedAddress: string | null;
    coordinates: { lat: number; lng: number } | null;
  } | null;

  nationalId: string | null;
  birthDate: string | null;
  gender: string | null;
  occupation: string | null;

  awarenessOrConsent: boolean | null;
  notes: string | null;
};
```

Linked references are separate:

```ts
type LinkedPartyRef = {
  entityType: 'client' | 'candidate' | 'hr_user' | 'employee' | 'applicant';
  entityId: number;
  linkedAt: string;
  linkedByUserId: number;
};
```

Rules:

1. Keep `externalSnapshot` forever as the submitted/request-time truth.
2. Store `linkedPartyRef` only after review or deterministic matching.
3. Do not overwrite the external snapshot when the linked internal record changes.
4. If a new marketable person must be created, create a `candidate` first, not a client.
5. If a person applies for a job, create an applicant/job application in the jobs domain.
6. If matching is uncertain, keep the party unlinked and set `reviewRequiredFlag = true`.

## 6. Prefill And Submitted Data

Each request stores two separate payloads:

```ts
type RequestDataEnvelope = {
  prefillSnapshot: {
    source: 'profile' | 'contract' | 'device' | 'none';
    capturedAt: string;
    data: Record<string, unknown>;
  } | null;

  submittedPayload: {
    capturedAt: string;
    formVersion: string;
    data: Record<string, unknown>;
  };
};
```

Rules:

1. Prefill is optional and may be edited by the user before submit.
2. Submitted payload is immutable.
3. If submitted data differs from prefill or from linked record data, write a mismatch flag.
4. Mismatch does not block creation by itself; it changes review priority.

## 7. Mismatch Flags

```ts
type RequestMismatchFlag = {
  code:
    | 'name_mismatch'
    | 'phone_mismatch'
    | 'address_mismatch'
    | 'device_mismatch'
    | 'contract_mismatch'
    | 'identity_mismatch';
  severity: 'info' | 'warning' | 'blocking';
  comparedAgainst: 'profile' | 'client' | 'candidate' | 'contract' | 'installed_device';
  details: Record<string, unknown>;
};
```

Blocking mismatches require review before handoff.

## 8. Linkage Requirements

Every request type defines what must be linked before handoff.

```ts
type LinkageRequirement = {
  partyRole: RequestParty['role'];
  requiredEntityTypes: LinkedPartyRef['entityType'][];
  requiredBefore: 'review' | 'handoff' | 'terminal_approval';
  missingBehavior: 'block' | 'allow_with_review' | 'not_applicable';
};
```

Examples:

| Request Type | Required Before Handoff |
|---|---|
| `water_check` for self | requester linked to client or candidate |
| `water_check` for another | requester and beneficiary linked or candidate-created |
| `maintenance` company device | beneficiary client + installed device |
| `maintenance` external device | beneficiary client/candidate + external device snapshot |
| `device_request` | beneficiary client or candidate |
| `name_nomination` | nominated person as candidate or linked existing person |
| `job_application` | applicant record in jobs domain |
| `golden_warranty` | client + installed device |
| `complaint` | requester snapshot; device complaint needs device or serial snapshot |

## 9. Handoff Model

```ts
type RequestHandoff = {
  targetEntityType:
    | 'open_task'
    | 'job_application'
    | 'candidate'
    | 'complaint_case'
    | 'warranty_action'
    | 'agent_license_application';

  targetEntityId: number;
  taskType: string | null;
  taskFamily: string | null;
  reason: string | null;

  createdAt: string;
  createdByUserId: number;
  sourceServiceRequestId: number;
};
```

Rules:

1. `open_tasks.source_service_request_id` must be set when the target is `open_task`.
2. The request should store `handoff.targetEntityType` and `handoff.targetEntityId`.
3. Handoff must be idempotent. Retrying must not create duplicate tasks or duplicate applications.
4. A promoted request cannot be promoted again unless a controlled split flow exists.

## 10. Status Model

Canonical statuses:

| Status | Meaning |
|---|---|
| `received` | submitted and not reviewed |
| `in_review` | claimed or being processed |
| `awaiting_customer_info` | more data is needed |
| `resolved_at_intake` | closed without downstream work |
| `rejected` | rejected by authorized reviewer |
| `promoted` | handed off to downstream work |
| `cancelled` | cancelled for operational reason |

Request-type display labels may use business wording like `New`, `Overdue`, `Marketing Visit Scheduled`, or `Warranty Activated`, but the backend state should map to the canonical statuses.

## 11. Audit Events

Minimum audit events:

| Event | When |
|---|---|
| `request_created` | request inserted |
| `party_link_suggested` | matcher suggests an internal record |
| `party_linked` | reviewer links a party |
| `candidate_created` | external name becomes candidate |
| `mismatch_flag_set` | mismatch detected |
| `duplicate_flag_set` | duplicate suspected |
| `review_required_flag_set` | request escalated |
| `customer_info_requested` | more data requested |
| `internal_note_added` | operator adds note |
| `status_changed` | any status transition |
| `handoff_created` | downstream work item created |
| `rejected_decision` | request rejected |
| `archived` | request archived |

## 12. Authorization Rules

Follow the mandatory model:

```text
identity + permission + scope + subject = decision
```

Template rules:

1. Public/mobile request creation does not grant internal visibility.
2. Internal review requires service request review permission.
3. Handoff must authorize the target domain too.
4. External party snapshots are not authorization subjects.
5. Once linked, the linked entity becomes the subject for domain-specific authorization.
6. UI visibility and prefilled profile data are not authorization controls.

## 13. Form Template

Each request form definition must include:

```ts
type RequestFormDefinition = {
  formVersion: string;
  requestType: RequestTypeCode;
  requestSubtype: string | null;
  sections: RequestFormSection[];
  validationRules: RequestValidationRule[];
  conditionalRules: RequestConditionalRule[];
  attachmentRules: RequestAttachmentRule[];
};
```

Every field must specify:

```ts
type RequestFormField = {
  key: string;
  labelAr: string;
  fieldType:
    | 'text'
    | 'textarea'
    | 'number'
    | 'date'
    | 'select'
    | 'multi_select'
    | 'radio'
    | 'checkbox'
    | 'phone'
    | 'location_picker'
    | 'map_picker'
    | 'file'
    | 'voice';
  required: boolean;
  source: 'user_input' | 'prefill_editable' | 'prefill_readonly' | 'system';
  targetPath: string;
};
```

## 14. External Name UI Requirements

Any UI section that collects a person outside the system must show it as a normal request party, not as a hidden technical block.

Required UI behavior:

1. Show the person role clearly: requester, beneficiary, referrer, nominated person, applicant.
2. Capture phone with WhatsApp flag.
3. Capture address using the shared location picker.
4. Allow save even if the person is not found in the system.
5. In admin review, show matching suggestions and let the reviewer link or create candidate/applicant.
6. Show original submitted data beside linked record data.
7. Never silently replace external submitted data with internal record data.

## 15. Request Type Checklist

Before implementing any request type, fill this checklist:

- request type code
- allowed channels
- entry points
- supported submitter tiers
- submission modes
- parties and party roles
- external party fields
- prefill rules
- required fields
- attachment rules
- duplicate policy
- mismatch policy
- required linkage before handoff
- handoff target
- target permission requirements
- audit events
- positive tests
- negative tests
- workbook/permission updates if new permissions are added

## 16. Initial Mapping

| Request Type | External Names Expected | Handoff Target |
|---|---|---|
| `water_check` | requester, beneficiary when for another, optional referrer | `open_task:device_demo` or water-check task |
| `maintenance` | requester/beneficiary, representative when for another | `open_task:emergency_maintenance` or `open_task:periodic_maintenance` |
| `golden_warranty` | requester/beneficiary, representative when for another | warranty action or warranty task |
| `job_application` | applicant, representative/referrer when for another | `job_application` |
| `agent_license` | applicant | `agent_license_application` |
| `name_nomination` | nominated person, optional referrer | `candidate` |
| `complaint` | requester, optional complaint target | `complaint_case`, optional task |
| `device_request` | requester/beneficiary, representative when for another | `open_task:device_demo` |

## 17. Step 1 Infrastructure - Request Registry

The first infrastructure step is a Service Request Registry. It must follow the
project's existing configuration style, especially `task_type_config`, but it
must not replace `task_type_config`.

The registry defines request intake types. `task_type_config` defines executable
task types. A request type may hand off to an open task, but it may also hand off
to jobs, candidates, complaints, warranties, or another domain.

### 17.1 Architectural Fit

The registry must fit the current system as follows:

1. `service_requests` remains the instance table for submitted requests.
2. The registry becomes the source of truth for allowed request types.
3. Existing maintenance request behavior becomes one registry entry, not a
   separate special pattern.
4. Open-task handoff must keep using `task_type_config` for the downstream task.
5. Jobs handoff must go through the jobs/recruitment domain.
6. Name nomination handoff must go through candidates/referrals, not clients.
7. External names remain snapshots until a reviewer links or creates a proper
   downstream record.

### 17.2 Registry Definition Shape

Each request type definition must include:

```ts
type ServiceRequestTypeDefinition = {
  code: RequestTypeCode;
  labelAr: string;
  descriptionAr: string;
  isActive: boolean;
  channels: RequestChannel[];
  submitterTiers: SubmitterTier[];
  submissionModes: SubmissionMode[];
  formDefinitionRef: {
    formVersion: string;
    source: 'database' | 'code_seeded';
  };
  partyRoles: RequestPartyRoleDefinition[];
  externalPartyPolicy: ExternalPartyPolicy;
  duplicatePolicy: DuplicatePolicy;
  mismatchPolicy: MismatchPolicy;
  linkagePolicy: LinkagePolicy;
  handoffPolicy: HandoffPolicy;
  permissionPolicy: RequestTypePermissionPolicy;
  auditPolicy: RequestTypeAuditPolicy;
  settingsRefs: string[];
};
```

This definition is configuration. It is not a submitted request and must not
store customer-entered data.

### 17.3 Minimum Registry Tables Or Config Units

The implementation phase should provide these units before adding individual
request types:

| Unit | Purpose |
|---|---|
| `service_request_type_config` | One row per request type: code, labels, active flag, handoff target, behavior flags |
| `service_request_form_versions` | Versioned dynamic form definitions |
| `service_request_type_party_roles` | Allowed party roles per request type |
| `service_request_handoff_rules` | Target domain and required links before handoff |
| `service_request_duplicate_rules` | Duplicate detection scope and fields |
| `service_request_type_settings` | Links to `system_lists` or other configurable lists |

These units may start as code-seeded configuration during the first iteration,
but they must be shaped so they can become database-backed without changing the
API contract.

### 17.4 Required Backend Infrastructure

Before building request-specific forms, the backend must provide:

1. A readonly registry loader that returns active request type definitions.
2. A validator that checks submitted payloads against the registry and form
   version.
3. A party normalizer that writes external people into `externalSnapshot` and
   internal links into `linkedPartyRef`.
4. A lookup resolver for registry fields that use existing scoped lookup
   services such as geo units, device models, and system lists.
5. A handoff resolver that routes approved requests to the correct domain.
6. An idempotency mechanism for handoff so retrying does not create duplicate
   tasks, candidates, applications, or cases.
7. Audit events for registry-driven validation, linking, mismatch decisions,
   and handoff.

### 17.5 Required Frontend Infrastructure

Before request-specific screens are added, the frontend must provide:

1. A dynamic request form renderer driven by the registry form definition.
2. Shared party sections for requester, beneficiary, applicant, nominated
   person, referrer, and representative.
3. External-name UI that can submit without an internal match.
4. Review UI that displays submitted snapshots next to linked internal records.
5. A request type picker that reads active types from the registry, not a local
   hard-coded enum.
6. Fail-soft lookup behavior for optional scoped lists.

### 17.6 Authorization Alignment

The registry must not invent a parallel authorization model. It must follow:

```text
identity + permission + scope + subject = decision
```

Rules:

1. Public or mobile creation is an intake capability, not internal visibility.
2. Internal request review uses `service_requests.review` or a later explicit
   request-review permission.
3. Handoff also requires authorization in the target domain.
4. Registry entries may declare required permissions, but enforcement remains in
   backend policies and services.
5. External party snapshots are not authorization subjects.
6. When a request links to a client, candidate, employee, application, or task,
   that linked record becomes the subject for domain-specific authorization.

### 17.7 What Must Not Be Done

Do not start implementation by:

1. Adding one React form per request type with separate payload shapes.
2. Creating open tasks directly from the mobile app.
3. Turning every external name into a client.
4. Duplicating task-type settings inside request definitions.
5. Using frontend enums as the source of truth.
6. Using `service_requests.branch_id` as an authorization shortcut.
7. Adding a handoff path before duplicate, linkage, and audit rules are defined.

### 17.8 Step 1 Acceptance Criteria

The first step is ready when:

1. The project has one canonical definition shape for request types.
2. The definition clearly separates request intake from executable tasks.
3. Existing emergency maintenance can be represented as a registry entry.
4. Every external person role can be represented without creating an internal
   record.
5. Every handoff target declares its required links and idempotency key.
6. Registry-driven forms can be versioned.
7. Authorization requirements are declared but enforced by backend policy.
8. No runtime code path depends on a hard-coded frontend-only request type enum.

## 18. Acceptance Criteria

The unified request template is correctly applied when:

1. A visitor can submit a request with only external party snapshots.
2. An authenticated user can submit with prefilled data and edited submitted data.
3. A request for another person stores both requester and beneficiary separately.
4. A nominated external name can become a candidate without becoming a client.
5. A job applicant is handed off to jobs, not `open_tasks`.
6. A maintenance request creates an `open_task` only after required linkage.
7. Original submitted data remains visible after linking.
8. Duplicate and mismatch flags do not delete or mutate the request.
9. Every review decision appears in the audit log.
10. Retrying handoff does not create duplicate downstream work.
