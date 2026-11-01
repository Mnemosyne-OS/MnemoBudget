/**
 * Every key the code asks for exists in the three languages, and the three
 * files carry the same keys. A missing key renders its raw name on screen,
 * or worse, is SPOKEN by the orb.
 */
import en from './en.json';
import fr from './fr.json';
import es from './es.json';

// Vite reads the sources as text: no Node types needed in the cartridge.
const SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Keys built at runtime from a literal prefix, expanded to their real values. */
const DYNAMIC: Record<string, string[]> = {
  'say.planned.': ['once', 'weekly', 'monthly', 'yearly'],
  'entry.repeat.': ['none', 'weekly', 'monthly', 'yearly'],
  'entry.': ['paid', 'planned'],
  'lines.': ['all', 'paid', 'planned', 'review'],
  'starter.': ['home', 'family', 'work', 'rent', 'groceries', 'dog', 'cleaner', 'children', 'school', 'health', 'workRent', 'suppliers', 'wages'],
};
/** Keys chosen by a condition (`t(a ? 'x' : 'y')`) or carried by a table (the tabs' `key`), which the scan cannot read. */
const CHOSEN = ['say.added', 'say.added.newCategory', 'say.unknownDay', 'say.whenPlanned', 'review.paid', 'review.planned', 'entry.titleNew', 'entry.titleEdit', 'entry.day', 'entry.dueDay',
  'nav.dashboard', 'nav.pockets', 'nav.lines', 'nav.review', 'nav.settings'];
const COUNTED = ['say.unconverted', 'say.review', 'month.unconverted', 'error.unreadable'];

function wanted(): Set<string> {
  const keys = new Set<string>();
  for (const code of Object.values(SOURCES)) {
    for (const m of code.matchAll(/\bt\(\s*'([^'`]+)'/g)) keys.add(m[1]!);
    for (const m of code.matchAll(/\btc\(\s*'([^'`]+)'/g)) ['one', 'many'].forEach((n) => keys.add(`${m[1]}.${n}`));
  }
  for (const [prefix, values] of Object.entries(DYNAMIC)) values.forEach((v) => keys.add(prefix + v));
  CHOSEN.forEach((k) => keys.add(k));
  for (const base of COUNTED) ['one', 'many'].forEach((n) => keys.add(`${base}.${n}`));
  return keys;
}

describe('locales', () => {
  const dicts = { en, fr, es } as Record<string, Record<string, string>>;

  it('finds the keys at all (the scan is not silently empty)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    expect(wanted().size).toBeGreaterThan(100);
  });

  it.each(['en', 'fr', 'es'])('%s has every key the code uses', (lang) => {
    const missing = [...wanted()].filter((k) => !(k in dicts[lang]!));
    expect(missing).toEqual([]);
  });

  it('the three files carry the same keys', () => {
    const base = Object.keys(en).sort();
    expect(Object.keys(fr).sort()).toEqual(base);
    expect(Object.keys(es).sort()).toEqual(base);
  });
});
