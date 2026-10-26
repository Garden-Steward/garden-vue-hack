// Garden health from task completions: a 14-day strip, the current streak,
// and whether the garden is thriving, steady, or short of hands.
//
// A day counts when repeating tasks were due that day. The daily cron creates
// that day's task from each repeating template, so "due on day D" means a task
// with a repeating template that was created on D. One-off tasks never make
// or break a day; they only count towards "done this week".

export const DAYS = 14;
export const RECENT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const isFinished = (t) => String(t.task_status || '').toUpperCase() === 'FINISHED';
const isOpen = (t) => !['FINISHED', 'ABANDONED', 'SKIPPED'].includes(String(t.task_status || '').toUpperCase());
const repeating = (t) => !!t.recurring_task;

/** Local calendar day as 'YYYY-MM-DD'. */
export function dayKey(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** 'none' | 'done' | 'part' | 'miss' for the tasks due on one day. */
function dayState(due) {
    if (!due.length) return 'none';
    const done = due.filter(isFinished).length;
    if (done === due.length) return 'done';
    return done ? 'part' : 'miss';
}

/**
 * @param {Array} tasks every task of the garden from the last 14 days, any status
 * @param {Date} now
 */
export function computeHealth(tasks, now = new Date()) {
    const today = startOfDay(now);
    const todayKey = dayKey(today);
    const byDay = new Map();
    for (const t of tasks) {
        if (!repeating(t) || !t.createdAt) continue;
        const k = dayKey(t.createdAt);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(t);
    }

    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) {
        const date = new Date(today.getTime() - i * DAY_MS);
        const key = dayKey(date);
        const due = byDay.get(key) || [];
        let state = dayState(due);
        // Today isn't over: nothing finished yet is "pending", not a miss.
        if (key === todayKey && state === 'miss') state = 'pending';
        days.push({ key, state, due: due.length, done: due.filter(isFinished).length, today: key === todayKey });
    }

    // Streak: consecutive done days ending today (if done) or yesterday. Quiet days don't break it.
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        const s = days[i].state;
        if (s === 'none' || s === 'pending') continue;
        if (s === 'done') streak++;
        else break;
    }
    let best = 0;
    let run = 0;
    for (const d of days) {
        if (d.state === 'none' || d.state === 'pending') continue;
        run = d.state === 'done' ? run + 1 : 0;
        best = Math.max(best, run);
    }
    best = Math.max(best, streak);

    const counted = days.filter(d => d.state !== 'none' && d.state !== 'pending');
    const due14 = counted.reduce((n, d) => n + d.due, 0);
    const done14 = counted.reduce((n, d) => n + d.done, 0);
    const week = days.slice(-7);
    const dueWeek = week.reduce((n, d) => n + d.due, 0);
    const doneWeek = week.reduce((n, d) => n + d.done, 0);
    const weekStart = today.getTime() - 6 * DAY_MS;
    const doneWeekAll = tasks.filter(t => isFinished(t) && t.completed_at && startOfDay(t.completed_at).getTime() >= weekStart).length;
    const recent = days.slice(-1 - RECENT_DAYS, -1); // the days before today
    const missedDays = recent.filter(d => d.state === 'miss' || d.state === 'part').length;
    const missedTasks = recent.reduce((n, d) => n + (d.due - d.done), 0);

    // Open repeating tasks from before today are overdue.
    const overdue = tasks
        .filter(t => repeating(t) && isOpen(t) && t.createdAt && startOfDay(t.createdAt) < today)
        .map(t => ({ task: t, days: Math.round((today - startOfDay(t.createdAt)) / DAY_MS) }))
        .sort((a, b) => b.days - a.days);

    let level;
    if (!due14) level = 'quiet';
    else if (streak >= 7 || done14 / due14 >= 0.9) level = 'thriving';
    else if (done14 / due14 < 0.6 || missedDays >= 2) level = 'needs';
    else level = 'steady';

    return { level, streak, best, days, due14, done14, dueWeek, doneWeek, doneWeekAll, missedDays, missedTasks, overdue };
}

export const LEVEL_LABEL = { thriving: 'Thriving', steady: 'Steady', needs: 'Needs hands', quiet: 'Getting started' };

/** One plain sentence under the badge. */
export function healthNudge(h) {
    if (h.level === 'needs') {
        const first = h.overdue[0];
        const where = first ? ` "${first.task.title}" has been waiting ${first.days === 1 ? 'a day' : `${first.days} days`}.` : '';
        return `${h.missedTasks === 1 ? '1 task' : `${h.missedTasks} tasks`} missed in the last ${RECENT_DAYS} days.${where}`;
    }
    if (h.level === 'thriving') return h.streak ? 'Every task done, day after day.' : 'Nearly every task done this fortnight.';
    if (h.level === 'steady') return 'Most tasks get done. A few more hands would make it thrive.';
    return 'No repeating tasks yet. The streak starts with the first one.';
}
