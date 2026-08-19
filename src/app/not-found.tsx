// src/app/not-found.tsx
//
// Root layout (src/app/layout.tsx) ตั้งใจให้ return แค่ children เฉยๆ
// (ไม่มี <html>/<body>) เพราะให้แต่ละ route group ([locale], admin,
// (partner-portal)) ประกาศ <html>/<body> ของตัวเอง — แต่ Next.js's
// not-found rendering (เวลา route ไม่ match อะไรเลยในทุก group)
// escape ไปที่ root เสมอ ไม่ผ่าน group ไหน จึงหา <html>/<body> ไม่เจอ
// แล้ว throw "Missing required html tags"
//
// ไฟล์นี้จึงต้องเป็น standalone document ของตัวเอง (มี <html>/<body> เอง)
// ไม่พึ่งพา root layout ที่ไม่สมบูรณ์
export default function NotFound() {
  return (
    <html lang="th">
      <body className="flex min-h-screen items-center justify-center bg-white text-slate-900">
        <div className="mx-auto max-w-md px-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary-dark">404</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">ไม่พบหน้านี้</h1>
          <p className="mt-2 text-sm text-slate-500">
            หน้าที่คุณกำลังหาอาจถูกย้าย ลบ หรือ URL ไม่ถูกต้อง
          </p>
          <a
            href="/th"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            กลับหน้าแรก
          </a>
        </div>
      </body>
    </html>
  );
}
