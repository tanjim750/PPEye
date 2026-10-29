export function isEmail(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  // Standard RFC-compatible regex requiring valid user, @, domain, and >= 2 char TLD
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);
}

export function isRequired(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  // Name must be between 2 and 60 chars, support English & Bengali letters, spaces, hyphens, and dots
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const allowedChars = /^[a-zA-Z\u0980-\u09FF\s.'-]+$/;
  const hasLetters = /[a-zA-Z\u0980-\u09FF]/;
  return allowedChars.test(trimmed) && hasLetters.test(trimmed);
}

export function isValidPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  // Strip whitespace, hyphens, parentheses
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // BD local format: 013-019 followed by 8 digits (11 digits total)
  const isBdLocal = /^01[3-9]\d{8}$/.test(cleaned);
  // BD mobile without leading zero (entered next to +880 label): 13-19 followed by 8 digits (10 digits total)
  const isBdWithoutZero = /^1[3-9]\d{8}$/.test(cleaned);
  // BD international format: +88013-+88019 followed by 8 digits (14 chars)
  const isBdIntl = /^\+8801[3-9]\d{8}$/.test(cleaned);
  // General international mobile format: + followed by 8 to 15 digits
  const isGeneralIntl = /^\+[1-9]\d{7,14}$/.test(cleaned);
  return isBdLocal || isBdWithoutZero || isBdIntl || isGeneralIntl;
}

export function isValidPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false;
  return password.trim().length >= 6;
}

export function isValidVendorName(vendor: string): boolean {
  if (!vendor || typeof vendor !== 'string') return false;
  const trimmed = vendor.trim();
  return trimmed.length >= 2 && trimmed.length <= 80;
}
