import { useEffect } from 'react';
import { useAccounts } from '../../../accounts';
import { IconUser } from '../../../ui';
import { useOfficeStore } from '../store/officeStore';

/** Your picture in the office's corner (Google's, else GitHub's); opens Settings → Accounts. */
export function AccountButton() {
  const { accounts, refresh } = useAccounts();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const profile = accounts?.google.profile ?? accounts?.github.profile ?? null;
  const label = profile ? `Signed in as ${profile.name}` : 'Sign in';
  return (
    <button
      className="office-account-button"
      onClick={() => useOfficeStore.getState().openOverlay('settings', 'accounts')}
      title={label}
      aria-label={`${label}. Open accounts`}
    >
      {profile?.avatar ? <img src={profile.avatar} alt="" width={24} height={24} /> : <IconUser size={16} />}
    </button>
  );
}
