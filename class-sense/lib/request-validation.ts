import { z } from "zod";

const MAX_ROOM_TITLE_LENGTH = 120;
const MAX_PARTICIPANT_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

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

export function getValidationErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0];

  if (!firstIssue) {
    return "Invalid request body.";
  }

  return firstIssue.message;
}
