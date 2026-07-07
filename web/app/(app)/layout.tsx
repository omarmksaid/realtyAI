import Link from "next/link";
import { Nav } from "./nav";
import TrialBanner from "./trial-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/today" className="brand">realty<em>AI</em></Link>
        <Nav />
      </aside>
      <main className="main"><TrialBanner />{children}</main>
    </div>
  );
}
