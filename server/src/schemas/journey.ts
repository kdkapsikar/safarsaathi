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
