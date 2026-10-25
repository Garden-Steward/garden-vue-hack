# Explore garden page: volunteer view and manager workbench

Date: 2026-10-25
Status: built 2026-10-25 (volunteer view, shared sign-up, manager gate). Bed pinning was considered and dropped the same day: tasks stay general, not tied to a plot.
Repo: this one (Vue frontend, `garden-vue-hack`). No backend changes.

## Intent

When someone opens a garden on Explore (`/explore/:slug`), they should know within two seconds what the next workday is and which tasks need hands, and be able to claim a task right there if they can make it. Today the garden sheet is a stack of collapsible sections (Workdays, Tasks, Plots); only the first section with content opens, so tasks usually sit collapsed behind a count, and the plot list fills the rest of the panel.

The fix is two views of the same page:

- **Volunteer view.** For everyone who does not manage this garden. The side sheet goes away. The next workday and the open tasks float over the three.js island on desktop; on phones they live in a bottom sheet under the island. Every open task has an "I can help" button that opens the existing phone sign-up in place.
- **Manager workbench.** For the garden's managers only. This is the current sectioned sheet, unchanged: add and edit workdays, add and edit tasks, repeats, hidden tasks, and the plot layout editor. Managers land here.

## Goals

- A visitor sees the next workday with an RSVP button and every open task with a claim button without clicking, scrolling, or expanding anything.
- Claiming a task is the same request as today (SMS sign-up via `assignTaskViaSMS`) and completes without leaving the page.
- On a phone every actionable control is at least 44 px tall and nothing overlaps the island.
- Managers keep every editing affordance they have today, in the same place.

## Non-goals

- Changing the manager workbench's layout or behaviour. It is kept as-is.
- Changing the task or event backend in phase 1.
- One-tap claiming for signed-in volunteers without a phone number. The SMS flow stays the only way to claim.
- The Explore map view (`/explore` with no slug), garden cards, and the island markers. Unchanged.
- The separate garden pages (`/gardens/:slug`, the public task list). Unchanged.

## Anti-goals

- A manager of garden A seeing the workbench on garden B. The workbench is gated on being in that garden's `managerIds`, exactly as `isManager` is today.
- Tasks the public cannot see today (no `task_status`, or `ABANDONED`/`SKIPPED`/`FINISHED`) showing up in the volunteer view. The volunteer view uses the same `ACTIVE_TASK` filter as the garden cards.
- Canceled workdays appearing as the next workday. `nextEvent` already skips them; keep that.
- Colour as the only signal. Yellow still means "volunteers needed", and it always comes with words ("2 spots open").

## The people

**Visitor** (signed out) and **volunteer** (signed in, not a manager of this garden): volunteer view.

**Manager** (signed in, in this garden's `managerIds`): workbench, with a link to preview the volunteer view (my call, see Decisions).

## Volunteer view, desktop (width above 640 px)

Everything sits on top of the three.js scene. Four pieces, all using the existing dark `--ex-*` tokens and radii:

1. **Garden header card**, top left, about 300 px wide: "← Map" link, garden title, blurb, hosts line with avatar faces. Same content as the top of today's sheet header.
2. **Next workday card**, top right, about 300 px wide: label "Next workday", day and time line, title, full-width "I'm going" button (same `rsvpNextEvent` flow and "You're going" state as today, including the phone RSVP modal for signed-out people). Under a divider: the next two later workdays as "title · date" rows, then an "All N workdays →" link to the garden's events. If the garden has no upcoming workdays, this card is not rendered.
3. **Help-needed tray**, bottom, full width minus gutters: label "Help needed · N tasks" with the yellow dot, then one chip per task: title, spots line, "I can help" button. Full tasks show a grey "Full" button that does nothing. Chips scroll sideways when they overflow. If the garden has no open tasks, the tray is not rendered. Tasks are general to the garden; they are never tied to a bed on the island.

"I can help" opens the same content `ExploreTaskRow` shows today when open: overview, phone field prefilled from the user's profile, Sign up button, the "we'll text you" line, the done/error states, and the "Task details →" link. In the tray this expands the chip in place into a card; one task open at a time, same as `openTaskId` today.

The island keeps the footer hint "Drag to orbit · scroll or pinch to zoom · tap a bed". Tapping a bed still opens the existing plant panel (`explore-panel`).

## Volunteer view, phone (width 640 px and below)

The 640 px breakpoint is the one the Explore styles already use.

- **Top stack**, inside the gutter: a one-line garden header chip ("‹" back, title, hosts line) and, in the peek state only, a next workday chip with the date and title on the left and an "I'm going" button on the right.
- **Bottom sheet** with three heights:
  - *Peek*: grab bar, "Help needed · 5 tasks" with the yellow dot, a sub line "7 spots open · tap to see them", and a "Show ▴" control. About 80 px tall.
  - *Half*: top edge at roughly a third of the screen. The task list: one row per open task, 64 px minimum, title on the left over a spots line, and a full-size "I can help" button on the right. Full tasks get a grey "Full" button. After the tasks, one line "Next workdays: Nov 15, Nov 24 · All 14 →". The next workday chip leaves the top stack in this state so the island keeps room.
  - *Full*: same content, sheet reaches the header chip.
  - Drag the grab bar or tap "Show"/"Hide" to move between heights. The island stays visible above the sheet in peek and half.
- **Claiming**: "I can help" swaps the list for a single-task view: close "✕", title, spots line, overview, "Your phone number" label, a 48 px `tel` input with `inputmode="tel"`, a full-width Sign up button, the fine print. Done and error states as today. Close returns to the list at the same height.
- If there are no open tasks, the sheet is not rendered and the next workday chip stays at the top. If there are no workdays either, only the header chip shows.

## Accessibility

- Every control is at least 44 px tall and wide on phone; task rows are 64 px.
- Text on anything actionable is 15 px or larger. Meta lines may be 13 px.
- The bottom sheet is a `section` with `aria-label="Help needed"`. The tray on desktop is the same landmark.
- Each claim button has an accessible name "I can help with {task title}". Each RSVP button keeps its current name.
- Focus moves into the sign-up phone field when a task opens and back to its "I can help" button on close, as `ExploreTaskRow` does today.
- Sheet height changes are reachable by keyboard (the Show/Hide control) and are not drag-only.
- `prefers-reduced-motion` disables sheet and callout animation.

## Manager workbench

Unchanged from today's sheet: Workdays with "+ Add" and per-row Edit, Tasks with "+ Add", the Repeats list, hidden-task tags, Edit per row, Plots with Edit / "+ Lay out" and the plot editor. The one addition is a "View as volunteer" link in the sheet header that switches to the volunteer view for this garden (a local toggle, not a route change). From the volunteer view a manager sees a "Manage ›" pill in the garden header card to return. Nobody else ever sees either control.

## Data

Nothing new. Everything is already loaded on this page:

- `activityOf(slug).events` and `.tasks`, `nextEvent`, `laterEvents`, `spotsOf`, `ACTIVE_TASK` in `src/views/ExploreView.vue`.
- RSVP: `rsvpNextEvent`, `nextEventRsvped`, `showRsvpModal`.
- Sign-up: `ExploreTaskSignup.vue` (phone formatting, `assignTaskViaSMS`, done/error states), extracted from the task row so the manager's row, the tray, and the phone sheet render one form.
- `islandPlots` and the viewer's `setInset({ left, bottom })` to keep the island framed above the sheet or tray.

## Decisions the user made (theirs)

- Two views: a volunteer view built for the glance, and the existing sectioned sheet kept as a manager-only workbench.
- Managers land on the workbench. Only managers of that garden can reach it.
- On desktop, tasks and events overlay the three.js scene rather than sitting in a side sheet.
- On phone, tasks live in a bottom sheet with large targets; nothing floats over the island.
- Claiming means the existing SMS sign-up.
- Tasks stay general to the garden. Tying a task to a specific bed on the island was proposed as a second phase and declined.

## Decisions I made (mine, check these)

- Managers get a "View as volunteer" preview and a "Manage ›" way back. The user chose the workbench as the landing; the preview is my addition so managers can check how their garden reads.
- Desktop next workday card shows two later dates; the sheet on phone shows them as a single line after the tasks.
- Full tasks show a non-interactive grey "Full" control rather than being hidden, so the count on the label stays honest.
- The volunteer view hides the plot list entirely. The island is the plot view; tapping a bed opens the existing plant panel.
- No changes to any page other than `/explore/:slug`.

## Scope

One pass, this repo only: volunteer view on desktop and phone with the tray/sheet, header and next workday cards, extracted sign-up component, manager gate with preview toggle. Tests with Vitest for: view selection by `isManager`, the help summary and spots lines, sheet height state, and the component's claim, RSVP, and manage behaviours.

## Left to the builder

- Exact sheet snap heights, drag physics, and how the tray chip expands on desktop.
- Where the "All N workdays →" link goes (the garden's events list vs the public events page) as long as it lists this garden's workdays.
- How `setInset` is driven as the sheet moves, so the island re-frames without jitter.
- Component boundaries beyond the single shared sign-up component.

## Mockups

- `.superpowers/brainstorm/glance-vs-manage.html`: the two views side by side (A became the overlay; B is the workbench).
- `.superpowers/brainstorm/volunteer-overlay.html`: desktop volunteer view.
- `.superpowers/brainstorm/volunteer-phone.html`: phone states: landed, sheet pulled up, claiming.
