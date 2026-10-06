import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigserial,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const subscriberStatus = pgEnum("subscriber_status", [
  "pending",
  "active",
  "unsubscribed",
  "bounced",
  "complained",
]);

export const officerRole = pgEnum("officer_role", ["admin", "sender", "drafter"]);

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "pending_approval",
  "approved",
  "sending",
  "sent",
  "failed",
]);

export const sendStatus = pgEnum("send_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  // Dropped at dispatch time (suppressed or no longer active).
  "skipped",
  "bounced",
  "complained",
]);

export const suppressionReason = pgEnum("suppression_reason", [
  "unsubscribe",
  "bounce",
  "complaint",
  "manual",
]);

export const officerAuditAction = pgEnum("officer_audit_action", [
  "bootstrap",
  "add",
  "role_change",
  "deactivate",
  "reactivate",
]);

// ---------------------------------------------------------------------------
// Officers and their auth sessions
// ---------------------------------------------------------------------------

export const officers = pgTable(
  "officers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    role: officerRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    // Google account subject id; bound on first successful sign-in, matched thereafter.
    googleSub: text("google_sub"),
    addedBy: uuid("added_by").references((): any => officers.id),
    addedAt: ts("added_at").notNull().defaultNow(),
    deactivatedAt: ts("deactivated_at"),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [
    uniqueIndex("officers_email_key").on(t.email),
    uniqueIndex("officers_google_sub_key").on(t.googleSub),
    check("officers_email_lower", sql`${t.email} = lower(${t.email})`),
    check(
      "officers_active_consistent",
      sql`(${t.active} and ${t.deactivatedAt} is null) or (not ${t.active} and ${t.deactivatedAt} is not null)`,
    ),
  ],
);

// Database-backed officer sessions (not JWT). Deleting rows revokes access immediately.
export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => officers.id, { onDelete: "cascade" }),
    expires: ts("expires").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_officer_id_idx").on(t.officerId)],
);

export const officerAudit = pgTable(
  "officer_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => officers.id),
    action: officerAuditAction("action").notNull(),
    // Null only for system actions (bootstrap).
    actorId: uuid("actor_id").references(() => officers.id),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    timestamp: ts("timestamp").notNull().defaultNow(),
  },
  (t) => [index("officer_audit_officer_id_idx").on(t.officerId), index("officer_audit_timestamp_idx").on(t.timestamp)],
);

// ---------------------------------------------------------------------------
// Subscribers, segments, suppressions
// ---------------------------------------------------------------------------

// Email and home elementary school only. Never store child names or other student data.
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    school: text("school"),
    status: subscriberStatus("status").notNull().default("pending"),
    consentAt: ts("consent_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    confirmToken: text("confirm_token"),
    // Set when the confirmation email couldn't be sent (e.g. the provider's daily
    // limit); the send worker retries it.
    confirmEmailDueAt: ts("confirm_email_due_at"),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subscribers_email_key").on(t.email),
    uniqueIndex("subscribers_confirm_token_key").on(t.confirmToken),
    uniqueIndex("subscribers_unsubscribe_token_key").on(t.unsubscribeToken),
    index("subscribers_status_idx").on(t.status),
    index("subscribers_school_idx").on(t.school),
    check("subscribers_email_lower", sql`${t.email} = lower(${t.email})`),
    // 32 random bytes, base64url => 43 chars. Guards against weak tokens slipping in.
    check("subscribers_unsubscribe_token_len", sql`length(${t.unsubscribeToken}) >= 43`),
    check("subscribers_confirm_token_len", sql`${t.confirmToken} is null or length(${t.confirmToken}) >= 43`),
  ],
);

// rule grammar: "all" | "school=<school>" | "committee=<name>".
// committee segments resolve through manual membership in subscriber_segments.
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    rule: text("rule").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("segments_name_key").on(t.name)],
);

export const subscriberSegments = pgTable(
  "subscriber_segments",
  {
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.subscriberId, t.segmentId] }), index("subscriber_segments_segment_idx").on(t.segmentId)],
);

// Checked before EVERY send, regardless of subscriber status.
export const suppressions = pgTable(
  "suppressions",
  {
    email: text("email").primaryKey(),
    reason: suppressionReason("reason").notNull(),
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [check("suppressions_email_lower", sql`${t.email} = lower(${t.email})`)],
);

// ---------------------------------------------------------------------------
// Content: assets, templates, brand, campaigns, sends
// ---------------------------------------------------------------------------

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    publicUrl: text("public_url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    mimeType: text("mime_type").notNull(),
    altText: text("alt_text"),
    uploadedBy: uuid("uploaded_by").references(() => officers.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assets_storage_key_key").on(t.storageKey),
    check("assets_mime_type", sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/gif')`),
  ],
);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  bodyJson: jsonb("body_json").notNull(),
  // Null for built-in starter templates.
  createdBy: uuid("created_by").references(() => officers.id),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

const hexColor = (col: any) => sql`${col} ~ '^#[0-9a-fA-F]{6}$'`;

// Single row, enforced by a boolean primary key that must be true.
export const brandSettings = pgTable(
  "brand_settings",
  {
    id: boolean("id").primaryKey().default(true),
    logoAssetId: uuid("logo_asset_id").references(() => assets.id, { onDelete: "set null" }),
    primaryColor: text("primary_color").notNull(),
    accentColor: text("accent_color").notNull(),
    footerText: text("footer_text").notNull().default(""),
    ptaMailingAddress: text("pta_mailing_address").notNull(),
    updatedBy: uuid("updated_by").references(() => officers.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("brand_settings_singleton", sql`${t.id}`),
    check("brand_settings_primary_color_hex", hexColor(t.primaryColor)),
    check("brand_settings_accent_color_hex", hexColor(t.accentColor)),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader").notNull().default(""),
    bodyJson: jsonb("body_json").notNull(),
    renderedHtml: text("rendered_html"),
    plaintextBody: text("plaintext_body"),
    // Rendered at send time for the public archive: no unsubscribe tokens, no subscriber data.
    archiveHtml: text("archive_html"),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    // Audiences the message goes to (union). Empty means nobody, so a message is
    // never sent to everyone by default; "All subscribers" is an audience of its own.
    segmentIds: uuid("segment_ids").array().notNull().default(sql`'{}'::uuid[]`),
    // Display name on the From line; empty uses the name in EMAIL_FROM.
    fromName: text("from_name").notNull().default(""),
    status: campaignStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => officers.id),
    approvedBy: uuid("approved_by").references(() => officers.id),
    sentBy: uuid("sent_by").references(() => officers.id),
    sentAt: ts("sent_at"),
    // Sent campaigns appear in the public archive unless turned off (e.g. committee-only mail).
    showInArchive: boolean("show_in_archive").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("campaigns_status_idx").on(t.status)],
);

export const sends = pgTable(
  "sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    // Nulled when a subscriber is deleted, so campaign stats survive a data-deletion request.
    subscriberId: uuid("subscriber_id").references(() => subscribers.id, { onDelete: "set null" }),
    status: sendStatus("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // Retry backoff: a queued row is not dispatched before this time.
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    // SES open/click tracking. Opens are an estimate: Apple Mail preloads
    // images (false opens) and image blocking hides real ones. Clicks are real.
    firstOpenedAt: ts("first_opened_at"),
    openCount: integer("open_count").notNull().default(0),
    firstClickedAt: ts("first_clicked_at"),
    clickCount: integer("click_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // Idempotency: one send row per subscriber per campaign.
    uniqueIndex("sends_campaign_subscriber_key").on(t.campaignId, t.subscriberId),
    uniqueIndex("sends_provider_message_id_key").on(t.providerMessageId),
    index("sends_campaign_status_idx").on(t.campaignId, t.status),
    index("sends_dispatch_idx").on(t.status, t.nextAttemptAt),
  ],
);

// Which email service sends, chosen on the admin Sending page (null: EMAIL_PROVIDER),
// and a pause set when the service reports its sending quota is used up.
export const sendingSettings = pgTable(
  "sending_settings",
  {
    id: boolean("id").primaryKey().default(true),
    provider: text("provider"),
    pausedUntil: ts("paused_until"),
    pauseReason: text("pause_reason"),
    updatedBy: uuid("updated_by").references(() => officers.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("sending_settings_singleton", sql`${t.id}`), check("sending_settings_provider", sql`${t.provider} in ('ses', 'brevo')`)],
);

// One row per (send, link): which links each delivered copy had clicked.
export const sendClicks = pgTable(
  "send_clicks",
  {
    sendId: uuid("send_id")
      .notNull()
      .references(() => sends.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    clicks: integer("clicks").notNull().default(1),
    firstAt: ts("first_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sendId, t.url] })],
);

export const dataAuditAction = pgEnum("data_audit_action", ["subscriber_delete", "subscriber_export"]);

// Who deleted or exported subscriber data. Deliberately stores no email addresses.
export const dataAudit = pgTable(
  "data_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    action: dataAuditAction("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => officers.id),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    timestamp: ts("timestamp").notNull().defaultNow(),
  },
  (t) => [index("data_audit_timestamp_idx").on(t.timestamp)],
);

// Fixed-window counters for public endpoints (subscribe). Shared across instances.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});
