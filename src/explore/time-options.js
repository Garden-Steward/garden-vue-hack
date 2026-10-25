// Quarter-hour time choices for the Explore workday form.

const FIRST_MINUTE = 5 * 60; // 5:00 AM
const LAST_MINUTE = 22 * 60 + 45; // 10:45 PM

/** "13:30" → "1:30 PM" */
export function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Every quarter hour from 5:00 AM to 10:45 PM, as { value: "HH:MM", label: "h:mm AM" }. */
export const START_TIMES = Array.from({ length: (LAST_MINUTE - FIRST_MINUTE) / 15 + 1 }, (_, i) => {
  const value = toHHMM(FIRST_MINUTE + i * 15);
  return { value, label: timeLabel(value) };
});

/** End choices after `start`, each with its length ("2 hr 30 min"). */
export function endTimesAfter(start) {
  const from = minutesOf(start);
  const options = [];
  for (let m = from + 15; m <= 23 * 60 + 45; m += 15) {
    const length = m - from;
    const hours = Math.floor(length / 60);
    const mins = length % 60;
    const span = [hours ? `${hours} hr` : '', mins ? `${mins} min` : ''].filter(Boolean).join(' ');
    const value = toHHMM(m);
    options.push({ value, label: `${timeLabel(value)} (${span})` });
  }
  return options;
}

/** "4:00 PM" → "16:00", or null when it isn't one of our labels. */
export function parseTimeLabel(text) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(text || '').trim());
  if (!match) return null;
  let h = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') h += 12;
  return `${pad(h)}:${match[2]}`;
}

/** Local "YYYY-MM-DD" and "HH:MM" for an ISO timestamp. */
export function localParts(iso) {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}

/** Snaps "HH:MM" to the quarter hour at or before it, within the start range. */
export function snapToQuarter(hhmm) {
  const m = Math.min(LAST_MINUTE, Math.max(FIRST_MINUTE, Math.floor(minutesOf(hhmm) / 15) * 15));
  return toHHMM(m);
}
