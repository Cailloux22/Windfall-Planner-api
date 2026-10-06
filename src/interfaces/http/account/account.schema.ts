import { z } from 'zod';
import { emailSchema, newPasswordSchema, presentedPasswordSchema } from '#schemas/common.schema';

// openapi.yml : ChangePasswordRequest (RG_52).
export const changePasswordBodySchema = z.object({
  currentPassword: presentedPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

// openapi.yml : ChangeEmailRequest (RG_52, RG_50).
export const changeEmailBodySchema = z.object({
  newEmail: emailSchema,
  password: presentedPasswordSchema,
});
export type ChangeEmailBody = z.infer<typeof changeEmailBodySchema>;

// openapi.yml : DeleteAccountRequest (RG_52).
export const deleteAccountBodySchema = z.object({
  password: presentedPasswordSchema,
});
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;
