// Pure helpers for the Explore garden page's volunteer view: which view a
// visitor gets, what the "Help needed" summary says, and how the phone sheet
// moves between its heights.

/** Managers land on the workbench; everyone else gets the volunteer view. A manager's preview toggle wins over the default. */
export function pickView({ isManager, override = null }) {
    if (!isManager) return 'volunteer';
    return override === 'volunteer' ? 'volunteer' : 'manage';
}

export const maxOf = (t) => t.max_volunteers || 1;
export const countOf = (t) => (Array.isArray(t.volunteers) ? t.volunteers.length : 0);
export const spotsOf = (t) => Math.max(0, maxOf(t) - countOf(t));
export const isFull = (t) => spotsOf(t) === 0;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 spots open", or "Full · 2 of 2" once every spot is taken. */
export function spotsLine(t) {
    const spots = spotsOf(t);
    return spots ? `${plural(spots, 'spot')} open` : `Full · ${countOf(t)} of ${maxOf(t)}`;
}

/** The sheet/tray label and its sub line. */
export function helpSummary(tasks) {
    const count = tasks.length;
    const spots = tasks.reduce((n, t) => n + spotsOf(t), 0);
    return {
        count,
        spots,
        label: `Help needed · ${plural(count, 'task')}`,
        sub: spots ? `${plural(spots, 'spot')} open · tap to see them` : 'Every spot is taken · tap to see them'
    };
}

/** "Next workdays: Nov 15, Nov 24" for the phone sheet's last line; '' with nothing to show. */
export function laterLine(events, formatDay) {
    if (!events.length) return '';
    return `Next workdays: ${events.map(e => formatDay(e.startDatetime)).join(', ')}`;
}

export const SHEET_HEIGHTS = ['peek', 'half', 'full'];

/** One step up or down through peek → half → full, clamped at the ends. */
export function nextSheetHeight(current, dir) {
    const i = Math.max(0, SHEET_HEIGHTS.indexOf(current));
    const next = Math.min(SHEET_HEIGHTS.length - 1, Math.max(0, i + (dir === 'up' ? 1 : -1)));
    return SHEET_HEIGHTS[next];
}
