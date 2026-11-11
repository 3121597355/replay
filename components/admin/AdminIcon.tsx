export type AdminIconName = 'overview' | 'projects' | 'retention' | 'audience' | 'integration' | 'security' | 'changelog' | 'website';

export default function AdminIcon({ name }: { name: AdminIconName }) {
  return <svg className="ra-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'overview' && <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M9 10h12" /></>}
    {name === 'projects' && <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 12h8M8 17h5" /></>}
    {name === 'retention' && <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>}
    {name === 'audience' && <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>}
    {name === 'integration' && <><path d="M4 7h16l-4-4M20 17H4l4 4M20 7l-4 4M4 17l4-4" /></>}
    {name === 'security' && <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>}
    {name === 'website' && <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6h14M5 18h14" /></>}
    {name === 'changelog' && <><path d="M5 3h9l4 4v4M5 3v18h7M14 3v5h4M8 8h3M8 12h3" /><circle cx="17" cy="17" r="5" /><path d="M17 14v3l2 1" /></>}
  </svg>;
}
