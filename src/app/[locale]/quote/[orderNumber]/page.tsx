export default async function QuotationPage({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>;
}) {
  const { locale, orderNumber } = await params;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
        <div className="text-4xl mb-3">📄</div>
        <h1 className="text-2xl font-bold text-slate-900">ใบเสนอราคา</h1>
        <p className="text-slate-600 mt-2">
          Order Number: <strong className="text-blue-600">{orderNumber}</strong>
        </p>
        <p className="text-slate-400 text-sm mt-4">
          ✅ Dynamic route ทำงานแล้ว!
        </p>
        <p className="text-slate-400 text-xs mt-2">
          Locale: {locale}
        </p>
      </div>
    </div>
  );
}