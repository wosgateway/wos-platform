'use client';

import { useState } from 'react';
import Image from 'next/image';

export function PartnerGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const main = images[active] || images[0];

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-3xl shadow-xl card-shadow">
        <div className="relative h-64 w-full sm:h-80">
          <Image src={main} alt={alt} fill className="object-cover" sizes="100vw" priority />
        </div>
      </div>
      {images.length > 1 && (
        <div className="mb-8 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {images.map((img, i) => (
            <button
              key={img + i}
              onClick={() => setActive(i)}
              className={`relative h-16 overflow-hidden rounded-lg border-2 ${
                i === active ? 'border-primary' : 'border-transparent'
              }`}
            >
              <Image src={img} alt={`${alt} ${i + 1}`} fill className="object-cover" sizes="100px" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
