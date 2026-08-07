import Image from 'next/image';

export function WhyCard({
  image,
  alt,
  title,
  desc,
}: {
  image: string;
  alt: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="card-shadow group overflow-hidden rounded-2xl border border-slate-100 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative h-36 w-full overflow-hidden">
        <Image
          src={image}
          alt={alt}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-110"
          sizes="(max-width: 768px) 100vw, 25vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />
        <div className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow">
          ✓
        </div>
      </div>
      <div className="p-6 pt-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{desc}</p>
      </div>
    </div>
  );
}
