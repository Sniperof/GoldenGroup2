export interface WorkCoverageLabelInput {
  routes: readonly unknown[];
  extraZones: readonly unknown[];
  finalZones: readonly unknown[];
}

export function getWorkCoverageLabel({
  routes,
  extraZones,
  finalZones,
}: WorkCoverageLabelInput): string {
  return `${routes.length} مسار + ${extraZones.length} منطقة — ${finalZones.length} محطة مستهدفة`;
}
