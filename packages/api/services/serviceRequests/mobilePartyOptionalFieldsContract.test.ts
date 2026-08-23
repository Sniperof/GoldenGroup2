import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWaterCheckForm } from './waterCheckFormSchema.js';
import { validateEmergencyMaintenanceForm } from './emergencyMaintenanceFormSchema.js';
import { validatePeriodicMaintenanceForm } from './periodicMaintenanceFormSchema.js';
import { validateDeviceRequestForm } from './deviceRequestFormSchema.js';
import { validateGoldenWarrantyForm } from './goldenWarrantyFormSchema.js';
import { buildSubmittedPerson, withSecondaryContactOverride } from './mobileWaterCheckIntake.js';

const validators = [
  ['water_check', validateWaterCheckForm],
  ['emergency_maintenance', validateEmergencyMaintenanceForm],
  ['periodic_maintenance', validatePeriodicMaintenanceForm],
  ['device_request', validateDeviceRequestForm],
  ['golden_warranty', validateGoldenWarrantyForm],
] as const;

test('every mobile request contract accepts optional beneficiary father and secondary-contact fields', () => {
  for (const [requestType, validate] of validators) {
    const result = validate({
      fatherName: 'أحمد',
      secondaryPhone: '0944444444',
      secondaryPhoneHasWhatsapp: true,
    });
    assert.equal(result.ok, true, requestType);

    const absent = validate({});
    assert.equal(absent.ok, true, `${requestType}: absent optional fields`);
  }
});

test('every mediator-capable request contract accepts optional mediator father and secondary-contact fields', () => {
  for (const [requestType, validate] of validators.filter(([type]) => type !== 'golden_warranty')) {
    const result = validate({
      referrerFatherName: 'محمود',
      referrerSecondaryPhone: '0955555555',
      referrerSecondaryPhoneHasWhatsapp: false,
    });
    assert.equal(result.ok, true, requestType);
  }
});

test('a submitted beneficiary or mediator may omit father name and secondary WhatsApp flag', () => {
  for (const role of ['beneficiary', 'referrer'] as const) {
    const prefix = role === 'beneficiary' ? '' : 'referrer';
    const person = buildSubmittedPerson({
      body: role === 'beneficiary'
        ? {
          firstName: 'سارة', lastName: 'خليل', phoneNumber: '0933333333',
          primaryPhoneHasWhatsapp: true, secondaryPhone: '0944444444',
        }
        : {
          referrerFirstName: 'سارة', referrerLastName: 'خليل', referrerPhone: '0933333333',
          referrerPhoneHasWhatsapp: true, referrerSecondaryPhone: '0944444444',
        },
      role,
    });
    assert.equal(person.fatherName, null, `${prefix} father name`);
    assert.equal(person.secondaryPhone, '0944444444', `${prefix} secondary phone`);
    assert.equal(person.secondaryPhoneHasWhatsapp, false, `${prefix} secondary WhatsApp default`);
  }
});

test('registered-party secondary override defaults WhatsApp support to false when omitted', () => {
  const person = withSecondaryContactOverride({
    person: {
      firstName: 'سارة', fatherName: null, lastName: 'خليل', name: 'سارة خليل',
      primaryPhone: '0933333333', primaryPhoneHasWhatsapp: true,
      secondaryPhone: '0955555555', secondaryPhoneHasWhatsapp: true,
      source: 'client_record',
    },
    body: { secondaryPhone: '0944444444' },
    phoneField: 'secondaryPhone',
    whatsappField: 'secondaryPhoneHasWhatsapp',
  });
  assert.equal(person.secondaryPhone, '0944444444');
  assert.equal(person.secondaryPhoneHasWhatsapp, false);
});
