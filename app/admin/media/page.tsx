import MediaLibrary from "@/components/admin/MediaLibrary";

export default function MediaPage() {
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>Media library</h1>
      <p className="muted">Images uploaded here can be reused in any message. Keep alt text up to date.</p>
      <MediaLibrary />
    </div>
  );
}
