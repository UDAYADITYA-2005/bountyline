import type { CheckKey, ReasonCode } from './enums.js';

/** Short labels for each check, shared by the API and the web app. */
export const CHECK_LABELS: Record<CheckKey, string> = {
  species: 'Species',
  length: 'Length',
  code_in_frame: 'Code in frame',
  photo_quality: 'Photo quality',
  screen_suspected: 'Screen or print',
  duplicate: 'Photo reuse',
  area: 'Program area',
  season: 'Season',
  claim_rate: 'Claim rate',
  code_expiry: 'Code expiry',
};

/** One plain sentence per reason code, for claimants and reviewers. */
export const REASON_MESSAGES: Record<ReasonCode, string> = {
  duplicate_exact: 'This photo was already used in another claim.',
  duplicate_near: 'This photo looks very similar to another claim, so a reviewer will check it.',
  wrong_species: 'The animal in the photo is not an eligible species for this program.',
  species_uncertain:
    'We could not confirm the species from the photo, so a reviewer will check it.',
  below_min_length: 'The fish is shorter than the program minimum.',
  length_uncertain: 'We could not read the length from the measuring board.',
  code_missing: 'The one-time code card is not visible in the photo.',
  code_mismatch: 'The code in the photo does not match the code issued for this claim.',
  code_expired: 'The one-time code expired before the photo was submitted.',
  outside_area: 'The photo location is outside the program area.',
  low_location_accuracy: 'The location was not accurate enough to confirm the program area.',
  out_of_season: 'The claim was submitted outside the program season.',
  claim_rate_exceeded: 'You have made more claims today than the program allows.',
  photo_unusable: 'The photo is too blurry, dark or cropped to check.',
  screen_suspected: 'The photo may be of a screen or a print, so a reviewer will check it.',
  ai_unavailable: 'The photo check is unavailable right now, so a reviewer will check the claim.',
  check_error: 'A check could not finish, so a reviewer will check the claim.',
  pool_insufficient: 'The program pool does not have enough money for this reward right now.',
  daily_payout_cap: 'This PayPal account has reached the daily payout limit.',
  manager_approved: 'A program manager approved this claim.',
  manager_rejected: 'A program manager rejected this claim.',
  payout_failed: 'PayPal could not complete the payout.',
  payout_unclaimed: 'PayPal is holding the payout until the receiver claims it.',
};
