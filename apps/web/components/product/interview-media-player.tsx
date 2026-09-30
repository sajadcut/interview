import { Icon } from "./icon";

export function InterviewMediaPlayer({
  src,
  title = "ضبط مصاحبه",
}: {
  src?: string;
  title?: string;
}) {
  if (src) {
    return (
      <div className="overflow-hidden rounded-[14px] border border-slate-800 bg-slate-950">
        <video className="aspect-video w-full bg-black" controls preload="metadata" src={src} aria-label={title} />
      </div>
    );
  }

  return (
    <div className="grid min-h-[300px] place-items-center rounded-[14px] border border-dashed border-slate-700 bg-slate-950 p-8 text-center text-slate-200">
      <div className="max-w-md">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/10 text-indigo-300">
          <Icon name="interviews" size={20} />
        </div>
        <div className="mt-4 text-[13px] font-semibold">برای این نشست آزمایشی، فایل ضبط‌شده‌ای وجود ندارد</div>
        <p className="mt-2 text-[10px] leading-5 text-slate-400">
          پخش‌کننده واقعی ویدئو فقط زمانی نمایش داده می‌شود که نشانی فایل ضبط‌شده وجود داشته باشد. اتصال ضبط LiveKit به پردازشگر رسانه هنوز در مرحله ۴ تکمیل نشده است؛ تصویر تزئینی آواتار به‌عنوان ویدئوی مصاحبه نمایش داده نمی‌شود.
        </p>
      </div>
    </div>
  );
}
