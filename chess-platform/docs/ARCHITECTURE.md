# AI Chess Learning Platform — Architecture & Delivery Plan

## 0. Repository inspection summary

The existing `SalamLIR` repository (package name `netatlas-ipam`) is **NetAtlas IPAM**, an unrelated
internal tool for IP address management at a telecom (CIDR pool allocation, RIPE sync, Siebel/CST
integration). Relevant findings from inspection:

- Web: single Next.js 15 / React 19 app using a catch-all route (`app/[...path]/page.tsx`) that
  renders one large `App.tsx` (SPA-style, not per-route). Tailwind + local shadcn-style components
  in `components/ui/`, Radix primitives, TanStack Query/Table, Recharts, Axios.
- API: one large FastAPI monolith (`backend/main.py`), with a small modular layer started under
  `backend/ipam_core_services/` (`audit_service.py`, `inventory_service.py`, `assignment_service.py`).
- Data: SQLite for dev (`backend/ipam.db`), optional PostgreSQL in prod via `psycopg`, optional
  Oracle (`oracledb`) for a Siebel integration. No Redis, no Docker anywhere in the repo.
- Deploy: systemd unit files + nginx config under `deploy/` — no containers.
- No existing chess, school, lesson, or AI-coaching code of any kind.

**Decision (confirmed with the user):** the chess platform is a **new, separate application**
living under `chess-platform/` at the repo root. It does not import from, modify, or share a
database/auth system with the IPAM app. It reuses the same *tooling family* (Next.js + TypeScript,
FastAPI + Python) for consistency with this repo, but is otherwise fully isolated — a different
`package.json`, its own FastAPI app, its own Postgres database/schema, its own deployment unit.

Because the brief asks for Docker-based local dev and this repo currently has none, Docker Compose
is added *scoped to `chess-platform/` only* (its own `docker-compose.yml`) — it does not touch or
replace the IPAM app's systemd/nginx deployment.

---

## 1. Principles (non-negotiable)

1. **Teachers lead; AI assists.** No AI output ever writes to student records, assessments, grades,
   curriculum, or class membership. AI is read-only against application data.
2. **Chess rules are deterministic, not AI.** All legality, check/checkmate/stalemate, castling, en
   passant, promotion, and puzzle-solution checking are done by a trusted chess rules library on the
   server. The AI coach never adjudicates a move.
3. **Server-enforced RBAC.** Every authorization decision is re-checked server-side per request.
   The browser is never trusted as an access-control boundary.
4. **Least data, audited changes.** Collect only what's needed for learning; log administrative and
   student-record changes to an append-only audit trail.

---

## 2. Module boundaries

Each module below is a Python package under `chess-platform/api/app/modules/<name>/` with its own
router, service layer, and Pydantic schemas, plus a corresponding slice of the Postgres schema. The
only module allowed to make outbound AI calls is `ai_coaching`.

| Module | Responsibility | Can write? |
|---|---|---|
| `identity` | Accounts, sessions, password/credential handling, roles | yes |
| `schools` | School entities, settings, first-run setup, platform admin view | yes |
| `classrooms` | Classes, rosters, enrollment/invitations, teacher assignment | yes |
| `student_profiles` | Student-owned profile data, privacy-minimal fields | yes |
| `chess_games` | Game records, PGN/FEN storage, history, review access | yes |
| `chess_rules` | Deterministic move validation engine (wraps `python-chess`) | n/a (pure logic, no DB) |
| `curriculum` | Courses/lessons/activities authored or approved by teachers | yes |
| `puzzles` | Puzzle bank, verified positions/solutions, attempts | yes |
| `assessment` | Formal assessments, results, teacher review | yes |
| `progress` | Rollups of completion/attempts for student + class views | yes (derived only, from verified events) |
| `ai_coaching` | Context-scoped chat/hints using only approved, verified context | **read-only** against everything else |
| `analytics` | Aggregate, non-identifying usage metrics for admins | read-only |
| `notifications` | In-app/email notifications (invites, assignment alerts) | yes |
| `audit_safety` | Append-only audit log, content safety checks on AI output | append-only |

`chess_rules` is a pure library module (no persistence) so it can be unit-tested exhaustively and
reused by both `chess_games` (live play) and `puzzles` (solution checking) without duplicating rule
logic.

**Enforcing "AI is read-only" at more than the code-review level:** the `ai_coaching` module
connects to Postgres using a dedicated DB role (`chess_ai_readonly`) granted `SELECT` only on the
views it's allowed to read (a curated set — not raw tables with other students' data). Even a bug in
`ai_coaching` application code cannot issue a write; the database itself refuses it.

---

## 3. Data model (PostgreSQL, high-level)

```
schools (id, name, status, settings_json, created_at)
users (id, school_id, role[student|teacher|school_admin|platform_admin],
       email, password_hash, status, created_at)
invitations (id, school_id, class_id?, email, role, token_hash, expires_at, accepted_at)

classes (id, school_id, teacher_id, name, status, created_at)
class_memberships (id, class_id, student_id, status, joined_at)

student_profiles (user_id FK, display_name, grade_level?, privacy_settings_json)

courses (id, school_id?, title, description, created_by, approved boolean)
lessons (id, course_id, title, content_json, order_index)
activities (id, lesson_id, type, payload_json)
assignments (id, class_id|student_id, content_type, content_id, assigned_by, due_at)

puzzles (id, fen, solution_moves_json, rating, tags, verified boolean)
puzzle_attempts (id, puzzle_id, student_id, moves_json, result, hints_used, duration_s, created_at)

games (id, white_user_id, black_user_id|null, pgn, fen_final, result, created_at, reviewed_by?)

assessments (id, class_id, title, type, items_json, open_at, close_at, created_by)
assessment_results (id, assessment_id, student_id, score, detail_json, graded_by, created_at)

progress_events (id, student_id, source_type, source_id, event_type, created_at)  -- append-only
recommendations (id, student_id, basis_json, explanation, created_by='ai', created_at)
  -- recommendations are suggestions only; never joined into grading/record tables

audit_log (id, actor_user_id, school_id, action, target_type, target_id, before_json, after_json, created_at)
ai_conversations (id, student_id, context_type, context_id, created_at)
ai_messages (id, conversation_id, role, content, created_at)  -- AI side is logged for safety review
```

Indexes/constraints to add in migrations: unique `(school_id, email)` on `users`; FK + cascade rules
sized to "soft delete, never hard-delete student records"; `progress_events` and `audit_log` are
insert-only (no UPDATE/DELETE grants for the application role).

---

## 4. RBAC matrix (server-enforced on every request)

| Resource | Student | Teacher | School Admin | Platform Admin |
|---|---|---|---|---|
| Own profile/progress | read/update profile fields | — | — | — |
| Assigned lessons/puzzles | read, attempt | — | — | — |
| Own games | read/create/play | — | — | — |
| Class roster (own classes) | — | manage | manage (own school) | — |
| Curriculum authoring | — | create/assign | approve/manage | — |
| Assessments | attempt (assigned) | create/grade/review | manage (own school) | — |
| Other students' records | **no access** | only own class's students | only own school | no (support-scoped, audited) |
| School settings/users | — | — | manage | manage |
| Platform config | — | — | — | manage |
| AI coach toggle | — | per-class on/off | per-school default | platform default |

Implementation: a single `require_role_and_scope(resource, action)` dependency in FastAPI, backed by
a scope resolver that checks class/school ownership — not just role name — before any query runs.

---

## 5. AI coach context flow

1. Frontend asks a question "about this puzzle/lesson/game" with an opaque `context_id`.
2. `ai_coaching` service resolves `context_id` → fetches **only** the verified, approved
   content (lesson text, puzzle FEN + rules-engine state, game FEN/PGN) via the read-only views —
   never raw free text from other students or teacher-private notes.
3. It builds a system prompt stating the rules above explicitly (no rules adjudication, no solution
   reveal unless allowed, no fabrication, defer to teacher when uncertain) plus the verified context.
4. Model is called (provider to be confirmed — see Open Decisions).
5. Response is logged to `ai_messages` for safety review and returned. If a class/school has the AI
   coach disabled, the endpoint 403s before step 2.

---

## 6. Suggested stack & justification

| Choice | Reason |
|---|---|
| Next.js 15 + React + TypeScript (web) | Matches repo convention; brief's suggested stack. New app, proper `app/` router (not the catch-all SPA pattern used by IPAM). |
| FastAPI + Python (api) | Matches repo convention; brief's suggested stack. |
| PostgreSQL | Brief's suggested store; supports row-level constraints, dedicated read-only DB role for AI isolation, migrations. |
| Redis | Only for session/rate-limit coordination and puzzle-attempt rate limiting — brief says "only where needed," so it's introduced but kept out of the core data path. |
| `python-chess` (server) | Mature, deterministic, battle-tested chess rules engine — the single source of truth for legality/check/mate/stalemate/promotion/en passant/castling and PGN/FEN I/O. |
| `chess.js` + `react-chessboard` (web) | Client-side optimistic UI/board rendering only; every move is still re-validated server-side by `python-chess` before being accepted — the client library never has authority. |
| Docker Compose (local dev) | Brief explicitly asks for it; scoped to `chess-platform/` so it doesn't affect the existing IPAM deployment. |
| Auth: self-contained email+password with JWT sessions, Argon2 password hashing, invitation tokens | Keeps the new app decoupled from IPAM's Keycloak instance (different product, different schools/users). Open to adding SSO later — see Open Decisions. |

No other third-party services are added without flagging them here first.

---

## 7. Phased delivery plan

**Phase 1 — done:** this inspection + architecture document.

**Phase 2 — this document** (architecture, data model, security boundaries, plan) for review.

**Phase 3 — vertical slice** (first code phase):
- `identity`: sign-up/sign-in, password hashing, sessions, school-scoped accounts.
- `schools`: first-run school admin setup flow.
- `classrooms`: teacher creates a class; student joins via teacher-issued invitation/code.
- `curriculum` + `puzzles`: exactly one lesson and one verified puzzle, deterministically validated
  by `python-chess`.
- `progress`: teacher sees that the student completed the lesson/puzzle.
- No AI yet. No full game play yet (that's Phase 4). Dockerized local dev for web+api+db.

**Phase 4:** full gameplay (live games, PGN/FEN import-export, teacher review of assigned games),
curriculum management UI, assignments, assessments + grading.

**Phase 5:** AI coach, behind a per-class/per-school teacher toggle, using the read-only context flow
in §5.

**Phase 6:** audit logging surfaced in UI, accessibility pass (WCAG 2.2 AA), operational docs,
production deployment config (systemd or container deploy, mirroring `deploy/` conventions used for
IPAM but in a new `chess-platform/deploy/`).

Each phase: usable end-to-end, tests run with exact commands/output reported, docs and
`.env.example` updated, blockers called out explicitly rather than assumed.

---

## 8. Open decisions to confirm before/at Phase 3

These are defaults I'll build against unless told otherwise — flagging per the brief's instruction
to explain/document stack choices and surface blockers rather than silently assuming:

1. **AI provider/credentials** — Phase 5 needs an API key (e.g. `ANTHROPIC_API_KEY`) supplied via
   env var. Not blocking for Phases 3–4; the AI coach ships disabled until a key is provided.
2. **Auth approach** — self-contained JWT auth (above) vs. integrating school SSO/Keycloak later.
   Defaulting to self-contained for now since no SSO requirement was given.
3. **Invitation delivery** — real email sending needs an email provider (SMTP/SES/etc.) and
   credentials. For Phase 3 the vertical slice will support teacher-generated join codes/links
   (no email dependency); real email delivery lands with `notifications` in a later phase once a
   provider is chosen.
4. **Production hosting target** — not needed until Phase 6; local Docker Compose dev is unaffected.
