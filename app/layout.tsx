import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "PTA News",
  description: "School PTA mailing list",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
