
import React, { useState, useRef, useCallback } from 'react';
import { 
  ShieldCheck, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  Search, 
  Image as ImageIcon,
  ArrowRight,
  Loader2,
  Trash2,
  Edit3,
  Upload,
  Files
} from 'lucide-react';
import { GeminiService } from './services/geminiService';
import { AuditStatus, AuditReport } from './types';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.mjs`;

const TrafficLight = ({ status }: { status: AuditStatus }) => {
  const colors = {
    [AuditStatus.COMPLIANT]: 'bg-green-500',
    [AuditStatus.VIOLATION]: 'bg-red-500',
    [AuditStatus.UNCERTAIN]: 'bg-yellow-500',
  };
  const labels = {
    [AuditStatus.COMPLIANT]: '적합 (Compliant)',
    [AuditStatus.VIOLATION]: '위반 (Violation)',
    [AuditStatus.UNCERTAIN]: '판단 불가 / 주의',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
      <div className={`w-3 h-3 rounded-full ${colors[status]} animate-pulse`} />
      <span className="text-xs font-semibold text-slate-700 uppercase tracking-tight">
        {labels[status]}
      </span>
    </div>
  );
};

export default function App() {
  const [regulation, setRegulation] = useState('');
  const [scenario, setScenario] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [useSearch, setUseSearch] = useState(false);
  const [evidenceImage, setEvidenceImage] = useState<string | null>(null);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const geminiRef = useRef(new GeminiService());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAudit = async () => {
    if (!regulation.trim() || !scenario.trim()) {
      setError("판단 기준이 부족합니다. 규정 전문과 검토 사안을 모두 입력해주세요.");
      return;
    }
    setError(null);
    setIsAuditing(true);
    try {
      const result = await geminiRef.current.runAudit(regulation, scenario, useSearch);
      setReport(result);
    } catch (err: any) {
      setError(err.message || "감사 중 오류가 발생했습니다.");
    } finally {
      setIsAuditing(false);
    }
  };

  /**
   * Improved PDF parsing that sorts text items by coordinates 
   * to maintain table and line structure.
   */
  const parsePDF = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Sort items by Y (top to bottom) and then X (left to right)
      const items = content.items as any[];
      items.sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 5) return yDiff; // Different line
        return a.transform[4] - b.transform[4]; // Same line, sort by x
      });

      let lastY = -1;
      let pageText = `--- Page ${i} ---\n`;
      
      for (const item of items) {
        if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += '\n'; // Add line break when Y coordinate changes significantly
        } else if (lastY !== -1) {
          pageText += ' | '; // Use separator to help AI distinguish columns in tables
        }
        pageText += item.str;
        lastY = item.transform[5];
      }
      fullText += pageText + '\n\n';
    }
    return fullText;
  };

  /**
   * Improved Excel parsing that uses CSV format to better preserve 
   * tabular data structure for AI analysis.
   */
  const parseExcel = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let fullText = '';
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      fullText += `--- Sheet: ${sheetName} (CSV Format) ---\n`;
      fullText += XLSX.utils.sheet_to_csv(worksheet) + '\n\n';
    });
    return fullText;
  };

  const parseDocx = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const processFiles = async (files: FileList | File[]) => {
    setIsParsing(true);
    setError(null);

    let newRegulationText = '';
    let lastImage: string | null = null;

    try {
      for (const file of Array.from(files)) {
        const fileType = file.name.split('.').pop()?.toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'webp'].includes(fileType || '')) {
          const reader = new FileReader();
          const imagePromise = new Promise<string>((resolve) => {
            reader.onload = (e) => resolve(e.target?.result as string);
          });
          reader.readAsDataURL(file);
          lastImage = await imagePromise;
        } else {
          const arrayBuffer = await file.arrayBuffer();
          let text = '';
          
          if (fileType === 'pdf') {
            text = await parsePDF(arrayBuffer);
          } else if (['xlsx', 'xls', 'csv'].includes(fileType || '')) {
            text = await parseExcel(arrayBuffer);
          } else if (fileType === 'docx') {
            text = await parseDocx(arrayBuffer);
          } else {
            text = new TextDecoder().decode(arrayBuffer);
          }
          newRegulationText += `\n[FILE START: ${file.name}]\n${text}\n[FILE END: ${file.name}]\n`;
        }
      }

      if (newRegulationText) {
        setRegulation(prev => prev + newRegulationText);
      }
      if (lastImage) {
        setEvidenceImage(lastImage);
      }
    } catch (err: any) {
      console.error(err);
      setError(`파일 처리 중 오류 발생: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, []);

  const handleEditImage = async () => {
    if (!evidenceImage || !imagePrompt) return;
    setIsEditingImage(true);
    try {
      const newImage = await geminiRef.current.editImage(evidenceImage, imagePrompt);
      setEvidenceImage(newImage);
      setImagePrompt('');
    } catch (err: any) {
      alert("이미지 편집에 실패했습니다: " + err.message);
    } finally {
      setIsEditingImage(false);
    }
  };

  return (
    <div 
      className={`min-h-screen flex flex-col bg-slate-50 text-slate-900 transition-all duration-300 ${isDragging ? 'brightness-90' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-blue-900/40 backdrop-blur-sm flex items-center justify-center pointer-events-none border-8 border-dashed border-blue-400 m-4 rounded-3xl">
          <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200">
            <Files className="w-16 h-16 text-blue-600 animate-bounce" />
            <p className="text-2xl font-bold text-blue-900">여기에 파일을 놓아주세요</p>
            <p className="text-slate-500 italic">PDF, DOCX, XLSX, Image 지원</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="h-16 border-b bg-white flex items-center justify-between px-8 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-blue-900" />
          <h1 className="text-xl font-bold text-blue-900 tracking-tight">
            Compliance Guardian <span className="text-slate-400 font-normal">| AI Auditor</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button 
            onClick={() => setUseSearch(!useSearch)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
              useSearch ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500'
            }`}
          >
            <Search className="w-4 h-4" />
            Web Search
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Input Zone */}
        <section className="flex flex-col gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-700 font-semibold">
                <FileText className="w-5 h-5" />
                <span>Reference Regulations (규정 데이터)</span>
              </div>
              <div className="flex items-center gap-3">
                {isParsing && (
                  <span className="text-[10px] text-blue-500 flex items-center gap-1 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Parsing...
                  </span>
                )}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs bg-slate-100 px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 transition-colors flex items-center gap-2 border border-slate-200"
                >
                  <Upload className="w-3 h-3" />
                  파일 올리기
                </button>
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                multiple
                accept=".txt,.pdf,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
              />
            </div>
            <div className="relative">
              <textarea
                className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm font-light leading-relaxed transition-all"
                placeholder="규정 내용을 붙여넣거나 여러 파일을 드래그하여 넣으세요. (PDF, Word, Excel 지원)"
                value={regulation}
                onChange={(e) => setRegulation(e.target.value)}
              />
              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <Files className="w-5 h-5 text-slate-300" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-slate-700 font-semibold">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span>Case Scenario (검토 요청 사안)</span>
            </div>
            <textarea
              className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm font-light leading-relaxed"
              placeholder="분석하고 싶은 구체적인 사건이나 행위를 상세히 서술하세요..."
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            />
          </div>

          {/* Evidence Image */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-700 font-semibold">
                <ImageIcon className="w-5 h-5 text-blue-500" />
                <span>Visual Evidence (증거 이미지)</span>
              </div>
              {evidenceImage && (
                <button 
                  onClick={() => setEvidenceImage(null)}
                  className="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {evidenceImage ? (
              <div className="flex flex-col gap-4">
                <div className="relative group rounded-lg overflow-hidden border border-slate-200 bg-black/5 flex items-center justify-center min-h-[200px]">
                  <img src={evidenceImage} alt="Evidence" className="max-h-[400px] object-contain" />
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    className="flex-1 px-3 py-2 bg-slate-100 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="이미지 편집 명령 (예: '위반 부위 강조'...)"
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEditImage()}
                  />
                  <button
                    onClick={handleEditImage}
                    disabled={isEditingImage || !imagePrompt}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm flex items-center gap-2 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {isEditingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                    Edit
                  </button>
                </div>
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-lg p-8 flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:bg-slate-50 hover:border-blue-200 transition-all group"
              >
                <ImageIcon className="w-10 h-10 mb-2 group-hover:text-blue-400 transition-colors" />
                <span className="text-sm">클릭하거나 이미지를 드래그하세요</span>
              </div>
            )}
          </div>

          <button
            onClick={handleAudit}
            disabled={isAuditing || isParsing}
            className="w-full bg-blue-900 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-900/20 hover:bg-blue-800 active:scale-[0.98] transition-all flex items-center justify-center gap-3 text-lg relative overflow-hidden disabled:bg-slate-400"
          >
            {isAuditing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Auditing...
                <div className="scanning-line" />
              </>
            ) : (
              <>
                <ShieldCheck className="w-6 h-6" />
                Audit Now
                <ArrowRight className="w-5 h-5 ml-2 opacity-50" />
              </>
            )}
          </button>

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-lg text-sm flex items-center gap-3">
              <Info className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}
        </section>

        {/* Right Column: Audit Report */}
        <section className="bg-white rounded-xl shadow-xl border border-slate-200 flex flex-col h-full overflow-hidden">
          <div className="p-6 border-b flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-lg">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              Audit Report
            </div>
            {report && <TrafficLight status={report.status} />}
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-[#fdfdfd]">
            {!report && !isAuditing ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-60">
                <FileText className="w-16 h-16" />
                <p className="text-lg">분석 준비 완료. 규정과 사안을 입력해주세요.</p>
              </div>
            ) : isAuditing ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-blue-900/30">
                <Loader2 className="w-12 h-12 animate-spin" />
                <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden relative">
                  <div className="absolute h-full bg-blue-600 animate-[loading_1.5s_infinite]" style={{ width: '40%' }}></div>
                </div>
                <p className="font-medium animate-pulse">규정 문서를 파싱하고 사안을 대조 중입니다...</p>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div 
                  className="markdown-content text-slate-800 leading-relaxed space-y-4 prose prose-slate max-w-none"
                  dangerouslySetInnerHTML={{ __html: report!.rawMarkdown.replace(/\n/g, '<br/>') }} 
                />
                
                {report?.groundingUrls && report.groundingUrls.length > 0 && (
                  <div className="mt-12 pt-6 border-t border-slate-100">
                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      References
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {report.groundingUrls.map((link, idx) => (
                        <a 
                          key={idx}
                          href={link.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-xs"
                        >
                          <div className="w-8 h-8 rounded bg-white border flex items-center justify-center text-blue-500 font-bold">
                            {idx + 1}
                          </div>
                          <div className="flex-1 truncate">
                            <div className="font-semibold text-slate-700 truncate">{link.title}</div>
                            <div className="text-slate-400 truncate text-[10px]">{link.uri}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 border-t text-[10px] text-slate-400 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              AI Auditor Engine Active
            </div>
            <span>Ref ID: CG-{Math.random().toString(36).substr(2, 9).toUpperCase()}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
