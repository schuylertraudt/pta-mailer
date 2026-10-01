import Link from "next/link";
import { Public_Sans } from "next/font/google";
import s from "./public.module.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

/** Header + centered column used by every parent-facing page. */
export default function PublicShell(props: { children: React.ReactNode; hideLogin?: boolean }) {
  return (
    <div className={`${s.page} ${publicSans.className}`}>
      <header className={s.header}>
        <nav className={s.nav} aria-label="Site">
          <Link href="/archive" className={s.navArchive}>
            Past newsletters
          </Link>
          {props.hideLogin ? <Link href="/">Get PTA news</Link> : <Link href="/login">Login</Link>}
        </nav>
      </header>
      <main className={s.main}>
        <div className={s.column}>{props.children}</div>
      </main>
      <footer className={s.footer}>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}

export function MailIcon() {
  return (
    <div className={s.icon}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1D3F66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    </div>
  );
}

export function CheckIcon() {
  return (
    <div className={s.icon}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1D3F66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </div>
  );
}

export { s as styles };
