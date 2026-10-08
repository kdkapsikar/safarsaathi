import { beforeEach, describe, expect, it } from 'vitest';
import { createDataAccess, type DataAccess, type UserData } from '../src/data/index.js';
import { openDatabase } from '../src/db/index.js';
import { createJourneySchema } from '../src/schemas/journey.js';

/**
 * Proves the data-access layer keeps users apart: user B can't read, change or
 * delete anything user A owns, even when B knows A's row IDs.
 */
let data: DataAccess;
let alice: UserData;
let bob: UserData;

const journeyInput = createJourneySchema.parse({
  trainNumber: '12951',
  fromStationCode: 'mmct',
  toStationCode: 'NDLS',
  journeyDate: '2026-10-09',
  alertTypes: ['DELAY', 'PLATFORM_CHANGE'],
});

beforeEach(() => {
  data = createDataAccess(openDatabase(':memory:'));
  const a = data.accounts.createUser({
    name: 'Alice',
    email: 'alice@example.com',
    passwordHash: 'h',
  });
  const b = data.accounts.createUser({ name: 'Bob', email: 'bob@example.com', passwordHash: 'h' });
  alice = data.forUser(a.id);
  bob = data.forUser(b.id);
});

describe('journeys', () => {
  it('owner can create, read and list; journey has its alert types', () => {
    const j = alice.journeys.create(journeyInput);
    expect(j).toMatchObject({ fromStationCode: 'MMCT', alertTypes: ['DELAY', 'PLATFORM_CHANGE'] });
    expect(alice.journeys.get(j.id)).toEqual(j);
    expect(alice.journeys.list()).toEqual([j]);
  });

  it('lists newest first', () => {
    const first = alice.journeys.create(journeyInput);
    const second = alice.journeys.create({ ...journeyInput, trainNumber: '12301' });
    expect(alice.journeys.list().map((j) => j.id)).toEqual([second.id, first.id]);
  });

  it("another user can't list, read or delete them", () => {
    const j = alice.journeys.create(journeyInput);
    expect(bob.journeys.list()).toEqual([]);
    expect(bob.journeys.get(j.id)).toBeNull();
    expect(bob.journeys.delete(j.id)).toBe(false);
    expect(alice.journeys.get(j.id)).not.toBeNull();
  });

  it('owner can delete', () => {
    const j = alice.journeys.create(journeyInput);
    expect(alice.journeys.delete(j.id)).toBe(true);
    expect(alice.journeys.get(j.id)).toBeNull();
  });
});

describe('alert rules', () => {
  it("another user can't list or modify them", () => {
    const j = alice.journeys.create(journeyInput);
    const [rule] = alice.alertRules.listForJourney(j.id)!;

    expect(bob.alertRules.listForJourney(j.id)).toBeNull();
    expect(bob.alertRules.update(rule!.id, { minDelayMinutes: 999 })).toBeNull();
    expect(alice.alertRules.listForJourney(j.id)![0]!.minDelayMinutes).toBeNull();
  });

  it('owner can modify them', () => {
    const j = alice.journeys.create(journeyInput);
    const [rule] = alice.alertRules.listForJourney(j.id)!;
    const updated = alice.alertRules.update(rule!.id, {
      minDelayMinutes: 30,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:30',
    });
    expect(updated).toMatchObject({ minDelayMinutes: 30, quietHoursStart: '22:00' });
  });
});

describe('recipients', () => {
  it("another user can't list, add to or remove them", () => {
    const j = alice.journeys.create(journeyInput);
    const r = alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' })!;

    expect(bob.recipients.listForJourney(j.id)).toBeNull();
    expect(bob.recipients.add(j.id, { name: 'Mallory', email: 'm@example.com' })).toBeNull();
    expect(bob.recipients.remove(r.id)).toBe(false);
    expect(alice.recipients.listForJourney(j.id)).toEqual([r]);
  });

  it('never exposes the opt-out token through the owner API', () => {
    const j = alice.journeys.create(journeyInput);
    const r = alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' })!;
    expect(Object.keys(r)).not.toContain('optOutToken');
  });
});

describe('notifications', () => {
  it("another user can't see or mark them read", () => {
    const db = openDatabase(':memory:');
    data = createDataAccess(db);
    const a = data.accounts.createUser({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    const b = data.accounts.createUser({ name: 'B', email: 'b@example.com', passwordHash: 'h' });
    db.prepare(
      `INSERT INTO notifications (id, user_id, event_key, title, body, created_at)
       VALUES ('n1', ?, 'DELAY:30', 'Delayed', '30 min late', ?)`,
    ).run(a.id, new Date().toISOString());

    const aliceData = data.forUser(a.id);
    const bobData = data.forUser(b.id);

    expect(bobData.notifications.list()).toEqual([]);
    expect(bobData.notifications.unreadCount()).toBe(0);
    expect(bobData.notifications.markRead('n1')).toBe(false);
    expect(aliceData.notifications.unreadCount()).toBe(1);

    expect(aliceData.notifications.markRead('n1')).toBe(true);
    expect(aliceData.notifications.unreadCount()).toBe(0);
  });
});

describe('chat history', () => {
  it("another user can't list, read, append to or delete it", () => {
    const s = alice.chat.createSession('Train 12951');
    alice.chat.appendMessage(s.id, { role: 'user', content: { text: 'Is my train late?' } });

    expect(bob.chat.listSessions()).toEqual([]);
    expect(bob.chat.getMessages(s.id)).toBeNull();
    expect(bob.chat.appendMessage(s.id, { role: 'user', content: { text: 'hi' } })).toBeNull();
    expect(bob.chat.deleteSession(s.id)).toBe(false);

    const messages = alice.chat.getMessages(s.id)!;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toEqual({ text: 'Is my train late?' });
  });
});

describe('cascade on account deletion', () => {
  it('a deleted user leaves no journeys, rules or recipients behind', () => {
    const db = openDatabase(':memory:');
    const d = createDataAccess(db);
    const u = d.accounts.createUser({ name: 'C', email: 'c@example.com', passwordHash: 'h' });
    const j = d.forUser(u.id).journeys.create(journeyInput);
    d.forUser(u.id).recipients.add(j.id, { name: 'D', email: 'd@example.com' });

    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    for (const t of ['journeys', 'alert_rules', 'recipients']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
  });
});
