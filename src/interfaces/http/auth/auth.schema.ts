import { z } from 'zod';
import { deviceSchema, emailSchema, newPasswordSchema, presentedPasswordSchema } from '#schemas/common.schema';

// openapi.yml : RegisterRequest (RG_50, RT_67).
export const registerBodySchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  device: deviceSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

// openapi.yml : LoginRequest.
export const loginBodySchema = z.object({
  email: emailSchema,
  password: presentedPasswordSchema,
  device: deviceSchema,
});
export type LoginBody = z.infer<typeof loginBodySchema>;
