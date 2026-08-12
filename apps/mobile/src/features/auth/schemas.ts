import { z } from 'zod';

/**
 * Auth form schemas.
 *
 * The password rule is deliberately modest — length plus a little variety. Byzantine
 * composition rules push people towards `Password1!` and a sticky note; NIST guidance
 * has recommended against them for years. Length is what actually helps.
 */

export const PASSWORD_MIN_LENGTH = 8;

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'validation.passwordTooShort' })
  .max(128, { message: 'validation.tooLong' })
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'validation.passwordNeedsVariety',
  });

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'validation.invalidEmail' });

export const signInSchema = z.object({
  email,
  // Sign-in must not re-validate strength: an existing password set under older
  // rules would become un-enterable.
  password: z.string().min(1, { message: 'validation.required' }),
});

export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1, { message: 'validation.required' }).max(80),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordsDontMatch',
  });

export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
