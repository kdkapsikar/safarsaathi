import { z } from 'zod';

export const ALERT_TYPES = ['DEPARTURE', 'ARRIVAL', 'DELAY', 'PLATFORM_CHANGE'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const stationCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,5}$/, 'Station code must be 1-5 letters');

const optionalName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? v : undefined));

const isoDate = z.iso.date('Date must be YYYY-MM-DD');

export const createJourneySchema = z
  .object({
    trainNumber: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Train number must be 5 digits'),
    fromStationCode: stationCode,
    fromStationName: optionalName,
    toStationCode: stationCode,
    toStationName: optionalName,
    journeyDate: isoDate,
    alertTypes: z
      .array(z.enum(ALERT_TYPES))
      .min(1, 'Choose at least one alert type')
      .transform((types) => [...new Set(types)]),
  })
  .refine((j) => j.fromStationCode !== j.toStationCode, {
    message: 'From and to stations must be different',
    path: ['toStationCode'],
  });

export type CreateJourneyInput = z.infer<typeof createJourneySchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

export const updateAlertRuleSchema = z
  .object({
    minDelayMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    quietHoursStart: hhmm.nullable().optional(),
    quietHoursEnd: hhmm.nullable().optional(),
    channel: z.enum(['IN_APP', 'EMAIL']).optional(),
  })
  .refine(
    (r) =>
      (r.quietHoursStart === undefined) === (r.quietHoursEnd === undefined) &&
      (r.quietHoursStart === null) === (r.quietHoursEnd === null),
    { message: 'Set both quiet-hours times or neither', path: ['quietHoursEnd'] },
  );

export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;

export const addRecipientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export type AddRecipientInput = z.infer<typeof addRecipientSchema>;

const nullableMinutes = (max: number) => z.number().int().min(0).max(max).nullable();

/** Per-journey smart rules, "leave now" and connection settings. */
export const journeySettingsSchema = z
  .object({
    /** Delay alerts start at this many minutes (null = default 15). */
    minDelayMinutes: nullableMinutes(1440),
    /** Quiet hours (IST), both or neither. Non-urgent alerts wait until they end. */
    quietHoursStart: hhmm.nullable(),
    quietHoursEnd: hhmm.nullable(),
    /** Door-to-station travel time; null turns "leave now" off. */
    travelTimeMinutes: nullableMinutes(600),
    leaveBufferMinutes: z.number().int().min(0).max(180),
    /** Another of the user's journeys this one connects to. */
    connectsToJourneyId: z.uuid().nullable(),
    /** Minimum time needed to change trains. */
    connectionBufferMinutes: z.number().int().min(0).max(240),
  })
  .refine((s) => (s.quietHoursStart === null) === (s.quietHoursEnd === null), {
    message: 'Set both quiet-hours times or neither',
    path: ['quietHoursEnd'],
  })
  .refine((s) => s.quietHoursStart === null || s.quietHoursStart !== s.quietHoursEnd, {
    message: 'Quiet hours must start and end at different times',
    path: ['quietHoursEnd'],
  });

export type JourneySettings = z.infer<typeof journeySettingsSchema>;
