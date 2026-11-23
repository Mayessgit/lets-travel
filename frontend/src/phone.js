// Règles du téléphone tunisien, partagées par l'inscription et le profil.
// La validation serveur (backend/src/validators.js) reste la référence : ceci n'est qu'un confort de saisie.
export const PHONE_ERROR = 'Numéro de téléphone invalide : il doit comporter 8 chiffres et commencer par 20 à 29, 50 à 59 ou 90 à 99.';

const PHONE_RE = /^(2|5|9)\d{7}$/;

/** Un numéro vide est accepté (champ facultatif). */
export const isValidPhone = (value) => !value || PHONE_RE.test(String(value));

/** Ne garde que les chiffres, 8 au maximum : évite d'envoyer « +216 » ou des espaces. */
export const sanitizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 8);
