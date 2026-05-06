export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 1.5rem',
          textAlign: 'center',
          maxWidth: 720,
          margin: '0 auto',
        }}
      >
        <p
          style={{
            fontSize: '0.85rem',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--accent)',
            marginBottom: '1rem',
            fontWeight: 600,
          }}
        >
          Coming Soon
        </p>
        <h1
          style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            marginBottom: '1.25rem',
          }}
        >
          Stop renting blind
          <br />
          in New York City.
        </h1>
        <p
          style={{
            fontSize: '1.15rem',
            color: 'var(--muted)',
            maxWidth: 540,
            marginBottom: '2.5rem',
          }}
        >
          Paste any NYC address and get an AI risk summary backed by HPD
          violations, DOB complaints, landlord records, and tenant law — in
          seconds.
        </p>

        {/* ── Feature cards ──────────────────────────────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            width: '100%',
            marginBottom: '3rem',
          }}
        >
          <Card
            emoji="&#x1F50D;"
            title="Building Lookup"
            body="Free risk summary from NYC public records for any address."
          />
          <Card
            emoji="&#x1F4DC;"
            title="Lease Review"
            body="AI checks your lease against NYC tenant law for $29."
          />
          <Card
            emoji="&#x1F6E1;&#xFE0F;"
            title="FARE Act Check"
            body="Spot illegal broker fees before you sign."
          />
        </div>

        {/* ── CTA placeholder ────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              background: 'var(--accent)',
              color: '#fff',
              padding: '0.75rem 2rem',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '1rem',
              cursor: 'default',
              opacity: 0.7,
            }}
          >
            Launching&nbsp;Soon
          </span>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer
        style={{
          textAlign: 'center',
          padding: '2rem 1.5rem',
          fontSize: '0.8rem',
          color: 'var(--muted)',
          borderTop: '1px solid var(--border)',
        }}
      >
        &copy; {new Date().getFullYear()} RentGuard NYC &mdash; Not legal
        advice. Always verify records yourself.
      </footer>
    </main>
  );
}

function Card({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '1.25rem',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: '1.5rem' }} dangerouslySetInnerHTML={{ __html: emoji }} />
      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>
        {title}
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{body}</p>
    </div>
  );
}
