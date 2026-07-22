import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmergencyDirectWorkshopRetrieval } from './emergencyDirectWorkshopRetrieval.js';

test('direct workshop retrieval is ignored when not requested', () => {
  assert.doesNotThrow(() => validateEmergencyDirectWorkshopRetrieval({ requested: false, finalDecision: 'resolved' }));
});

test('direct workshop retrieval requires an unresolved emergency result', () => {
  assert.throws(() => validateEmergencyDirectWorkshopRetrieval({
    requested: true, finalDecision: 'resolved', waterDisconnected: true, customerAcknowledged: true,
  }), /لم تُحل/);
});

test('direct workshop retrieval requires a documented disconnection action', () => {
  assert.throws(() => validateEmergencyDirectWorkshopRetrieval({
    requested: true, finalDecision: 'unresolved', customerAcknowledged: true,
  }), /إجراء فك واحد/);
});

test('direct workshop retrieval requires customer acknowledgement', () => {
  assert.throws(() => validateEmergencyDirectWorkshopRetrieval({
    requested: true, finalDecision: 'unresolved', electricityDisconnected: true,
  }), /تأكيد الزبون/);
});

test('direct workshop retrieval accepts a fully documented pull', () => {
  assert.doesNotThrow(() => validateEmergencyDirectWorkshopRetrieval({
    requested: true,
    finalDecision: 'unresolved',
    waterDisconnected: true,
    electricityDisconnected: true,
    accessoriesRemoved: true,
    customerAcknowledged: true,
  }));
});
