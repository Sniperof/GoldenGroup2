export const CONTRACT_SALE_TYPES = ['tradein', 'retention', 'direct'] as const;
export type ContractSaleType = typeof CONTRACT_SALE_TYPES[number];

export const OLD_DEVICE_CONDITIONS = ['good', 'damaged'] as const;
export type OldDeviceCondition = typeof OLD_DEVICE_CONDITIONS[number];

type NormalizedTradeinDetails = {
  ok: true;
  saleType: ContractSaleType;
  oldContractNumber: string | null;
  oldDeviceCondition: OldDeviceCondition | null;
};

type InvalidTradeinDetails = {
  ok: false;
  code: 'invalid_sale_type' | 'tradein_old_contract_required' | 'tradein_old_device_condition_invalid';
  error: string;
};

export type ContractTradeinNormalization = NormalizedTradeinDetails | InvalidTradeinDetails;

/**
 * Trade-in data is a statistical snapshot only.
 *
 * It deliberately does not resolve or mutate another contract/device. Keeping
 * that boundary here prevents create/edit paths from drifting into operational
 * replacement behavior.
 */
export function normalizeContractTradeinDetails(
  saleTypeInput: unknown,
  oldContractNumberInput: unknown,
  oldDeviceConditionInput: unknown,
): ContractTradeinNormalization {
  const saleType = saleTypeInput == null || saleTypeInput === ''
    ? 'direct'
    : String(saleTypeInput).trim();

  if (!(CONTRACT_SALE_TYPES as readonly string[]).includes(saleType)) {
    return {
      ok: false,
      code: 'invalid_sale_type',
      error: 'نوع البيع غير صالح.',
    };
  }
  const normalizedSaleType = saleType as ContractSaleType;

  if (normalizedSaleType !== 'tradein') {
    return {
      ok: true,
      saleType: normalizedSaleType,
      oldContractNumber: null,
      oldDeviceCondition: null,
    };
  }

  const oldContractNumber = String(oldContractNumberInput ?? '').trim();
  if (!oldContractNumber || oldContractNumber.length > 100) {
    return {
      ok: false,
      code: 'tradein_old_contract_required',
      error: 'رقم العقد القديم مطلوب للاستبدال ويجب ألا يتجاوز 100 محرف.',
    };
  }

  const oldDeviceCondition = String(oldDeviceConditionInput ?? '').trim();
  if (!(OLD_DEVICE_CONDITIONS as readonly string[]).includes(oldDeviceCondition)) {
    return {
      ok: false,
      code: 'tradein_old_device_condition_invalid',
      error: 'حالة الجهاز القديم يجب أن تكون جيد أو تالف.',
    };
  }

  return {
    ok: true,
    saleType: normalizedSaleType,
    oldContractNumber,
    oldDeviceCondition: oldDeviceCondition as OldDeviceCondition,
  };
}
