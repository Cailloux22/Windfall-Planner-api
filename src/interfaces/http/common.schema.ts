import { z } from 'zod';
import { DEVICE_PLATFORMS } from '#models/device';
import { normalizeEmail } from '#models/email.rules';

// Longueur en caractères (points de code), comme maxLength en JSON Schema.
function charLength(value: string): number {
  return Array.from(value).length;
}

function chars(min: number, max: number) {
  return z.string().refine(
    (value) => charLength(value) >= min && charLength(value) <= max,
    { message: min > 0 ? `Entre ${min} et ${max} caractères.` : `${max} caractères au plus.` },
  );
}

// RG_50/RT_69 : email normalisé (espaces retirés, minuscules) puis contrôlé,
// 254 caractères au plus.
export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Adresse email invalide.' }).max(254));

// RG_50 : 8 à 128 caractères, aucune autre contrainte de composition.
export const newPasswordSchema = chars(8, 128);

// Mot de passe présenté pour vérification : seule la borne haute s'applique.
export const presentedPasswordSchema = chars(0, 128);

// RT_67 : identité de l'appareil.
export const deviceSchema = z.object({
  id: z.uuid(),
  name: chars(1, 80),
  platform: z.enum(DEVICE_PLATFORMS),
});

export { chars };
