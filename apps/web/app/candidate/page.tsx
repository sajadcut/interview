import { Card } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";

export default function CandidatePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="پرتال کاندیدا" description="ورود واقعی این بخش از طریق invitation امن و session محدود انجام خواهد شد." />
      <Card>
        <h2 className="font-bold">تجربه‌ای جدا از پنل HR</h2>
        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">Consent، device check، screening، interview و assessment در این surface مستقل اجرا می‌شوند.</p>
      </Card>
    </div>
  );
}
