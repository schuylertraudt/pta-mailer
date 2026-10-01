import Link from "next/link";
import { env } from "@/lib/env";
import { SITE } from "@/lib/site";
import PublicShell, { styles as s } from "@/components/public/PublicShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy policy" };

/** Contact for privacy requests: the reply-to address if set, else the From address. */
function contactEmail(): string {
  const e = env();
  const raw = e.EMAIL_REPLY_TO || e.EMAIL_FROM;
  return /<([^>]+)>/.exec(raw)?.[1] ?? raw;
}

export default function PrivacyPage() {
  const contact = contactEmail();
  return (
    <PublicShell>
      <div className={s.intro}>
        <h1 className={s.h1}>Privacy policy</h1>
        <p className={s.small}>Last updated {SITE.privacyUpdated}</p>
      </div>
      <div className={s.prose}>
        <p>
          This mailing list is run by {SITE.orgName} (&quot;we&quot;). This page explains what we collect, why, and the choices
          you have.
        </p>

        <h2>What we collect from families</h2>
        <ul>
          <li>
            <strong>Your email address</strong> and <strong>your home elementary school</strong>, which you give us when you
            subscribe.
          </li>
          <li>When you subscribed and when you confirmed, so we can show you agreed to receive our emails.</li>
          <li>
            Whether each message was delivered to you, bounced, or was reported as spam, so we can stop sending to addresses
            that don&apos;t work or don&apos;t want our mail.
          </li>
          <li>
            Whether you open each message and which links in it you click. Our email provider (Amazon) adds a tiny
            invisible image and passes links through its own address to tell us this. We use it only as totals (for
            example, how many families clicked a sign-up form) and we don&apos;t record your IP address or device. To avoid
            open tracking, turn off automatic image loading in your email app.
          </li>
          <li>
            Your internet (IP) address, briefly, to stop automated sign-ups. It is kept for no more than a day and is not
            linked to your subscription.
          </li>
        </ul>
        <p>
          We never ask for children&apos;s names or any information about students. The signup pages set no cookies.
        </p>

        <h2>How we use it</h2>
        <p>
          Only to send you PTA messages and announcements, including ones meant for your school, and to manage your
          subscription. We never sell, rent or share your information for anyone else&apos;s marketing.
        </p>

        <h2>Committee members and coordinators</h2>
        <p>
          People who send messages log in with their Google account. For them we store their name, email address, a Google
          account identifier, their role, and when they last logged in. Google provides only their name and email address; we
          don&apos;t get access to their Gmail, contacts or files. Logging in sets one cookie that keeps them logged in for up
          to 7 days.
        </p>

        <h2>Services that handle the data for us</h2>
        <ul>
          <li>Amazon Web Services (Amazon SES) delivers our emails.</li>
          <li>Our website host and database provider store the subscriber list.</li>
          <li>Our file storage provider hosts the images that appear in messages.</li>
          <li>Google handles login for committee members and coordinators.</li>
        </ul>
        <p>They process the data only to provide these services to us.</p>

        <h2>Your choices</h2>
        <ul>
          <li>
            <strong>Unsubscribe any time</strong> with the link at the bottom of every email. It takes effect immediately.
          </li>
          <li>
            <strong>Ask us to delete your information</strong> by emailing{" "}
            <a href={`mailto:${contact}`}>{contact}</a>. We remove your record and, unless you tell us otherwise, keep only
            your email address on a do-not-mail list so you are never emailed again.
          </li>
        </ul>

        <h2>How long we keep it</h2>
        <p>
          While you&apos;re subscribed. If you unsubscribe, or an address bounces or reports spam, we keep the email address
          on our do-not-mail list so it isn&apos;t emailed again. Past messages are posted publicly on the{" "}
          <Link href="/archive">past messages</Link> page; they never include subscriber information.
        </p>

        <h2>Changes and questions</h2>
        <p>
          If we change this policy, we&apos;ll update the date at the top of this page. Questions? Email{" "}
          <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      </div>
    </PublicShell>
  );
}
