// Route-level loading fallback for /building/[bbl]. Next.js renders this
// while the async server component in page.tsx awaits getBuildingByBbl().
// Layout mirrors BuildingReport (breadcrumb → 2-col head → tab bar → body)
// so the swap into real data feels seamless.

export default function BuildingLoading() {
  return (
    <div className="container">
      <div className="breadcrumb">
        <div className="skel" style={{ width: 48, height: 12 }} />
        <span aria-hidden="true">›</span>
        <div className="skel" style={{ width: 80, height: 12 }} />
        <span aria-hidden="true">›</span>
        <div className="skel" style={{ width: 220, height: 12 }} />
      </div>

      <div className="report-head">
        <div className="card head-left">
          <div className="skel" style={{ width: 140, height: 24, borderRadius: 999 }} />
          <div className="skel" style={{ width: '70%', height: 28, marginTop: 16 }} />
          <div className="skel" style={{ width: 160, height: 14, marginTop: 10 }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <div className="skel" style={{ width: 80, height: 14 }} />
            <div className="skel" style={{ width: 80, height: 14 }} />
            <div className="skel" style={{ width: 110, height: 14 }} />
            <div className="skel" style={{ width: 100, height: 14 }} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <div className="skel" style={{ width: 140, height: 38, borderRadius: 10 }} />
            <div className="skel" style={{ width: 130, height: 38, borderRadius: 10 }} />
            <div className="skel" style={{ width: 150, height: 38, borderRadius: 10 }} />
          </div>
        </div>

        <div className="card head-right">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="skel" style={{ width: 88, height: 88, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div className="skel" style={{ width: 90, height: 12 }} />
              <div className="skel" style={{ width: 140, height: 22, marginTop: 8 }} />
              <div className="skel" style={{ width: '100%', height: 12, marginTop: 12 }} />
              <div className="skel" style={{ width: '80%', height: 12, marginTop: 6 }} />
            </div>
          </div>
        </div>
      </div>

      <div className="skel" style={{ height: 44, borderRadius: 10, marginBottom: 18 }} />

      <div style={{ display: 'grid', gap: 16 }}>
        <div className="skel" style={{ height: 140, borderRadius: 12 }} />
        <div className="skel" style={{ height: 200, borderRadius: 12 }} />
        <div className="skel" style={{ height: 160, borderRadius: 12 }} />
      </div>
    </div>
  );
}
