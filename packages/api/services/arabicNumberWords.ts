// Integer → Arabic words (تفقيط) for the printed contract: «فقط ... ليرة سورية».
// Whole numbers only (contract amounts are whole SYP); 0 … 999,999,999,999.

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

/** 1 … 999 */
function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 10) parts.push(ONES[rest]);
    else if (rest < 20) parts.push(TEENS[rest - 10]);
    else {
      const o = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

interface Scale { one: string; two: string; few: string; many: string }
const SCALES: Scale[] = [
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألف' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليون' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'مليار' },
];

function scaled(count: number, scale: Scale): string {
  if (count === 1) return scale.one;
  if (count === 2) return scale.two;
  if (count >= 3 && count <= 10) return `${belowThousand(count)} ${scale.few}`;
  return `${belowThousand(count)} ${scale.many}`;
}

export function arabicNumberWords(value: number): string {
  let n = Math.round(Math.abs(Number(value) || 0));
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    parts.push(i === 0 ? belowThousand(g) : scaled(g, SCALES[i - 1]));
  }
  return parts.join(' و');
}

/** «مئة وسبعة عشر ألف ليرة سورية» — the currency noun stays in the singular. */
export function sypInWords(value: number): string {
  return `${arabicNumberWords(value)} ليرة سورية`;
}
