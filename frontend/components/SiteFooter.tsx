import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer" aria-label="Site footer">
      <div className="site-footer-inner">
        <div className="site-footer-col">
          <h4>Product</h4>
          <ul>
            <li>
              <Link href="/how-it-works" prefetch={false}>How it works</Link>
            </li>
            <li>
              <Link href="/coverage" prefetch={false}>Coverage</Link>
            </li>
            <li>
              <Link href="/pricing" prefetch={false}>Pricing</Link>
            </li>
            <li>
              <Link href="/for-landlords" prefetch={false}>For landlords</Link>
            </li>
          </ul>
        </div>
        <div className="site-footer-col">
          <h4>Legal</h4>
          <ul>
            <li>
              <Link href="/legal/terms" prefetch={false}>Terms of Service</Link>
            </li>
            <li>
              <Link href="/legal/privacy" prefetch={false}>Privacy Policy</Link>
            </li>
            <li>
              <Link href="/legal/disclaimer" prefetch={false}>Disclaimers</Link>
            </li>
            <li>
              <Link href="/how-we-make-money" prefetch={false}>How we make money</Link>
            </li>
          </ul>
        </div>
        <div className="site-footer-col">
          <h4>Contact</h4>
          <ul>
            <li><a href="mailto:support@rentguard.cc">support@rentguard.cc</a></li>
            <li><a href="mailto:privacy@rentguard.cc">privacy@rentguard.cc</a></li>
            <li><a href="mailto:legal@rentguard.cc">legal@rentguard.cc</a></li>
          </ul>
        </div>
      </div>
      <div className="site-footer-base">
        <span>© {new Date().getFullYear()} RentGuard NYC LLC</span>
        <span>NYC renters. AI rental copilot.</span>
      </div>
    </footer>
  );
}
