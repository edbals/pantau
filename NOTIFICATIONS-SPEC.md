# NOTIFICATIONS-SPEC.md — Pantau
> Staged implementation plan for urgency escalation, PM notification controls, and contacts.
> Follow these stages in order. Each stage is independently shippable.

---

## Overview

This feature has three parts:
1. **Urgency + escalation** — subcontractors get nudged harder as time passes
2. **PM notification controls** — PM decides what fires, when, and to whom
3. **Contacts page** — independent page with deep links from everywhere in the app

---

## Stage 1 — Rejection notification (foundation)
> **Prerequisite:** Auth, Supabase, Telegram bot token configured

**What to build:**
- When Koordinator denies a submission → fire Telegram to two places simultaneously:
  - Project group chat (already planned)
  - Subcontractor's registered Telegram (new)

**Database:**
```sql
-- Add to users table
ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;

-- Track all notifications sent
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  unit_id UUID REFERENCES units(id),
  submission_id UUID REFERENCES submissions(id),
  recipient_user_id UUID REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email', 'push')),
  type TEXT NOT NULL CHECK (type IN ('rejection', 'approval', 'reminder', 'escalation', 'briefing', 'broadcast')),
  message_body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE
);
```

**Telegram message on rejection:**
```
🔴 Pekerjaan Ditolak

Proyek : {project_name}
Unit   : {unit_code}
Tahap  : {stage_name}
Alasan : {reason}

→ Lihat & perbaiki: pantau.app/u/{unit_id}
```

**Session prompt for this stage:**
> "Build Stage 1 of NOTIFICATIONS-SPEC.md. Rejection fires Telegram to project group AND subcontractor DM. Read postgres-patterns before writing SQL."

---

## Stage 2 — Urgency with consequence language
> **Prerequisite:** Stage 1 complete

**The rule:** Never show abstract labels. Always show the consequence.

**What to build:**
- Replace "Normal / High / Critical" labels with consequence text everywhere
- Add optional `blocked_payment_amount` field to units
- Different Telegram message templates per urgency level

**Database:**
```sql
ALTER TABLE units ADD COLUMN blocked_payment_idr BIGINT DEFAULT NULL;
-- When set, this amount appears in all urgency notifications for this unit
-- PM sets this when they know which payment milestone this unit is blocking
```

**UI label mapping (Indonesian, field-facing):**

| Urgency | Badge shown | Explanation shown |
|---|---|---|
| normal | (nothing) | — |
| high | ⚠️ Perlu perhatian | Ini menghambat jadwal proyek |
| critical | 🚨 Harus selesai segera | INI BLOKIR PEMBAYARAN {Rp amount} |

**Telegram message — High:**
```
⚠️ Perlu Diselesaikan Segera
{project_name} · {unit_code}

Tahap {stage_name} sudah {days} hari belum selesai.
Ini menghambat jadwal proyek.

→ pantau.app/u/{unit_id}
```

**Telegram message — Critical:**
```
🚨 Perlu tindakan segera
{project_name} · {unit_code}

Tahap {stage_name} sudah {days} hari belum ada update.

→ pantau.app/u/{unit_id}
```

Note: `blocked_payment_idr` stays in the database for future use but is not shown in messages yet.

**Session prompt:**
> "Build Stage 2 of NOTIFICATIONS-SPEC.md. Replace urgency labels with consequence text. Add blocked_payment_idr to units table. Build the three Telegram message templates."

---

## Stage 3 — PM notification controls
> **Prerequisite:** Stage 2 complete

**What to build:**
- Settings page for PM: configure which events fire notifications and to whom
- "Push reminder" button on PM dashboard: manually fire a reminder to all subcontractors with overdue or rejected work
- "Send to specific person" — PM can target a notification at one subcontractor or pengawas

**Database:**
```sql
CREATE TABLE project_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) UNIQUE,
  
  -- Event toggles (PM can turn these on/off)
  notify_pm_on_submission BOOLEAN DEFAULT FALSE,
  notify_pm_on_approval BOOLEAN DEFAULT FALSE,
  notify_pm_on_rejection BOOLEAN DEFAULT TRUE, -- always on by default
  notify_pm_on_escalation BOOLEAN DEFAULT TRUE,
  
  -- Escalation thresholds (days)
  high_urgency_after_days INTEGER DEFAULT 3,
  critical_urgency_after_days INTEGER DEFAULT 7,
  escalate_to_owner_after_days INTEGER DEFAULT 5,
  escalate_to_pm_after_days INTEGER DEFAULT 7,
  
  -- Morning briefing
  briefing_enabled BOOLEAN DEFAULT TRUE,
  briefing_time_wib TEXT DEFAULT '07:00', -- WIB (UTC+7)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**PM notification settings UI:**

Section 1 — What notifies me (PM):
```
[ ] Saat pengawas mengirim laporan
[ ] Saat tahap disetujui
[✓] Saat tahap ditolak
[✓] Saat eskalasi terjadi
```

Section 2 — Eskalasi otomatis:
```
Tandai "Perlu perhatian" setelah [ 3 ] hari terlambat
Tandai "Kritis" setelah           [ 7 ] hari terlambat
Notif pemilik subkon setelah      [ 5 ] hari tanpa respons
Notif saya (PM) setelah           [ 7 ] hari tanpa respons
```

Section 3 — Push manual:
```
[Ingatkan Semua Subkontraktor]  ← fires reminder to all subcons with pending/overdue
[Broadcast ke Semua Lapangan]   ← PM writes a message, fires to all field workers
```

**Push reminder button — what it fires:**
```
📌 Pengingat dari Manajer Proyek
{project_name}

Kamu masih punya pekerjaan yang belum selesai:
→ {unit_code}: {stage_name} ({days} hari)

Mohon segera diselesaikan.
→ pantau.app/my-jobs
```

**Broadcast message (PM writes freetext):**
```
📢 Pesan dari Manajer Proyek
{project_name}

{pm_freetext_message}

— {pm_name}
```

**Session prompt:**
> "Build Stage 3 of NOTIFICATIONS-SPEC.md. PM notification settings page. Push reminder button. Broadcast message. Store settings in project_notification_settings table."

---

## Stage 4 — Auto-escalation chain
> **Prerequisite:** Stage 3 complete

**What to build:**
- Scheduled job that runs every morning at 6am WIB
- Finds all overdue units and sends appropriate escalation messages
- Escalates urgency level in database if thresholds are crossed
- Escalates to subcontractor company owner on Day 5

**Supabase Edge Function (scheduled cron):**
```typescript
// supabase/functions/escalation-check/index.ts
// Triggered: every day at 06:00 WIB (23:00 UTC previous day)

// Logic:
// 1. Find all active units where last stage submission is > threshold days ago
// 2. For each: determine which escalation tier they're in
// 3. Fire appropriate Telegram to subcontractor, owner, or PM
// 4. Update unit urgency level if auto-escalation crosses a threshold
// 5. Log to notification_log
```

**Escalation tiers (using project settings thresholds):**

| Days overdue | Action |
|---|---|
| >= high_urgency_after_days | Set urgency = high, fire to subcontractor field worker |
| >= critical_urgency_after_days | Set urgency = critical, fire to subcontractor field worker |
| >= escalate_to_owner_after_days | Also fire to subcontractor company owner (user with role=subcontractor_owner) |
| >= escalate_to_pm_after_days | PM sees dashboard alert, gets Telegram if notify_pm_on_escalation = true |

**Escalation messages:**

Day 3 (first reminder):
```
⚠️ Pengingat
{unit_code} · {stage_name}

Sudah {days} hari belum ada update.

→ pantau.app/u/{unit_id}
```

**Telegram message — Critical (Day 5, to company owner):**
```
🚨 Ada pekerjaan yang perlu perhatian
CV {company_name}

Unit {unit_code} · {project_name}
Tahap {stage_name} sudah {days} hari belum ada update.

→ pantau.app/u/{unit_id}
```

Day 7 (PM gets alert):
```
[PM Dashboard badge]: 3 unit terlambat kritis — subkontraktor tidak merespons
```

**Database:**
```sql
ALTER TABLE units
  ADD COLUMN urgency_set_at TIMESTAMPTZ,
  ADD COLUMN urgency_auto_escalated BOOLEAN DEFAULT FALSE,
  ADD COLUMN last_escalation_sent_at TIMESTAMPTZ,
  ADD COLUMN escalation_tier INTEGER DEFAULT 0;
  -- 0=none, 1=worker notified, 2=owner notified, 3=PM notified
```

**Session prompt:**
> "Build Stage 4 of NOTIFICATIONS-SPEC.md. Supabase Edge Function running daily at 06:00 WIB. Auto-escalation chain through subcontractor worker → company owner → PM. Uses project_notification_settings thresholds."

---

## Stage 5 — Auto-urgency detection
> **Prerequisite:** Stage 4 complete

**What to build:**
- System automatically sets urgency based on project logic — PM doesn't have to manually flag things
- PM sees a suggestion and can override

**Auto-urgency triggers:**
```
Stage > 3 days overdue          → suggest High
Stage > 7 days overdue          → suggest Critical
Same submission rejected 2+x    → suggest Critical
Unit blocking payment milestone → suggest Critical  
Project handover < 14 days,
  unit < 80% complete           → suggest Critical
```

**Database:**
```sql
ALTER TABLE units
  ADD COLUMN urgency_suggested TEXT CHECK (urgency_suggested IN ('normal','high','critical')),
  ADD COLUMN urgency_suggested_reason TEXT,
  ADD COLUMN urgency_override_by UUID REFERENCES users(id);
  -- If override_by is set, PM manually changed it. Don't auto-change again.
```

**PM sees on dashboard:**
```
💡 3 unit disarankan untuk ditandai kritis
[Lihat & terapkan] [Abaikan]
```

One tap applies all suggestions. PM can review individually and reject any.

**Session prompt:**
> "Build Stage 5 of NOTIFICATIONS-SPEC.md. Auto-detect urgency based on days overdue, repeated rejections, and project deadline proximity. Show PM a batch suggestion UI. PM can apply or override."

---

## Stage 6 — Morning briefing
> **Prerequisite:** Stage 4 complete (can run parallel to Stage 5)

**What to build:**
- Scheduled Telegram message at 7am WIB to every subcontractor who has urgent or overdue items
- Only fires if there's something to report — no empty briefings

**Message format:**
```
📋 Pagi ini yang perlu diselesaikan
CV {company_name}

🚨 {unit_code} — Perlu tindakan segera ({days} hari)
⚠️  {unit_code} — Perlu perhatian ({days} hari)
⚠️  {unit_code} — Perlu perhatian ({days} hari)

→ Lihat semua: pantau.app/my-jobs
```

Rules:
- Fire at 7:00 WIB (UTC+7) — use project timezone setting
- Only if subcontractor has >= 1 high or critical item
- If `blocked_payment_idr` total is 0 or null, omit the money line
- Deduplicate: don't fire if the same unit was already messaged in the last 12 hours via escalation

**Session prompt:**
> "Build Stage 6 of NOTIFICATIONS-SPEC.md. Supabase Edge Function scheduled at 00:00 UTC (07:00 WIB). Morning briefing Telegram to subcontractors with urgent items. Skip if nothing urgent. No duplicate within 12 hours."

---

## Stage 7 — Contacts page
> **Prerequisite:** Stage 1 complete. Can be built in parallel with any other stage.

**What to build:**
- Independent page accessible from nav rail (people icon)
- Lists all parties on the current project with contact methods
- Deep links from unit detail, review queue, rejection notices, subcontractor dashboard

**Database:**
```sql
-- contacts are derived from existing users + project_members
-- no new table needed — just a view

CREATE VIEW project_contacts AS
SELECT
  pm.project_id,
  u.id as user_id,
  u.full_name,
  u.role,
  u.phone,
  u.telegram_chat_id,
  u.telegram_username,
  s.name as subcontractor_name,
  s.id as subcontractor_id
FROM project_members pm
JOIN users u ON pm.user_id = u.id
LEFT JOIN subcontractors s ON u.subcontractor_id = s.id
WHERE pm.project_id = $1
ORDER BY
  CASE u.role
    WHEN 'project_manager' THEN 1
    WHEN 'koordinator' THEN 2
    WHEN 'pengawas' THEN 3
    WHEN 'subcontractor' THEN 4
    ELSE 5
  END;
```

**Contacts page layout:**

```
MANAJER PROYEK
━━━━━━━━━━━━━
Budi Hartono
[📱 Telegram]  [📞 Telepon]

KOORDINATOR
━━━━━━━━━━━━━
Dewi Pratiwi · GCR-A
[📱 Telegram]  [📞 Telepon]

PENGAWAS LAPANGAN
━━━━━━━━━━━━━
Budi Santoso · Blok A–B
[📱 Telegram]  [📞 Telepon]

Agus Raharjo · Blok C–D
[📱 Telegram]  [📞 Telepon]

SUBKONTRAKTOR
━━━━━━━━━━━━━
CV Bangun Jaya · Blok A, B
[📱 Telegram]  [📞 Telepon]

PT Mitra Konstruksi · Blok C
[📱 Telegram]  [📞 Telepon]
```

Contact buttons:
- Telegram → `https://t.me/{telegram_username}` or `https://t.me/+{phone_e164}`
- Phone → `tel:{phone}`
- Both open natively (Telegram app, phone dialer)

**Deep links — where "Contact" buttons appear:**

| Location | Button shown | Opens |
|---|---|---|
| Unit detail panel (manager) | Hubungi Pengawas | Pengawas assigned to this unit |
| Unit detail panel (manager) | Hubungi Subkontraktor | Subcontractor assigned to this unit |
| Review queue item | Hubungi yang mengerjakan | Subcontractor of that submission |
| Rejection notification (subcon) | Hubungi Koordinator | Koordinator who denied |
| Subcontractor dashboard | Hubungi Koordinator Proyek | Project koordinator |
| Field worker unit detail | Hubungi Pengawas Utama | Their assigned supervisor |

All links go directly to the correct person's Telegram or phone — not to a contacts list. One tap = direct contact.

**Nav rail icon:** people/team icon, last item before the divider.

**Session prompt:**
> "Build Stage 7 of NOTIFICATIONS-SPEC.md. Independent contacts page with all project parties. Contact buttons open Telegram and phone natively. Add deep links to unit detail panel, review queue, and subcontractor dashboard."

---

## Summary — build order

| Stage | Feature | Effort |
|---|---|---|
| 1 | Rejection fires to subcontractor Telegram | Small |
| 2 | Consequence language + payment amount | Small |
| 7 | Contacts page + deep links | Medium |
| 3 | PM notification controls panel | Medium |
| 4 | Auto-escalation chain (cron) | Medium |
| 6 | Morning briefing (cron) | Small |
| 5 | Auto-urgency detection | Medium |

**Recommended order:** 1 → 2 → 7 → 3 → 4 → 6 → 5

Stage 7 (contacts) can be built at any point after Stage 1 — it's independent.
Stages 4, 5, 6 all depend on the cron infrastructure built in Stage 4 — do them together.
