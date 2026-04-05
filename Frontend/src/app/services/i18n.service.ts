import { Injectable, signal } from '@angular/core';

export type Lang = 'en' | 'ar';

const AR: Record<string, string> = {
  'hero.title': 'مجموعات Kubernetes الحقيقية. VS Code في المتصفح. 3 وكلاء ذكاء اصطناعي.',
  'hero.subtitle': 'بيئة K8s مخصصة + Docker + VS Code لكل طالب في 10 ثوانٍ. مُرشد ذكاء اصطناعي يبدأ بالتلميحات.',
  'hero.mission': 'ديمقراطية تعليم هندسة البرمجيات والبنية التحتية السحابية عبر بنية تحتية حقيقية.',
  'hero.cta.free': 'ابدأ مجاناً — بدون بطاقة ائتمان',
  'hero.cta.pricing': 'عرض الأسعار',
  'hero.free_note': 'الفئة المجانية تشمل ساعتين أسبوعياً · بدون إعداد · إلغاء في أي وقت',
  'stats.labs': 'معامل تم إطلاقها',
  'stats.questions': 'أسئلة تمت الإجابة عليها',
  'stats.ai': 'رسائل الذكاء الاصطناعي',
  'stats.provisioning': 'وقت إطلاق المعمل',
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  private _lang = signal<Lang>(
    localStorage.getItem('rc_lang') === 'ar' ? 'ar' : 'en'
  );

  readonly lang = this._lang.asReadonly();

  t(key: string): string {
    if (this._lang() === 'ar') return AR[key] ?? key;
    return key;
  }

  setLang(lang: Lang): void {
    this._lang.set(lang);
    localStorage.setItem('rc_lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }

  isRtl(): boolean {
    return this._lang() === 'ar';
  }
}
