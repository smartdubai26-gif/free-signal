import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-slate-900 border border-rose-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
            <div className="w-16 h-16 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
              <AlertTriangle className="w-8 h-8 animate-pulse" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white mb-2">عذراً، حدث خطأ غير متوقع في النظام</h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                تم رصد خطأ في تشغيل الواجهة. قام نظام الحماية (Error Boundary) بإيقاف الانهيار ومنع الشاشة البيضاء. تفاصيل الخطأ أدناه:
              </p>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-left font-mono text-xs text-rose-300 overflow-x-auto max-h-40">
              <p className="font-bold mb-1">{this.state.error && this.state.error.toString()}</p>
              <pre className="text-[10px] text-slate-400 whitespace-pre-wrap">
                {this.state.errorInfo && this.state.errorInfo.componentStack}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>إعادة تحميل التطبيق</span>
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="w-full sm:w-auto px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition-all cursor-pointer"
              >
                مسح الذاكرة المؤقتة وإعادة التشغيل
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
