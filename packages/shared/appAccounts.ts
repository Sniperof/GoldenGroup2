export const APP_ACCOUNT_SOURCES = {
  account_creation: 'بطلب الزبون',
  admin: 'إنشاء مباشر',
  admin_bulk: 'تفعيل جماعي',
  water_test_request: 'طلب فحص مياه',
  device_request: 'طلب جهاز',
  maintenance_request: 'طلب صيانة',
  referral_request: 'إحالة',
  golden_warranty_request: 'كفالة ذهبية',
} as const;

export interface AppAccountListRow {
  id: string;
  clientId: number;
  clientName: string;
  primaryMobile: string;
  branchName: string | null;
  status: 'active' | 'suspended';
  createdSource: string;
  createdAt: string;
  suspendedReason: string | null;
}

export interface AppAccountListResult {
  items: AppAccountListRow[];
  totalCount: number;
  limit: number;
  offset: number;
}
