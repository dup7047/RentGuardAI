// Phase 4: compact "What this listing is offering" card rendered at the top
// of the building report when scraped_listing is present.
//
// Shows the structured facts the AI is reasoning over so the user can spot
// extraction errors and the system stays transparent about what data informs
// the review. NOT a verdict on the listing — just facts.

import type { ScrapedListingPublic } from '@/lib/api/backend';

function formatRent(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toLocaleString('en-US')}/mo`;
}

function formatLayout(s: ScrapedListingPublic): string | null {
  const parts: string[] = [];
  if (s.bedrooms != null) parts.push(s.bedrooms === 0 ? 'studio' : `${s.bedrooms} bed`);
  if (s.bathrooms != null) parts.push(`${s.bathrooms} bath`);
  if (s.squareFeet != null) parts.push(`${s.squareFeet.toLocaleString()} sqft`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function brokerFeeLabel(s: ScrapedListingPublic): string {
  if (s.brokerFeeStated === 'no_fee') return 'No broker fee';
  if (s.brokerFeeStated === 'fee') return 'Broker fee charged';
  return 'Not stated';
}

function hostLabel(source: ScrapedListingPublic['source']): string {
  if (source === 'streeteasy') return 'streeteasy.com';
  if (source === 'zillow') return 'zillow.com';
  return 'listing source';
}

export function ListingFactsCard({ data }: { data: ScrapedListingPublic }) {
  const rent = formatRent(data.monthlyRentCents);
  const layout = formatLayout(data);

  // Show even minimal data — user pasted a URL, they expect SOMETHING here
  return (
    <section className="listing-facts-card" aria-label="Listing offering details">
      <header className="listing-facts-header">
        <h2>What this listing is offering</h2>
        <p className="listing-facts-source">
          Scraped from{' '}
          <a href={data.url} target="_blank" rel="noopener noreferrer">
            {hostLabel(data.source)}
          </a>
          {data.confidence === 'low' && (
            <span className="listing-facts-confidence" title="Generic extractor — fewer fields available">
              {' '}
              · low-confidence
            </span>
          )}
        </p>
      </header>

      <dl className="listing-facts-grid">
        {rent && (
          <>
            <dt>Rent</dt>
            <dd>{rent}</dd>
          </>
        )}
        {layout && (
          <>
            <dt>Layout</dt>
            <dd>{layout}</dd>
          </>
        )}
        {data.unit && (
          <>
            <dt>Unit</dt>
            <dd>{data.unit}</dd>
          </>
        )}
        <dt>Broker fee</dt>
        <dd>{brokerFeeLabel(data)}</dd>
        {data.leaseTermMonths != null && (
          <>
            <dt>Lease term</dt>
            <dd>{data.leaseTermMonths} months</dd>
          </>
        )}
        {data.petsPolicy && (
          <>
            <dt>Pets</dt>
            <dd>{data.petsPolicy}</dd>
          </>
        )}
        {data.utilitiesIncluded.length > 0 && (
          <>
            <dt>Utilities included</dt>
            <dd>{data.utilitiesIncluded.join(', ')}</dd>
          </>
        )}
        {data.availabilityDate && (
          <>
            <dt>Available</dt>
            <dd>{data.availabilityDate}</dd>
          </>
        )}
        {data.daysOnMarket != null && (
          <>
            <dt>Days on market</dt>
            <dd>{data.daysOnMarket}</dd>
          </>
        )}
        {data.agentName && (
          <>
            <dt>Listing agent</dt>
            <dd>
              {data.agentName}
              {data.brokerage && ` · ${data.brokerage}`}
            </dd>
          </>
        )}
      </dl>

      {data.amenities.length > 0 && (
        <div className="listing-facts-amenities">
          <strong>Amenities:</strong>{' '}
          {data.amenities.map((a) => (
            <span key={a} className="amenity-pill">
              {a}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
