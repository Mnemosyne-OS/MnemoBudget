/**
 * The parser against what the host's OCR REALLY gives (doc 177 §14.4, measured
 * 2026-10-26 with `tools/receipt-bench.ts` on 18 Wikimedia Commons receipts and
 * 40 of the Express Expense set through rapidocr-onnxruntime, the engine the
 * host installs): one box per piece of text, joined with newlines, so a row's
 * label and its amount are two lines, and a date comes glued to its time.
 * Each fixture below is such an output, verbatim but for the lines that named
 * a cashier or a waiter.
 */
import { describe, it, expect } from 'vitest';
import { guessCategory, parseReceipt } from './receipt';
import type { BudgetSettings } from './types';

const SETTINGS: BudgetSettings = {
  version: 1, baseCurrency: 'EUR', rates: {}, memory: false,
  pockets: [{ id: 'home', name: 'Maison', icon: '🏠', categories: [
    { id: 'groceries', name: 'Courses' }, { id: 'dog', name: 'Chien' }, { id: 'fuel', name: 'Essence' }, { id: 'resto', name: 'Restaurant' },
  ] }],
};
const lines = (...l: string[]) => l.join('\n');

// Berghotel Grosse Scheidegg, 2007 (Commons, CC BY-SA 3.0): the total's amount box came BEFORE its label.
const SWISS = lines('Ber ghotel', 'Grosse Scheidegg', '3818 Grindelwald', 'Fami lie R. Muller', 'Rech.Nr. 4572', '30.07.2007/13:29: 17', 'Bar', 'Tisch   7/01',
  '2xl.atte Macchiato', 'a  4.50 CHF', '9.00', '1xGloki', 'a  5. 00', 'CHF', '5.00', '1xSchweinschnitzel  a', '22.00', 'CHF', '22.00', '1xChasspatzli', 'a18.50', 'CHF', '18.50',
  '54.50', 'Total : ', 'CHF', 'Incl. 7.6% MwSt', '54.50 CHF:', '3.85', 'Entspricht in Euro  36.33 EUR', 'MwSt Nr.: 430 234', 'Tel. : 033 853 67 16');

// A shop receipt, 2013 (Commons, CC BY 4.0): « TOTAL » then its amount, « TOTAL INCLUDES VAT OF » after it.
const STORE = lines('CHIN H.MEEN & SON\'SLTD', 'Lae Retail Branch', 'VAT REG.NO.811', 'TAX INV0ICE N0.4104784', '30 MAR 13', '10:53:17',
  'Choking band,Abot CD', '1', '19.50', '19.50', 'TOTAL', '19.50', 'Cash', '00020', 'CHANGE', '0.50', 'TOTAL INCLUDES VAT OF', '1.77', 'Thank you for shopping with us');

// A German fuel station, 2020 (Commons, public domain).
const FUEL = lines('HIT-Tankstelle', 'Meckenheimer Str. 8', '53359 Rheinbach', 'Tankste1len-Nr.: 610377', 'Tel: 02226/915850', '*', '77,49 Liter S', 'SAULENNUMMER7*', '*Diesel SB', 'A', '76,64 EUR*', '0,989 EUR/Liter',
  '+KUNDENBELEG+', 'Terminalnummer', '74027460', 'Datum', '21.11.2020', 'Uhrzeit', '15:33:55', 'Kartenzahlung', 'girocard', 'Betrag', '76.64_EUR', 'Karte', 'Contactless', 'Zahlung erfolgt',
  'girocard', '76,64 EUR', 'TOTAL', '76,64 EUR', 'Quittung', 'MWST 16,00% A', '10,57 EUR', 'NETTO', '66,07 EUR BRUTT0', '76,64 EUR', '#14051 21.11.20 15:34 Bed1ener102 K.0001');

// A German pet shop, 2020 (Commons, public domain): a first « SUMME » before the VAT cut, the real « Summe » after it, then the cash and the change.
const PETSHOP = lines('Fressnapf Koln-Ehrenfeld', 'Subbelratherstraße 387-407', '50825 Koln', 'EUR', 'ANIO Ersatzfilter 2 Stk', '9,99', 'PREM Multicat 12L', '14,99',
  'SUMME [  3]', 'EUR', '34,97', 'MwSt.-Senkung', '-0,88', 'Summe', 'EUR  :', '34,09', 'Bar Euro', 'EUR', '50,09', 'Ruckgeld', 'EUR', '-16,00', 'MwSt D 16,00%', '29,39', '4,70',
  'Datum Uhrzeit Filiale Pos Bed Bon', '04.12.20 09:36 0005027 102 5354 0263');

// A US diner, 2016 (Express Expense SRD, CC BY 4.0): « TOTAL: » then « $56.58 », a month-first date glued to nothing.
const DINER = lines('GREEN FIELD', '5305 E PACIFIC COAST HWY', 'Long Beach,CA 90804', '(562)597-0906', 'Stat ion:3', '0rder #:69923', 'Dine In', 'Table:B11', 'Guests:2',
  '1Coffee', '3.00', '2Lunch', '45.90', '1Coke', '3.00', 'SUB TOTAL:', '51.90', 'Tax1:', '4.68', 'TOTAL:', '$56.58', '5/26/2016 12:53:10 PM', 'THANK YOU!');

describe('a row split by the engine into a label line and an amount line', () => {
  it('takes the lone amount that follows the total word (« TOTAL » / « 19.50 »), never the VAT line after it', () => {
    const r = parseReceipt(STORE, '2013-04-01');
    expect(r.amountCents).toBe(1950);
    expect(r.day).toBe('2013-03-30');
  });

  it('takes the lone amount just BEFORE the total word when nothing follows but a currency and the next label (« 54.50 » / « Total : » / « CHF »)', () => {
    const r = parseReceipt(SWISS, '2008-01-15');
    expect(r.amountCents).toBe(5450);
    expect(r.currency).toBe('CHF');
    expect(r.day).toBe('2007-07-30');
    expect(r.merchant).toBe('Ber ghotel');
  });

  it('never takes the amount before the total word when that amount belongs to the row above it (an item and its price)', () => {
    const trap = lines('LIDL', 'Hal-fvolle weidemelkh.', '0,87', 'Te betalen', '5art.', 'Douchiegelv.huid/haar', '0,89');
    expect(parseReceipt(trap, '2019-05-01').amountCents).toBeUndefined();
  });

  it('reads a fuel ticket: the last « TOTAL » row, the euro, the dated day, and the fuel category from the station', () => {
    const r = parseReceipt(FUEL, '2020-12-01');
    expect(r.amountCents).toBe(7664);
    expect(r.currency).toBe('EUR');
    expect(r.day).toBe('2020-11-21');
    expect(guessCategory(r, SETTINGS)).toMatchObject({ category: { id: 'fuel' } });
  });

  it('on a German ticket the final « Summe » wins over the first one, and the cash tendered and the change never count', () => {
    const r = parseReceipt(PETSHOP, '2020-12-20');
    expect(r.amountCents).toBe(3409);
    expect(r.day).toBe('2020-12-04');
  });

  it('reads a US diner ticket: « TOTAL: » then « $56.58 », the sub total and the tax left aside, a month-first date', () => {
    const r = parseReceipt(DINER, '2016-06-01');
    expect(r.amountCents).toBe(5658);
    expect(r.currency).toBe('USD');
    expect(r.day).toBe('2016-05-26');
  });

  it('a « € » read as « E » still makes an amount line (« Totaal » / « E14,33 »), a Dutch sub total does not', () => {
    const r = parseReceipt(lines('PLUS', 'KIKKERERWTEN BIO', '1,33', 'subtotaal', '624,62', '14X PLUSPunten', '0,28', 'Totaal', 'E14,33', 'P01:50144008'), '2019-06-01');
    expect(r.amountCents).toBe(1433);
  });

  it('a digit the engine put inside the word is read as its letter (« Tota1Due:44.35 »)', () => {
    const r = parseReceipt(lines('LAUREL TAVERN', 'Sub-total:', '40.50', 'Taxes:', '3.85', 'Tota1Due:44.35', 'THANK YOU!!!'), '2026-10-26');
    expect(r.amountCents).toBe(4435);
  });
});

describe('a date glued to its time in one box', () => {
  it('« 29/04/201914:16 » is the 29th of April, stamped with its time', () => {
    expect(parseReceipt(lines('LIDL', 'BETALING', '29/04/201914:16', 'Totaal:', '8,48EUR'), '2019-05-10')).toMatchObject({ day: '2019-04-29', amountCents: 848, currency: 'EUR' });
  });

  it('« 15:2123.02.2019 » and « 05/11/188:47PM » are read as well', () => {
    expect(parseReceipt(lines('ALDI', 'BEDRAG EURO', '5,00', '15:2123.02.2019'), '2019-03-01')).toMatchObject({ day: '2019-02-23', amountCents: 500 });
    expect(parseReceipt(lines('CAFE', '05/11/188:47PM', 'Total', '$9.50'), '2018-12-01')).toMatchObject({ day: '2018-11-05', amountCents: 950 });
  });
});
