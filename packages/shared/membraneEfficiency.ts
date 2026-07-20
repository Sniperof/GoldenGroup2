export type MembraneEfficiencyIssue =
  | 'not_numeric'
  | 'negative_reading'
  | 'output_exceeds_input';

export type MembraneEfficiencyEvaluation =
  | { status: 'valid'; percentage: number; issue: null }
  | { status: 'incomplete'; percentage: null; issue: null }
  | { status: 'undefined'; percentage: null; issue: null }
  | { status: 'invalid'; percentage: null; issue: MembraneEfficiencyIssue };

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

export function evaluateMembraneEfficiency(
  inputTds: unknown,
  outputTds: unknown,
): MembraneEfficiencyEvaluation {
  const inputMissing = isMissing(inputTds);
  const outputMissing = isMissing(outputTds);

  const input = inputMissing ? null : Number(inputTds);
  const output = outputMissing ? null : Number(outputTds);

  if ((input != null && !Number.isFinite(input)) || (output != null && !Number.isFinite(output))) {
    return { status: 'invalid', percentage: null, issue: 'not_numeric' };
  }
  if ((input != null && input < 0) || (output != null && output < 0)) {
    return { status: 'invalid', percentage: null, issue: 'negative_reading' };
  }
  if (input == null || output == null) {
    return { status: 'incomplete', percentage: null, issue: null };
  }
  if (output > input) {
    return { status: 'invalid', percentage: null, issue: 'output_exceeds_input' };
  }
  if (input === 0) {
    return { status: 'undefined', percentage: null, issue: null };
  }

  const percentage = Math.round((1 - output / input) * 100);
  return { status: 'valid', percentage: Math.max(0, Math.min(100, percentage)), issue: null };
}

export function membraneEfficiencyIssueMessage(issue: MembraneEfficiencyIssue): string {
  switch (issue) {
    case 'not_numeric':
      return 'قراءات الميمبرين يجب أن تكون أرقاماً صالحة';
    case 'negative_reading':
      return 'قراءات الميمبرين لا يمكن أن تكون سالبة';
    case 'output_exceeds_input':
      return 'قراءة غير صحيحة: خرج الميمبرين أكبر من الدخل';
  }
}
