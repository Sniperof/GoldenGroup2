import type { Applicant, JobVacancy } from './types';

export type MatchLevel = 'match' | 'mismatch' | 'partial' | 'neutral';

export interface JobMatchResult {
  score: number;
  certMatch: MatchLevel;
  specMatch: MatchLevel;
  expMatch: MatchLevel;
  locMatch: MatchLevel;
  genderMatch: MatchLevel;
  ageMatch: MatchLevel;
  dlMatch: MatchLevel;
  carMatch: MatchLevel;
  appAge: number | null;
  vacSkills: string[];
  appSkills: string;
}

/** Certificate value → academic level, from the «الشهادات» reference list
 *  (system_lists category 'certificate', metadata.level). */
export type CertificateLevels = Record<string, number>;

// Legacy fallback ONLY for values stored before certificates came from the
// reference list (the old hardcoded form offered «بكالوريوس» etc.). A level set
// on the reference list always wins.
const LEGACY_CERTIFICATE_LEVELS: CertificateLevels = {
  'ابتدائية': 1,
  'متوسطة': 2,
  'إعدادية': 3,
  'دبلوم': 4,
  'بكالوريوس': 5,
  'ماجستير': 6,
  'دكتوراه': 7,
};

/** Builds the level map from reference-list rows; rows without a valid level are skipped. */
export function certificateLevelsFromLists(
  lists: Array<{ category: string; value: string; metadata?: unknown }>,
): CertificateLevels {
  const levels: CertificateLevels = {};
  for (const item of lists) {
    if (item.category !== 'certificate') continue;
    const level = Number((item.metadata as { level?: unknown } | undefined)?.level);
    if (Number.isInteger(level) && level > 0) levels[item.value] = level;
  }
  return levels;
}

function getCertificateLevel(certificate: string | null | undefined, levels: CertificateLevels): number {
  const key = certificate || '';
  return levels[key] || LEGACY_CERTIFICATE_LEVELS[key] || 0;
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function addWeightedScore(
  weight: number,
  level: MatchLevel,
  totals: { earned: number; applicable: number },
) {
  if (level === 'neutral') {
    return;
  }

  totals.applicable += weight;
  if (level === 'match') {
    totals.earned += weight;
  } else if (level === 'partial') {
    totals.earned += weight / 2;
  }
}

export function calculateJobMatchScore(
  applicant: Partial<Applicant>,
  vacancy: Partial<JobVacancy>,
  certificateLevels: CertificateLevels = {},
): JobMatchResult {
  const totals = { earned: 0, applicable: 0 };
  const weights = {
    certificate: 20,
    specialization: 25,
    experience: 30,
    location: 10,
    gender: 5,
    age: 5,
    drivingLicense: 5,
    hasCar: 2.5,
  } as const;

  const appCertVal = getCertificateLevel(applicant.academicQualification, certificateLevels);
  const vacCertVal = getCertificateLevel(vacancy.requiredCertificate, certificateLevels);
  let certMatch: MatchLevel = 'neutral';
  if (vacancy.requiredCertificate) {
    if (appCertVal > 0 && vacCertVal > 0) {
      certMatch = appCertVal >= vacCertVal ? 'match' : 'mismatch';
    } else if (applicant.academicQualification === vacancy.requiredCertificate) {
      // A certificate without a level can still match itself by name.
      certMatch = 'match';
    }
    // Otherwise a level is missing on the list: stay neutral rather than
    // score a misconfigured certificate as a pass (vacancy 0) or a fail (applicant 0).
  }
  addWeightedScore(weights.certificate, certMatch, totals);

  let specMatch: MatchLevel = 'neutral';
  const applicantSpecialization = normalizeText(applicant.specialization);
  const vacancyMajor = normalizeText(vacancy.requiredMajor);
  if (vacancyMajor) {
    if (applicantSpecialization && applicantSpecialization === vacancyMajor) {
      specMatch = 'match';
    } else if (applicantSpecialization && applicantSpecialization.includes(vacancyMajor)) {
      specMatch = 'partial';
    } else {
      specMatch = 'mismatch';
    }
  }
  addWeightedScore(weights.specialization, specMatch, totals);

  let expMatch: MatchLevel = 'neutral';
  if (vacancy.requiredExperienceYears != null) {
    const applicantExperience = applicant.yearsOfExperience || 0;
    if (applicantExperience >= vacancy.requiredExperienceYears) {
      expMatch = 'match';
    } else if (applicantExperience > 0) {
      expMatch = 'partial';
    } else {
      expMatch = 'mismatch';
    }
  }
  addWeightedScore(weights.experience, expMatch, totals);

  let locMatch: MatchLevel = 'neutral';
  if (vacancy.cityOrArea) {
    if (normalizeText(applicant.cityOrArea) === normalizeText(vacancy.cityOrArea)) {
      locMatch = 'match';
    } else {
      locMatch = 'mismatch';
    }
  }
  addWeightedScore(weights.location, locMatch, totals);

  const genderMatch: MatchLevel =
    !vacancy.requiredGender || applicant.gender === vacancy.requiredGender ? 'match' : 'mismatch';
  addWeightedScore(weights.gender, vacancy.requiredGender ? genderMatch : 'neutral', totals);

  const appAge = applicant.dob
    ? Math.floor((Date.now() - new Date(applicant.dob).getTime()) / 31557600000)
    : null;
  const ageMatch: MatchLevel =
    (!vacancy.requiredAgeMin && !vacancy.requiredAgeMax) || appAge == null
      ? 'neutral'
      : ((!vacancy.requiredAgeMin || appAge >= vacancy.requiredAgeMin) &&
          (!vacancy.requiredAgeMax || appAge <= vacancy.requiredAgeMax))
      ? 'match'
      : 'mismatch';
  addWeightedScore(weights.age, ageMatch, totals);

  const dlMatch: MatchLevel = !vacancy.drivingLicenseRequired
    ? 'neutral'
    : applicant.drivingLicense
    ? 'match'
    : 'mismatch';
  addWeightedScore(weights.drivingLicense, dlMatch, totals);

  const carMatch: MatchLevel = !vacancy.hasCarRequired
    ? 'neutral'
    : applicant.hasCar
    ? 'match'
    : 'mismatch';
  addWeightedScore(weights.hasCar, carMatch, totals);

  const appSkills = normalizeText(applicant.computerSkills);
  const vacSkills = (vacancy.requiredSkills || '')
    .split(/[,،\n]/)
    .map((skill) => skill.trim().toLowerCase())
    .filter(Boolean);

  return {
    score: totals.applicable > 0 ? Math.max(0, Math.min(100, Math.round((totals.earned / totals.applicable) * 100))) : 0,
    certMatch,
    specMatch,
    expMatch,
    locMatch,
    genderMatch,
    ageMatch,
    dlMatch,
    carMatch,
    appAge,
    vacSkills,
    appSkills,
  };
}
