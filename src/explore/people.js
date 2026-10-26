// Who's committed to a garden and where each person stands: on a task, done,
// on a reserve list, going to the workday, or dropped off recently.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const isFinished = (t) => String(t.task_status || '').toUpperCase() === 'FINISHED';
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export const STATUS_LABEL = {
    done: 'Done',
    doneToday: 'Done today',
    signedUp: 'Signed up',
    going: 'Going',
    reserve: 'Reserve',
    dropped: "Can't make it"
};
// Highest first: what the pill shows when a person has several.
const RANK = ['doneToday', 'done', 'signedUp', 'going', 'reserve', 'dropped'];

export const personName = (u) => [u?.firstName, u?.lastName ? `${String(u.lastName)[0]}.` : ''].filter(Boolean).join(' ') || u?.username || '';
export const personInitials = (u) => ((u?.firstName?.[0] || u?.username?.[0] || '') + (u?.lastName?.[0] || '')).toUpperCase() || '?';

/**
 * @param {object} args
 * @param {Array} args.tasks open tasks (with volunteers, reserves, dropped)
 * @param {Array} args.history recent tasks of any status, with completed_at and volunteers
 * @param {object|null} args.event the next workday, with `confirmed`
 * @param {number|null} args.userId the signed-in user
 * @param {Date} args.now
 * @returns {Array} people sorted: you first, then by rank, then by name
 */
export function volunteersOf({ tasks = [], history = [], event = null, userId = null, now = new Date() }) {
    const byId = new Map();
    const person = (u) => {
        const id = typeof u === 'object' ? u.id : u;
        if (id == null) return null;
        let p = byId.get(id);
        if (!p) {
            p = { id, user: typeof u === 'object' ? u : { id }, statuses: new Set(), tasks: [], doneCount: 0, doneToday: false, me: id === userId };
            byId.set(id, p);
        } else if (typeof u === 'object' && !p.user.firstName && u.firstName) {
            p.user = u;
        }
        return p;
    };

    for (const t of tasks) {
        for (const v of t.volunteers || []) {
            const p = person(v);
            if (!p) continue;
            p.statuses.add('signedUp');
            p.tasks.push({ id: t.id, title: t.title, status: 'signedUp' });
        }
        for (const r of t.reserves || []) {
            const p = person(r);
            if (!p) continue;
            p.statuses.add('reserve');
            p.tasks.push({ id: t.id, title: t.title, status: 'reserve', position: (t.reserves || []).findIndex(x => (x.id ?? x) === p.id) + 1 });
        }
        for (const d of t.dropped || []) {
            if (!d?.user || !d.at || now - new Date(d.at) > WEEK_MS) continue;
            const p = person(d.user);
            if (!p) continue;
            p.statuses.add('dropped');
            p.tasks.push({ id: t.id, title: t.title, status: 'dropped', at: d.at });
        }
    }
    for (const t of history) {
        if (!isFinished(t) || !t.completed_at || now - new Date(t.completed_at) > WEEK_MS) continue;
        for (const v of t.volunteers || []) {
            const p = person(v);
            if (!p) continue;
            p.statuses.add('done');
            p.doneCount++;
            if (sameDay(t.completed_at, now)) {
                p.doneToday = true;
                p.statuses.add('doneToday');
            }
            p.tasks.push({ id: t.id, title: t.title, status: 'done', at: t.completed_at });
        }
    }
    for (const c of event?.confirmed || []) {
        const p = person(c);
        if (!p) continue;
        p.statuses.add('going');
        p.tasks.push({ id: `event-${event.id}`, title: event.title, status: 'going' });
    }

    const list = [...byId.values()].map(p => {
        const primary = RANK.find(s => p.statuses.has(s)) || 'signedUp';
        const onIsland = p.statuses.has('signedUp') || p.statuses.has('going') || p.doneToday;
        return { ...p, statuses: [...p.statuses], primary, onIsland, name: personName(p.user), initials: personInitials(p.user) };
    });
    list.sort((a, b) => (b.me - a.me) || (RANK.indexOf(a.primary) - RANK.indexOf(b.primary)) || b.doneCount - a.doneCount || a.name.localeCompare(b.name));
    return list;
}

/** Where the signed-in user stands on one task. */
export function myStanding(task, userId) {
    if (userId == null) return 'none';
    const has = (list) => (list || []).some(u => (u.id ?? u) === userId);
    if (has(task.volunteers)) return 'on';
    if (has(task.reserves)) return task.reserve_offer_user === userId ? 'offered' : 'reserve';
    return 'none';
}

export const reservePosition = (task, userId) => (task.reserves || []).findIndex(u => (u.id ?? u) === userId) + 1;
