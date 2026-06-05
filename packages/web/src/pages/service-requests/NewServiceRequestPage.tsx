// ============================================================
// NewServiceRequestPage — full-page wrapper for admin_manual channel
// Constitution: maintenance.md §٠.٦ (admin_manual = full screen)
// ============================================================
import { useNavigate, useSearchParams } from 'react-router-dom';
import NewServiceRequestModal from '../../components/service-requests/NewServiceRequestModal';

export default function NewServiceRequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Allow ?channel=phone for quick walk-in screens from external links.
  const channel =
    (searchParams.get('channel') as
      | 'internal_button'
      | 'client_detail_button'
      | 'admin_manual'
      | 'phone'
      | null) ?? 'admin_manual';

  return (
    <NewServiceRequestModal
      channel={channel}
      onClose={() => navigate('/service-requests')}
      onCreated={(id) => navigate(`/service-requests/${id}`)}
    />
  );
}
