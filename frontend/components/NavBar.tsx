// Sticky top nav — appears on every page via root layout.
//
// The nav shell (logo + links) renders immediately in the HTML stream.
// The auth chip is a Client Component (NavAuthCta) so the server tree does
// not read cookies, keeping marketing routes statically renderable.

import Image from 'next/image';
import Link from 'next/link';

import { NavAuthCta } from '@/components/NavAuthCta';
import { NavMenu } from '@/components/NavMenu';

export function NavBar() {
  return (
    <div className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand" aria-label="RentGuard home" prefetch={false}>
          <Image
            src="/logo-lockup.png"
            alt="RentGuard"
            width={200}
            height={82}
            priority
            style={{ display: 'block', width: 'auto', height: '36px' }}
          />
        </Link>

        <div className="nav-links">
          <Link href="/how-it-works" prefetch={false}>
            How it works
          </Link>
          <Link href="/coverage" prefetch={false}>
            Coverage
          </Link>
          <Link href="/for-landlords" prefetch={false}>
            For landlords
          </Link>
          <Link href="/pricing" prefetch={false}>
            Pricing
          </Link>
        </div>

        <NavMenu />

        <div className="nav-cta">
          <NavAuthCta />
        </div>
      </div>
    </div>
  );
}
