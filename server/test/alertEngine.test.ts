import { beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { DryRunEmailChannel, InAppChannel } from '../src/alerts/channels.js';
import { AlertEngine } from '../src/alerts/engine.js';
import { createDataAccess, type DataAccess, type UserData } from '../src/data/index.js';
import { createEngineStore } from '../src/data/engineStore.js';
import { openDatabase, type Db } from '../src/db/index.js';
import type { AlertType } from '../src/schemas/journey.js';
import { MockProvider } from '../src/trains/mock/MockProvider.js';
import type { ScenarioId } from '../src/trains/mock/scenarios.js';
import { ResilientProvider } from '../src/trains/resilient.js';
import { istInstant } from '../src/trains/time.js';

const START = '2026-10-09';
const at = (hhmm: string, day = 1) => istInstant(START, hhmm, day);

let db: Db;
let data: DataAccess;
let sim: MockProvider;
let email: DryRunEmailChannel;
let engine: AlertEngine;
let provider: ResilientProvider;
let alice: UserData;
let bob: UserData;

function setup() {
  db = openDatabase(':memory:');
  data = createDataAccess(db);
  sim = new MockProvider();
  const store = createEngineStore(db);
  const log = pino({ level: 'silent' });
  email = new DryRunEmailChannel(log);
  engine = new AlertEngine({
    store,
    provider: (provider = new ResilientProvider(sim, { retries: 0 })),
    clock: sim.clock,
    inApp: new InAppChannel(store),
    email,
    log,
    appUrl: 'https://safar.example',
  });
  alice = data.forUser(
    data.accounts.createUser({ name: 'Alice', email: 'alice@example.com', passwordHash: 'h' }).id,
  );
  bob = data.forUser(
    data.accounts.createUser({ name: 'Bob', email: 'bob@example.com', passwordHash: 'h' }).id,
  );
}

function addJourney(
  who: UserData,
  alertTypes: AlertType[],
  overrides: Partial<{ trainNumber: string; from: string; to: string; date: string }> = {},
) {
  return who.journeys.create({
    trainNumber: overrides.trainNumber ?? '12951',
    fromStationCode: overrides.from ?? 'MMCT',
    fromStationName: undefined,
    toStationCode: overrides.to ?? 'NDLS',
    toStationName: undefined,
    journeyDate: overrides.date ?? START,
    alertTypes,
  });
}

const scenario = (id: ScenarioId, train = '12951') => sim.setScenario(train, id);
// Like the simulator routes: moving simulated time drops cached status.
const runAt = async (when: Date, force = true) => {
  sim.clock.set(when);
  provider.invalidate();
  return engine.runOnce({ force });
};
const titles = (who: UserData) => who.notifications.list().map((n) => n.title);

beforeEach(setup);

describe('AlertEngine', () => {
  it('sends a delay alert once, even when runs repeat', async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['DELAY']);

    const first = await runAt(at('21:00'));
    expect(first.notificationsSent).toBe(1);
    expect(titles(alice)).toEqual([expect.stringMatching(/^12951 is running/)]);

    const second = await runAt(at('21:00'));
    const third = await runAt(at('21:00'));
    expect(second.notificationsSent + third.notificationsSent).toBe(0);
    expect(second.duplicatesSkipped).toBe(1);
    expect(alice.notifications.list()).toHaveLength(1);
  });

  it('sends a new alert when the delay reaches the next step', async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['DELAY']);
    await runAt(at('19:00')); // ~30 min
    await runAt(at('23:00')); // ~2 h
    const delayTitles = titles(alice);
    expect(delayTitles).toHaveLength(2);
  });

  it('only sends the alert types the user chose', async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['ARRIVAL']);
    expect((await runAt(at('21:00'))).notificationsSent).toBe(0);
  });

  it('platform announced, then changed, at the boarding station', async () => {
    scenario('PLATFORM_CHANGE');
    addJourney(alice, ['PLATFORM_CHANGE']);
    await runAt(at('15:00'));
    await runAt(at('16:40'));
    const [changed, announced] = titles(alice);
    expect(announced).toMatch(/^12951: platform \d at MMCT$/);
    expect(changed).toBe('Platform change for 12951 at MMCT');
  });

  it('cancellation reaches everyone on the train, ignoring rule choices and quiet hours', async () => {
    scenario('CANCELLED');
    const j = addJourney(alice, ['ARRIVAL']);
    const rule = alice.alertRules.listForJourney(j.id)![0]!;
    alice.alertRules.update(rule.id, { quietHoursStart: '00:00', quietHoursEnd: '23:59' });
    addJourney(bob, ['DELAY']);

    const run = await runAt(at('14:00'));
    expect(run.notificationsSent).toBe(2);
    expect(titles(alice)).toEqual(['12951 is cancelled']);
    expect(titles(bob)).toEqual(['12951 is cancelled']);
  });

  it('holds back alerts during quiet hours and sends them afterwards', async () => {
    scenario('GROWING_DELAY');
    const j = addJourney(alice, ['DELAY']);
    const rule = alice.alertRules.listForJourney(j.id)![0]!;
    alice.alertRules.update(rule.id, { quietHoursStart: '20:00', quietHoursEnd: '22:00' });

    const quiet = await runAt(at('21:00'));
    expect(quiet.quietHoursSkipped).toBe(1);
    expect(alice.notifications.list()).toHaveLength(0);

    await runAt(at('22:05'));
    expect(alice.notifications.list()).toHaveLength(1);
  });

  it("delivers only to the journey's owner", async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['DELAY']);
    await runAt(at('21:00'));
    expect(bob.notifications.list()).toEqual([]);
  });

  it('fetches each train run once, however many people are on it', async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['DELAY']);
    addJourney(bob, ['DELAY']);
    addJourney(bob, ['DELAY'], { from: 'BRC' });
    const run = await runAt(at('21:00'));
    expect(run.trainRuns).toBe(1);
    expect(run.statusFetches).toBe(1);
    expect(run.notificationsSent).toBe(3);
  });

  it('polls less often when nothing is imminent, unless forced', async () => {
    scenario('ON_TIME');
    addJourney(alice, ['DEPARTURE']);
    await runAt(at('22:00'), true);
    const again = await runAt(at('22:01'), false);
    expect(again.notDue).toBe(1);
    expect(again.statusFetches).toBe(0);
    const later = await runAt(at('22:06'), false);
    expect(later.statusFetches).toBe(1);
  });

  it('ignores journeys outside their active window', async () => {
    addJourney(alice, ['DEPARTURE'], { date: '2026-10-10' });
    const run = await runAt(at('09:00')); // tomorrow's run departs 32 h later
    expect(run.outsideWindow).toBe(1);
    expect(run.statusFetches).toBe(0);
  });

  it('handles boarding mid-route on day 2 (journey date = boarding date)', async () => {
    scenario('ON_TIME');
    addJourney(alice, ['DEPARTURE'], { from: 'KOTA', date: '2026-10-10' });
    const run = await runAt(at('04:30', 2));
    expect(run.statusFetches).toBe(1);
    expect(titles(alice)).toEqual(['12951 has left Kota Junction']);
  });

  it('emails the owner when the rule asks for email, and active recipients', async () => {
    scenario('GROWING_DELAY');
    const j = addJourney(alice, ['DELAY']);
    const rule = alice.alertRules.listForJourney(j.id)![0]!;
    alice.alertRules.update(rule.id, { channel: 'EMAIL' });
    alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' });

    await runAt(at('21:00'));
    expect(email.sent.map((n) => n.to.email).sort()).toEqual([
      'alice@example.com',
      'driver@example.com',
    ]);
    expect(alice.notifications.list()).toHaveLength(1);

    await runAt(at('21:00'));
    expect(email.sent).toHaveLength(2);
  });

  it('skips opted-out recipients', async () => {
    scenario('GROWING_DELAY');
    const j = addJourney(alice, ['DELAY']);
    const r = alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' })!;
    db.prepare('UPDATE recipients SET opted_out_at = ? WHERE id = ?').run(
      '2026-10-01T00:00:00Z',
      r.id,
    );
    await runAt(at('21:00'));
    expect(email.sent.map((n) => n.to.email)).not.toContain('driver@example.com');
  });

  it('reports a data-source outage and sends nothing', async () => {
    addJourney(alice, ['DELAY']);
    sim.health = 'DOWN';
    const run = await runAt(at('21:00'));
    expect(run.errors).toEqual([expect.stringContaining('UNAVAILABLE')]);
    expect(run.notificationsSent).toBe(0);
  });

  it('keeps only the latest snapshot per train run', async () => {
    scenario('GROWING_DELAY');
    addJourney(alice, ['DELAY']);
    await runAt(at('20:00'));
    await runAt(at('21:00'));
    expect(db.prepare('SELECT count(*) AS n FROM train_snapshots').get()).toEqual({ n: 1 });
  });

  it('sends "leave now" once at the leave-by time, to the passenger only', async () => {
    scenario('ON_TIME');
    const j = addJourney(alice, ['DELAY']);
    alice.journeys.updateSettings(j.id, {
      ...j.settings,
      travelTimeMinutes: 45,
      leaveBufferMinutes: 15,
    });
    alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' });

    expect((await runAt(at('15:58'))).notificationsSent).toBe(0);
    await runAt(at('16:00'));
    await runAt(at('16:01'));
    expect(titles(alice)).toEqual(['Time to leave for Mumbai Central']);
    expect(email.sent.map((n) => n.to.email)).not.toContain('driver@example.com');
  });

  it('"leave now" waits for a late train (recomputed from the live delay)', async () => {
    scenario('GROWING_DELAY');
    const j = addJourney(alice, ['DEPARTURE'], { from: 'BRC' }); // Vadodara, due 21:16
    alice.journeys.updateSettings(j.id, {
      ...j.settings,
      travelTimeMinutes: 30,
      leaveBufferMinutes: 10,
    });
    // On time, leave-by would be 20:36. By then the train is ~76 min late, so not yet.
    await runAt(at('20:40'));
    expect(titles(alice)).not.toContain('Time to leave for Vadodara Junction');
    // At 22:05 it's ~86 min late: expected 22:42, minus 30 + 10 → leave by 22:02.
    await runAt(at('22:05'));
    expect(titles(alice)).toContain('Time to leave for Vadodara Junction');
  });

  it('warns when a delay threatens a linked connection', async () => {
    scenario('GROWING_DELAY'); // 12951 reaches NDLS (08:32 scheduled) about 2.5 h late
    sim.setScenario('12002', 'ON_TIME'); // 12002 leaves NDLS at 06:00 that morning
    const first = addJourney(alice, ['DELAY']);
    const second = addJourney(alice, ['DEPARTURE'], {
      trainNumber: '12002',
      from: 'NDLS',
      to: 'AGC',
      date: '2026-10-10',
    });
    alice.journeys.updateSettings(first.id, {
      ...first.settings,
      connectsToJourneyId: second.id,
      connectionBufferMinutes: 30,
    });

    await runAt(at('03:00', 2));
    const t = titles(alice);
    expect(t).toContain('You may miss your connection to 12002');
  });

  it('puts an opt-out link in recipient emails, and opting out stops them', async () => {
    scenario('GROWING_DELAY');
    const j = addJourney(alice, ['DELAY']);
    const r = alice.recipients.add(j.id, { name: 'Driver', email: 'driver@example.com' })!;
    await runAt(at('19:00'));
    const sent = email.sent.find((n) => n.to.email === 'driver@example.com')!;
    expect(sent.to).toMatchObject({ kind: 'recipient' });
    const url = (sent.to as { optOutUrl: string }).optOutUrl;
    expect(url).toMatch(/^https:\/\/safar\.example\/optout\/[\w-]{20,}$/);

    expect(data.publicLinks.optOut(url.split('/').at(-1)!)).toBe(true);
    await runAt(at('23:00'));
    expect(email.sent.filter((n) => n.to.email === 'driver@example.com')).toHaveLength(1);
    expect(alice.recipients.listForJourney(j.id)!.find((x) => x.id === r.id)!.optedOut).toBe(true);
  });
});
