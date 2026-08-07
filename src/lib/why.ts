// รูปภาพประกอบการ์ด "ทำไมต้อง WOS" บนหน้า home
// แยกออกจาก messages/*.json เพราะรูปไม่ได้แปลตามภาษา (เหมือน CATEGORIES ใน lib/categories.ts)
// ลำดับต้องตรงกับลำดับของ home.why.items ใน messages/th.json, en.json, lo.json

export interface WhyImage {
  image: string;
  alt: string;
}

export const WHY_IMAGES: WhyImage[] = [
  { image: '/images/why/verified-partners.webp', alt: 'Verified partners' },
  { image: '/images/why/transparent-pricing.webp', alt: 'Transparent pricing' },
  { image: '/images/why/cross-border.webp', alt: 'Cross-border coordination' },
  { image: '/images/why/local-support.webp', alt: 'Local support team' },
];
