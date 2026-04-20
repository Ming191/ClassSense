import { z } from "zod";

const MAX_ROOM_TITLE_LENGTH = 120;
const MAX_PARTICIPANT_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MAX_EMOTION_LENGTH = 64;
const MAX_WORKER_ID_LENGTH = 120;

function optionalTrimmedString(maxLength: number, fieldName: string) {
  return z
    .string()
    .trim()
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters.`)
    .optional()
    .transform((value) => {
      if (!value || value.length === 0) {
        return undefined;
      }

      return value;
    });
}

function optionalEmailString(fieldName: string) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .max(MAX_EMAIL_LENGTH, `${fieldName} must be at most ${MAX_EMAIL_LENGTH} characters.`)
    .optional()
    .transform((value) => {
      if (!value || value.length === 0) {
        return undefined;
      }

      return value;
    })
    .refine((value) => !value || z.string().email().safeParse(value).success, {
      message: `${fieldName} must be a valid email when provided.`,
    });
}

export const createRoomBodySchema = z
  .object({
    title: optionalTrimmedString(MAX_ROOM_TITLE_LENGTH, "title"),
    hostName: optionalTrimmedString(MAX_PARTICIPANT_NAME_LENGTH, "hostName"),
    hostEmail: optionalEmailString("hostEmail"),
  })
  .strict();

export const sessionTokenRequestBodySchema = z
  .object({
    participantName: optionalTrimmedString(MAX_PARTICIPANT_NAME_LENGTH, "participantName"),
    participantEmail: optionalEmailString("participantEmail"),
  })
  .strict();

export const workerTokenRequestBodySchema = z
  .object({
    workerIdentity: optionalTrimmedString(MAX_WORKER_ID_LENGTH, "workerIdentity"),
    workerName: optionalTrimmedString(MAX_PARTICIPANT_NAME_LENGTH, "workerName"),
  })
  .strict();

export const signalIngestionBodySchema = z
  .object({
    participantId: z.string().trim().min(1, "participantId is required."),
    engagementScore: z
      .number()
      .min(0, "engagementScore must be between 0 and 1.")
      .max(1, "engagementScore must be between 0 and 1."),
    cameraEnabled: z.boolean().optional(),
    microphoneEnabled: z.boolean().optional(),
    faceDetected: z.boolean().optional(),
    emotion: z
      .string()
      .trim()
      .max(MAX_EMOTION_LENGTH, `emotion must be at most ${MAX_EMOTION_LENGTH} characters.`)
      .optional()
      .transform((value) => {
        if (!value || value.length === 0) {
          return undefined;
        }

        return value;
      }),
    yaw: z.number().optional(),
    pitch: z.number().optional(),
    roll: z.number().optional(),
  })
  .strict();

export function getValidationErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0];

  if (!firstIssue) {
    return "Invalid request body.";
  }

  return firstIssue.message;
}
