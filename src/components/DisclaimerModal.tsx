import React from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="text-lg font-bold text-white">إخلاء المسؤولية وبيان المخاطر المالية</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-4 text-xs text-slate-300 leading-relaxed max-h-[65vh] overflow-y-auto">
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 font-medium">
            ⚠️ تنبيه إلزامي: هذا التطبيق يقدم توصيات ونماذج تحليلية فنية آلية فقط للأغراض التعليمية والإحصائية. لا يُعد نصيحة استثمارية، ولا توصية مالية مباشرة للشراء أو البيع، والقرار الاستثماري النهائي يقع على مسؤولية المستخدم بمفرده.
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5">1. عدم الاتصال بأي وسيط مالي (Zero Broker Access)</h4>
            <p className="text-slate-400">
              التطبيق لا يفتح ولا يغلق صفقات حية، ولا يتصل بحسابات التداول، ولا ينفذ أي عملية في السوق. لا نطلب ولا نخزن أي مفاتيح API لوسطاء (Broker API Keys)، ولا أي بيانات بنكية أو بطاقات ائتمانية.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5">2. طبيعة مخاطر تداول العملات والمعادن والسلع</h4>
            <p className="text-slate-400">
              تداول عقود الفروقات (CFDs)، والعملات الأجنبية (Forex)، والذهب، والفضة، والنفط ينطوي على درجة عالية من المخاطر المالية بسبب الرافعة المالية، وقد يؤدي إلى خسارة جزء أو كامل رأس المال المستثمر.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5">3. الأداء السابق لا يضمن النتائج المستقبلية</h4>
            <p className="text-slate-400">
              معدلات النجاح التاريخية (Win Rate) وإحصائيات النقاط السابقة المسجلة في التطبيق هي نتائج خوارزمية مبنية على حركة الأسعار الماضية، ولا تشكل أي ضمانة صريحة أو ضمنية لتحقيق أرباح مماثلة في المستقبل.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5">4. شفافية السجل وتوثيق التوقيت</h4>
            <p className="text-slate-400">
              كافة التوصيات تسجل وتؤرشف بتوقيتها الزمني الدقيق (Timestamp) قبل افتتاح الجلسات لضمان أعلى معايير الشفافية والنزاهة الإحصائية دون أي تعديل بعد حدوث الحركة السعرية.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors border border-slate-700"
          >
            أفهم وأوافق على بيان المخاطر
          </button>
        </div>
      </div>
    </div>
  );
};
