export default function DashboardLoading() {
  return (
    <div className="container">
      <div className="dash-head">
        <div>
          <div className="skel" style={{ width: 72, height: 13, marginBottom: 10 }} />
          <div className="skel" style={{ width: 180, height: 28 }} />
          <div className="skel" style={{ width: 200, height: 13, marginTop: 8 }} />
        </div>
      </div>
      <div className="saved-list">
        {Array.from({ length: 4 }, (_, i) => (
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
