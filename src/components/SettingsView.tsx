import React, { useState, useEffect } from 'react';
import { ALL_INSTRUMENTS } from '../services/mockData';
import { ApiConfig, testTwelveDataApiKey, testFinnhubApiKey, testAllTickApiKey } from '../services/liveMarketData';
import { deleteAllSignalsFromSupabase } from '../services/signalRepository';
import {
  Bell,
  Volume2,
  Send,
  Mail,
  Shield,
  Clock,
  Check,
  Smartphone,
  Sliders,
  RotateCcw,
  AlertTriangle,
  Key,
  Database,
  ExternalLink,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';

interface SettingsViewProps {
  onTriggerNotificationTest: (title: string, message: string) => void;
  onResetData: () => void;
  onOpenDisclaimer: () => void;
  apiConfig?: ApiConfig;
  onSaveApiConfig?: (config: ApiConfig) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onTriggerNotificationTest,
  onResetData,
  onOpenDisclaimer,
  apiConfig = { provider: 'demo', apiKey: '', isCustomConnected: false },
  onSaveApiConfig,
}) => {
  const [activePairs, setActivePairs] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    ALL_INSTRUMENTS.forEach((inst) => {
      map[inst.symbol] = true;
    });
    return map;
  });

  // API Provider state
  const [selectedProvider, setSelectedProvider] = useState<'twelvedata' | 'finnhub' | 'alltick' | 'demo'>(
    apiConfig.provider || 'demo'
  );
  const [apiKeyInput, setApiKeyInput] = useState<string>(apiConfig.apiKey);
  const [isTestingApi, setIsTestingApi] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [morningAlert, setMorningAlert] = useState(true);
  const [eveningReport, setEveningReport] = useState(true);
  const [telegramAlerts, setTelegramAlerts] = useState(false);
  const [emailDigest, setEmailDigest] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('@AlphaFX_Trading_Signals');
  const [emailAddress, setEmailAddress] = useState('user@trader.com');

  const togglePair = (symbol: string) => {
    setActivePairs((prev) => ({
      ...prev,
      [symbol]: !prev[symbol],
    }));
  };

  const playChimeSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn('AudioContext not allowed without gesture', e);
    }
  };

  const handleTestNotification = () => {
    if (soundEnabled) playChimeSound();
    onTriggerNotificationTest(
      '🚨 توصية جديدة: XAU/USD (شراء)',
      'تم نشر توصية جديدة على الذهب قبل افتتاح لندن. الدخول: 2682.50 | الهدف: 2712.00 | الوقف: 2668.00'
    );
  };

  // Test real API connection
  const handleTestConnection = async () => {
    if (selectedProvider === 'demo') {
      setTestResult({
        success: true,
        message: 'تم تفعيل وضع المحاكاة والبيانات الإرشادية (Simulation Mode).',
      });
      if (onSaveApiConfig) {
        onSaveApiConfig({ provider: 'demo', apiKey: '', isCustomConnected: false });
      }
      return;
    }

    setIsTestingApi(true);
    setTestResult(null);

    let res;
    if (selectedProvider === 'twelvedata') {
      res = await testTwelveDataApiKey(apiKeyInput);
    } else if (selectedProvider === 'alltick') {
      res = await testAllTickApiKey(apiKeyInput);
    } else {
      res = await testFinnhubApiKey(apiKeyInput);
    }

    setIsTestingApi(false);
    setTestResult(res);

    if (res.success && onSaveApiConfig) {
      onSaveApiConfig({
        provider: selectedProvider,
        apiKey: apiKeyInput.trim(),
        isCustomConnected: true,
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Title */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-amber-400" />
          <span>إعدادات التطبيق ومزودات البيانات الحية</span>
        </h2>
        <p className="text-xs text-slate-400">
          ربط مفاتيح مزودات الأسعار الحية (Twelve Data / Finnhub)، إدارة العملات الخاضعة للمراقبة، وتخصيص التنبيهات
        </p>
      </div>

      {/* Real Live API Provider Integration Panel */}
      <div className="p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">
                مزود بيانات السوق المباشر وربط الـ API (Live Market Data Feed)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              التطبيق يدعم الربط المباشر مع مزودي البيانات المذكورين في برومت المشروع لجلب الأسعار وشموع OHLC الحقيقية من البورصات
            </p>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-mono font-bold shrink-0 ${
              apiConfig.isCustomConnected
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}
          >
            {apiConfig.isCustomConnected ? '🟢 بث حي مخصص متصل' : '🟡 وضع العرض التجريبي والمحاكاة'}
          </span>
        </div>

        {/* Provider Radio Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label
            onClick={() => setSelectedProvider('twelvedata')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
              selectedProvider === 'twelvedata'
                ? 'bg-slate-950 border-amber-500/50 text-white shadow-md'
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-white text-sm">Twelve Data (موصى به)</span>
              <input
                type="radio"
                name="provider"
                checked={selectedProvider === 'twelvedata'}
                onChange={() => setSelectedProvider('twelvedata')}
                className="text-amber-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              يدعم كامل أزواج الفوركس، والذهب XAU/USD، والنفط WTI، مع شموع تاريخية دقيقة.
            </p>
          </label>

          <label
            onClick={() => setSelectedProvider('finnhub')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
              selectedProvider === 'finnhub'
                ? 'bg-slate-950 border-amber-500/50 text-white shadow-md'
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-white text-sm">Finnhub API</span>
              <input
                type="radio"
                name="provider"
                checked={selectedProvider === 'finnhub'}
                onChange={() => setSelectedProvider('finnhub')}
                className="text-amber-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              مزود مؤسسي سريع لأسعار العملات والسلع مع مفتاح تجريبي مجاني فوري.
            </p>
          </label>

          <label
            onClick={() => setSelectedProvider('alltick')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
              selectedProvider === 'alltick'
                ? 'bg-slate-950 border-amber-500/50 text-white shadow-md'
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-white text-sm">AllTick Real-Time API</span>
              <input
                type="radio"
                name="provider"
                checked={selectedProvider === 'alltick'}
                onChange={() => setSelectedProvider('alltick')}
                className="text-amber-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              ربط تدفقات AllTick اللحظية عالية الأداء لأسواق الفوركس والمعادن.
            </p>
          </label>

          <label
            onClick={() => setSelectedProvider('demo')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
              selectedProvider === 'demo'
                ? 'bg-slate-950 border-amber-500/50 text-white shadow-md'
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-white text-sm">وضع المحاكاة والبيانات الإرشادية</span>
              <input
                type="radio"
                name="provider"
                checked={selectedProvider === 'demo'}
                onChange={() => setSelectedProvider('demo')}
                className="text-amber-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              توليد وتحليل التوصيات بنماذج رياضية ومحاكاة شارت دون الحاجة لأي مفتاح API خارجي.
            </p>
          </label>
        </div>

        {/* API Key Input Field (When twelve data or finnhub selected) */}
        {selectedProvider !== 'demo' && (
          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>أدخل مفتاح الـ API الخاص بك ({selectedProvider === 'twelvedata' ? 'Twelve Data' : selectedProvider === 'alltick' ? 'AllTick' : 'Finnhub'} API Key):</span>
              </label>
              <a
                href={selectedProvider === 'twelvedata' ? 'https://twelvedata.com/pricing' : selectedProvider === 'alltick' ? 'https://alltick.co/' : 'https://finnhub.io/register'}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
              >
                <span>احصل على مفتاح مجاني من الموقع الرسمي</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="password"
                placeholder={selectedProvider === 'twelvedata' ? 'e.g. 74d89a20b...' : selectedProvider === 'alltick' ? 'e.g. token_...' : 'e.g. c123456789...'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleTestConnection}
                disabled={isTestingApi || !apiKeyInput.trim()}
                className="w-full sm:w-auto px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {isTestingApi ? 'جارِ فحص الاتصال...' : 'فحص الاتصال وتفعيل البث الحي'}
              </button>
            </div>

            {/* Test result message */}
            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/40 border border-rose-800 text-rose-300'
                }`}
              >
                {testResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notifications & Timings Settings */}
      <div className="p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-5 shadow-xl">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
          <Bell className="w-4 h-4 text-sky-400" />
          <span>إعدادات الإشعارات والتوقيت الحرج (Timing Engine)</span>
        </h3>

        <div className="space-y-4 text-xs">
          {/* Morning Signals Alert */}
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <div className="font-semibold text-white flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>إشعار التوصيات الصباحي (قبل افتتاح السوق الأوروبي بـ 30 دقيقة)</span>
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                توليد ونشر التوصيات اليومية تلقائياً الساعة 07:30 بتوقيت جرينتش (09:30 القاهرة / 10:30 الرياض)
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={morningAlert}
                onChange={(e) => setMorningAlert(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {/* Evening Results Report Alert */}
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <div className="font-semibold text-white flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>إشعار تقرير النتائج المسائي (بعد إغلاق السوق الأمريكي)</span>
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                إرسال تقرير فحص نتائج الصفقات وحساب النقاط المحققة يومياً الساعة 21:00 GMT
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={eveningReport}
                onChange={(e) => setEveningReport(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          {/* Audio Chime */}
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <div className="font-semibold text-white flex items-center gap-2">
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>نغمة التنبيه الصوتية الفورية (Audio Chime)</span>
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                تشغيل رنين مالي فوري عند ورود توصية جديدة أو بلوغ أحد الأهداف
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>

          {/* Test Notification Button */}
          <div className="pt-2">
            <button
              onClick={handleTestNotification}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold transition-colors border border-slate-700 text-xs"
            >
              <Bell className="w-4 h-4 text-amber-400" />
              <span>تجربة صوت وإشعار التوصيات الآن (Test Alert)</span>
            </button>
          </div>
        </div>
      </div>

      {/* External Integrations (Telegram & Email) */}
      <div className="p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4 shadow-xl">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
          <Send className="w-4 h-4 text-sky-400" />
          <span>تكامل قنوات البث المباشر (Telegram & Email Delivery)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Telegram Bot */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Send className="w-4 h-4 text-sky-400" />
                <span>بوت التيليجرام (Telegram Bot)</span>
              </div>
              <input
                type="checkbox"
                checked={telegramAlerts}
                onChange={(e) => setTelegramAlerts(e.target.checked)}
                className="w-4 h-4 rounded text-sky-500 bg-slate-900 border-slate-700"
              />
            </div>
            <p className="text-slate-400 text-[11px]">
              نشر فوري للشارت والنص التحليلي إلى قناة أو مجموعة تيليجرام
            </p>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="@ChannelOrChatID"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
            />
          </div>

          {/* Email Digest */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Mail className="w-4 h-4 text-emerald-400" />
                <span>النشرة البريدية اليومية (Email Digest)</span>
              </div>
              <input
                type="checkbox"
                checked={emailDigest}
                onChange={(e) => setEmailDigest(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700"
              />
            </div>
            <p className="text-slate-400 text-[11px]">
              استلام ملخص التوصيات الصباحية وتقرير الأرباح اليومية عبر البريد
            </p>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder="trader@domain.com"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Monitored Assets Watchlist Toggles */}
      <div className="p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span>تخصيص قائمة المراقبة (Watchlist & Asset Pairs)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              حدد العملات والسلع التي ترغب في تضمينها في الفحص الآلي اليومي
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {Object.values(activePairs).filter(Boolean).length} / {ALL_INSTRUMENTS.length} نشطة
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs">
          {ALL_INSTRUMENTS.map((inst) => {
            const isActive = activePairs[inst.symbol] ?? true;
            return (
              <button
                key={inst.symbol}
                onClick={() => togglePair(inst.symbol)}
                className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between ${
                  isActive
                    ? 'bg-slate-950 border-amber-500/40 text-white shadow-sm'
                    : 'bg-slate-950/40 border-slate-800/80 text-slate-500 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-sm">{inst.symbol}</span>
                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${isActive ? 'bg-amber-500 text-slate-950 font-bold' : 'border border-slate-700'}`}>
                    {isActive && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 truncate">{inst.nameAr}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Disclaimer & Regulatory Safeguard Actions */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>إخلاء المسؤولية التنظيمي وحماية البيانات</span>
          </h4>
          <p className="text-xs text-slate-400">
            التطبيق لا يتصل بأي حسابات تداول ولا يطلب أو يخزن أي بيانات بنكية أو مفاتيح وسطاء.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenDisclaimer}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors border border-slate-700"
          >
            قراءة إخلاء المسؤولية الكامل
          </button>
          
          <button
            onClick={async () => {
              if (confirm('هل أنت متأكد؟ سيتم مسح كافة الصفقات والبيانات من كل الأقسام (بما في ذلك قاعدة البيانات على الويب). لن يتم مسح مفاتيح الـ API.')) {
                // 1. Clear local storage
                Object.keys(localStorage).forEach(key => {
                  if (!key.includes('api_config')) {
                    localStorage.removeItem(key);
                  }
                });
                localStorage.setItem('alphafx_today_signals', '{"cleared":true}');
                localStorage.setItem('alphafx_historical_signals', '{"cleared":true}');
                
                // 2. Clear remote database
                await deleteAllSignalsFromSupabase();
                
                window.location.reload();
              }
            }}
            className="px-3.5 py-2 bg-rose-900/50 hover:bg-rose-800 text-rose-200 rounded-xl text-xs font-bold transition-colors border border-rose-700 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>تصفير كامل للبيانات (Hard Reset)</span>
          </button>

          <button
            onClick={onResetData}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-xs font-semibold transition-colors border border-slate-700 flex items-center gap-1.5"
          >
            <span>إعادة ضبط المصنع (افتراضي)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
