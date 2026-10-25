// Repeating tasks on Explore: the choices, a plain-language summary, and whether
// one is due today. The backend decides the same thing for its daily cron in
// steward-bank-hack's src/utils/repeat-schedule.js; keep the two in step.

export const FREQUENCIES = [
    { value: 'daily', label: 'Every day' },
    { value: 'weekly', label: 'Every week' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Every month' },
    { value: 'quarterly', label: 'Every 3 months' }
];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekly and biweekly repeats pick weekdays; the rest don't. */
export const usesDays = (frequency) => frequency === 'weekly' || frequency === 'biweekly';
/** Biweekly counts weeks from a start; monthly and quarterly repeat on its day of the month. */
export const usesStart = (frequency) => frequency === 'biweekly' || frequency === 'monthly' || frequency === 'quarterly';

// A task's name comes from its type.
export const TYPE_NAMES = {
    Water: 'Watering',
    Weeding: 'Weeding',
    Planting: 'Planting',
    Harvest: 'Harvest',
    General: 'Garden care'
};

const ordinal = (n) => {
    const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return `${n}${tail}`;
};
const shortDays = (days) => WEEKDAYS.filter(d => days.includes(d)).map(d => d.slice(0, 3)).join(', ');
const dayOfMonth = (ymd) => Number(String(ymd || '').slice(8, 10)) || null;

/** "Every Tue, Wed, Thu", "Every 2 weeks on Mon", "Monthly on the 15th"… */
export function repeatSummary({ repeat_frequency: frequency, repeat_days: days, repeat_start: start }) {
    const list = Array.isArray(days) ? days : [];
    const dom = dayOfMonth(start);
    switch (frequency || 'daily') {
        case 'daily':
            return 'Every day';
        case 'weekly':
            return list.length === 7 ? 'Every day' : list.length ? `Every ${shortDays(list)}` : 'No days picked';
        case 'biweekly':
            return list.length ? `Every 2 weeks on ${shortDays(list)}` : 'No days picked';
        case 'monthly':
            return dom ? `Monthly on the ${ordinal(dom)}` : 'Monthly';
        case 'quarterly':
            return dom ? `Every 3 months on the ${ordinal(dom)}` : 'Every 3 months';
        default:
            return '';
    }
}

const parseDay = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const dayNumber = ({ y, m, d }) => Math.floor(Date.UTC(y, m, d) / 86400000);
const weekday = (day) => (dayNumber(day) + 4) % 7; // 1970-01-01 was a Thursday
const weekNumber = (day) => (dayNumber(day) - weekday(day)) / 7;

/** Is this repeat due on the given local calendar day? Mirrors the backend's isDueOn. */
export function isDueOn(repeat, now = new Date()) {
    const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    const start = parseDay(repeat.repeat_start);
    if (start && dayNumber(today) < dayNumber(start)) return false;
    const frequency = repeat.repeat_frequency || 'daily';
    if (frequency === 'daily') return true;
    if (usesDays(frequency)) {
        if (!(repeat.repeat_days || []).includes(WEEKDAYS[weekday(today)])) return false;
        if (frequency === 'weekly' || !start) return true;
        return (weekNumber(today) - weekNumber(start)) % 2 === 0;
    }
    if (!start) return false;
    const months = (today.y - start.y) * 12 + (today.m - start.m);
    if (months % (frequency === 'quarterly' ? 3 : 1) !== 0) return false;
    const lastDay = new Date(today.y, today.m + 1, 0).getDate();
    return today.d === Math.min(start.d, lastDay);
}
