import { describe, expect, it } from 'vitest';
import { guessCategory, parseReceipt } from './receipt';
import type { BudgetSettings } from './types';

const TODAY = '2026-10-26';

/** What RapidOCR hands back for a French supermarket ticket (lines, no layout). */
const CARREFOUR = `CARREFOUR MARKET
12 RUE DE LA GARE 75010 PARIS
TEL 01 42 00 00 00
SIRET 652 014 051 00017
24/10/2026 12:31 CAISSE 03
LAIT DEMI ECREME 1L 1,05
CROQUETTES CHIEN 10KG 32,90
PAIN DE MIE 2,15
SOUS-TOTAL 36,10
REMISE CARTE -1,00
TOTAL TTC 35,10
CB 35,10
ESPECES 0,00
TVA 5,5% 1,83
MERCI DE VOTRE VISITE
CARTE FIDELITE VALABLE JUSQU'AU 31/12/2027`;

const RESTAURANT = `LE PETIT BISTRO
Table 4 - 2 couverts
26/10/2026 20:45
Menu du jour x2 38,00
Vin rouge 25cl 6,50
Cafe x2 4,40
Total 48,90 EUR
Rendu 1,10
Merci, a bientot`;

const PHARMACIE = `PHARMACIE DU CENTRE
Doliprane 1000 x1 2,18
Spray nasal 6,90
A PAYER 9,08 €
Carte bancaire 9,08
Le 25.10.26 a 09h12`;

const MARJANE = `MARJANE CASABLANCA
25/10/2026 18:02
HUILE 5L 85,00
SUCRE 2KG 12,50
TOTAL 97,50 DH
CB 97,50`;

const NO_TOTAL = `BOULANGERIE PAUL
Baguette 1,20
Croissant 1,30
24/10/2026`;

const settings: BudgetSettings = {
  version: 1, baseCurrency: 'EUR', memory: false, rates: {},
  pockets: [
    { id: 'home', name: 'Maison', icon: '🏠', categories: [{ id: 'rent', name: 'Loyer' }, { id: 'food', name: 'Courses' }, { id: 'dog', name: 'Chien' }, { id: 'clean', name: 'Ménage' }] },
    { id: 'family', name: 'Famille', categories: [{ id: 'kids', name: 'Enfants' }, { id: 'school', name: 'École' }, { id: 'health', name: 'Santé' }] },
    { id: 'work', name: 'Pro', categories: [{ id: 'wrent', name: 'Loyer du local' }, { id: 'sup', name: 'Fournisseurs' }, { id: 'wages', name: 'Salaires' }] },
  ],
};

describe('parseReceipt — the amount comes from a line that NAMES the total', () => {
  it('a supermarket ticket: TOTAL TTC wins over the subtotal, the discount, the cash line and the VAT', () => {
    const r = parseReceipt(CARREFOUR, TODAY);
    expect(r.amountCents).toBe(3510);
    expect(r.merchant).toBe('CARREFOUR MARKET');
    expect(r.currency).toBeUndefined();
    expect(r.amountsSeen).toContain(3290);
  });

  it('the date beside a time of day wins over a loyalty card\'s expiry, which is after today anyway', () => {
    expect(parseReceipt(CARREFOUR, TODAY).day).toBe('2026-10-24');
  });

  it('a restaurant: « Total 48,90 EUR » with its currency; « Rendu » never counts', () => {
    const r = parseReceipt(RESTAURANT, TODAY);
    expect(r.amountCents).toBe(4890);
    expect(r.currency).toBe('EUR');
    expect(r.day).toBe('2026-10-26');
    expect(r.merchant).toBe('LE PETIT BISTRO');
  });

  it('« A PAYER 9,08 € » outranks the card line; a dotted date with « a 09h12 » is read', () => {
    const r = parseReceipt(PHARMACIE, TODAY);
    expect(r.amountCents).toBe(908);
    expect(r.currency).toBe('EUR');
    expect(r.day).toBe('2026-10-25');
  });

  it('a Moroccan ticket: « DH » is MAD', () => {
    const r = parseReceipt(MARJANE, TODAY);
    expect(r.amountCents).toBe(9750);
    expect(r.currency).toBe('MAD');
  });

  it('🎭 no line names the total: the amount is ABSENT and the amounts read are offered as hints', () => {
    const r = parseReceipt(NO_TOTAL, TODAY);
    expect(r.amountCents).toBeUndefined();
    expect(r.amountsSeen).toEqual([120, 130]);
    expect(r.day).toBe('2026-10-24');
    expect(r.merchant).toBe('BOULANGERIE PAUL');
  });

  it('🎭 a date after today or older than two years does not stand; a day that does not exist is not a date', () => {
    expect(parseReceipt('TOTAL 5,00\n31/02/2026', TODAY).day).toBeUndefined();
    expect(parseReceipt('TOTAL 5,00\n01/11/2026', TODAY).day).toBeUndefined();
    expect(parseReceipt('TOTAL 5,00\n01/01/2023', TODAY).day).toBeUndefined();
    expect(parseReceipt('TOTAL 5,00\n2026-10-20', TODAY).day).toBe('2026-10-20');
    expect(parseReceipt('TOTAL 5,00\n20 octobre 2026', TODAY).day).toBe('2026-10-20');
  });

  it('thousands are read (« 1 234,56 », « 1.234,56 ») and a bare integer is never an amount', () => {
    expect(parseReceipt('TOTAL 1 234,56', TODAY).amountCents).toBe(123456);
    expect(parseReceipt('TOTAL 1.234,56', TODAY).amountCents).toBe(123456);
    expect(parseReceipt('TOTAL 1234', TODAY).amountCents).toBeUndefined();
  });

  it('the LAST total line wins when several name it (TTC printed after HT)', () => {
    const r = parseReceipt('TOTAL HT 10,00\nTVA 2,00\nTOTAL TTC 12,00\nCB 12,00', TODAY);
    expect(r.amountCents).toBe(1200);
  });
});

describe('guessCategory — a word match, never the nearest', () => {
  it('a merchant the table knows lands on the person\'s category of that name (Carrefour → Courses, Maison)', () => {
    const g = guessCategory(parseReceipt(CARREFOUR, TODAY), settings);
    expect(g).not.toBeNull();
    expect(g).not.toBe('ambiguous');
    if (g && g !== 'ambiguous') expect([g.pocket.name, g.category.name]).toEqual(['Maison', 'Courses']);
  });

  it('the merchant decides first: a Carrefour ticket with a dog-food line is Courses, not Chien', () => {
    const g = guessCategory(parseReceipt(CARREFOUR, TODAY), { ...settings, pockets: [{ id: 'home', name: 'Maison', categories: [{ id: 'dog', name: 'Chien' }, { id: 'food', name: 'Courses' }] }] });
    if (g && g !== 'ambiguous') expect(g.category.name).toBe('Courses'); else throw new Error(`expected Courses, got ${String(g)}`);
  });

  it('a merchant nobody knows lets the item lines speak, by the person\'s own names (« CROQUETTES CHIEN » → Chien)', () => {
    const g = guessCategory(parseReceipt('SUPERETTE DU COIN\nCROQUETTES CHIEN 12,00\nTOTAL 12,00', TODAY), settings);
    if (g && g !== 'ambiguous') expect(g.category.name).toBe('Chien'); else throw new Error(`expected Chien, got ${String(g)}`);
  });

  it('a pharmacy lands on Santé; a restaurant with no category of that name asks', () => {
    const p = guessCategory(parseReceipt(PHARMACIE, TODAY), settings);
    if (p && p !== 'ambiguous') expect(p.category.name).toBe('Santé'); else throw new Error(`expected Santé, got ${String(p)}`);
    expect(guessCategory(parseReceipt(RESTAURANT, TODAY), settings)).toBeNull();
  });

  it('🚨 a merchant line naming two categories is ambiguous: the person is asked', () => {
    const r = parseReceipt('PHARMACIE ET ANIMALERIE DU PORT\nTOTAL 20,00', TODAY);
    expect(guessCategory(r, settings)).toBe('ambiguous');
    // And a known merchant with an unrelated item line is not: Metro → Fournisseurs, whatever the lines say.
    const metro = guessCategory(parseReceipt('METRO CASH AND CARRY\nCROQUETTES 20,00\nTOTAL 20,00', TODAY), settings);
    if (metro && metro !== 'ambiguous') expect(metro.category.name).toBe('Fournisseurs'); else throw new Error(`expected Fournisseurs, got ${String(metro)}`);
  });

  it('a renamed category only matches by its own name: the table\'s « courses » no longer lands', () => {
    const renamed: BudgetSettings = { ...settings, pockets: [{ id: 'home', name: 'Maison', categories: [{ id: 'food', name: 'Bouffe' }] }] };
    expect(guessCategory(parseReceipt(CARREFOUR, TODAY), renamed)).toBeNull();
    expect(guessCategory(parseReceipt('BOUFFE DU MIDI\nTOTAL 9,00', TODAY), renamed)).not.toBeNull();
  });
});
