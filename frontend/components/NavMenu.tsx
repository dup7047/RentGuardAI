'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/for-landlords', label: 'For landlords' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/how-we-make-money', label: 'How we make money' },
  { href: '/legal/terms', label: 'Terms' },
];

export function NavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="nav-menu">
      <button
        type="button"
        className="nav-menu-button"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls="nav-menu-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nav-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div id="nav-menu-panel" className="nav-menu-panel">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
