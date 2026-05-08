export default function DashboardLoading() {
  return (
    <div className="container" style={{ paddingTop: 36 }}>
      <div className="dash-head" style={{ paddingBottom: 20 }}>
        <div>
          <div className="skel" style={{ width: 72, height: 13, marginBottom: 10 }} />
          <div className="skel" style={{ width: 180, height: 28 }} />
          <div className="skel" style={{ width: 200, height: 13, marginTop: 8 }} />
        </div>
      </div>
      <div className="saved-list">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="skel"
            style={{ height: 78, borderRadius: 12 }}
          />
        ))}
      </div>
    </div>
  );
}
