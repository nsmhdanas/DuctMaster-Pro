import React, { useState, useEffect } from 'react';
import { 
  Wind, 
  Settings, 
  ArrowRight, 
  Ruler, 
  Activity, 
  MoveHorizontal,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  FileText,
  MessageSquare,
  Loader2,
  Copy
} from 'lucide-react';

// --- CONVERSION CONSTANTS ---
const CMH_TO_CFM = 0.588578;
const PA_M_TO_IN_100FT = 0.1224; 
const M_S_TO_FPM = 196.85;
const MM_TO_IN = 0.0393701;

// --- HVAC MATH FUNCTIONS (SMACNA / ASHRAE) ---
const solveDiaByFriction = (cfm, friction) => {
  if (cfm <= 0 || friction <= 0) return 0;
  return Math.pow((0.109136 * Math.pow(cfm, 1.9)) / friction, 1 / 5.02);
};

const solveDiaByVelocity = (cfm, fpm) => {
  if (cfm <= 0 || fpm <= 0) return 0;
  const areaSqFt = cfm / fpm;
  return 2 * Math.sqrt(areaSqFt / Math.PI) * 12; 
};

const calcVelocity = (cfm, diaInches) => {
  if (diaInches <= 0) return 0;
  const areaSqFt = Math.PI * Math.pow(diaInches / 24, 2);
  return cfm / areaSqFt;
};

const calcFriction = (cfm, diaInches) => {
  if (diaInches <= 0 || cfm <= 0) return 0;
  return (0.109136 * Math.pow(cfm, 1.9)) / Math.pow(diaInches, 5.02);
};

const solveRectDimension = (targetDia, knownSide) => {
  if (targetDia <= 0 || knownSide <= 0) return 0;
  let bestSide = 0;
  let minDiff = 1000;
  for (let x = 2; x <= 150; x += 0.5) {
    const top = Math.pow(knownSide * x, 0.625);
    const bot = Math.pow(knownSide + x, 0.25);
    const calcDe = 1.30 * (top / bot);
    const diff = Math.abs(calcDe - targetDia);
    if (diff < minDiff) {
      minDiff = diff;
      bestSide = x;
    }
  }
  return bestSide;
};

export default function App() {
  // --- STATE ---
  const [units, setUnits] = useState('IP'); 
  const [mode, setMode] = useState('friction'); 

  // Input States (Native IP)
  const [airflowIP, setAirflowIP] = useState(1000); 
  const [frictionIP, setFrictionIP] = useState(0.1); 
  const [velocityIP, setVelocityIP] = useState(1200); 
  const [rectSideIP, setRectSideIP] = useState(12); 

  // Calculated Results
  const [resultDia, setResultDia] = useState(0);
  const [resultVelocity, setResultVelocity] = useState(0);
  const [resultFriction, setResultFriction] = useState(0);
  const [resultRectSide, setResultRectSide] = useState(0);

  // AI State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiMode, setAiMode] = useState(null); // 'analyze' or 'draft'

  // --- HANDLERS ---
  const handleAirflowChange = (val) => {
    const num = Number(val);
    if (units === 'IP') setAirflowIP(num);
    else setAirflowIP(num * CMH_TO_CFM);
  };

  const handleFrictionChange = (val) => {
    const num = Number(val);
    if (units === 'IP') setFrictionIP(num);
    else setFrictionIP(num * PA_M_TO_IN_100FT);
  };

  const handleVelocityChange = (val) => {
    const num = Number(val);
    if (units === 'IP') setVelocityIP(num);
    else setVelocityIP(num * M_S_TO_FPM);
  };

  const handleRectSideChange = (val) => {
    const num = Number(val);
    if (units === 'IP') setRectSideIP(num);
    else setRectSideIP(num * MM_TO_IN);
  };

  const copyToClipboard = () => {
    if (aiResponse) {
      // Use document.execCommand for iframe compatibility
      const textArea = document.createElement("textarea");
      textArea.value = aiResponse;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
  };

  // --- GEMINI API CALL ---
  const callGemini = async (type) => {
    setAiLoading(true);
    setAiResponse('');
    setAiError('');
    setAiMode(type);

    const apiKey = ""; // Provided by runtime environment
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

    // Prepare Context Data
    const dataContext = {
      airflow: `${formatNumber(units === 'IP' ? airflowIP : airflowIP / CMH_TO_CFM, 0)} ${units === 'IP' ? 'CFM' : 'CMH'}`,
      velocity: `${formatNumber(units === 'IP' ? resultVelocity : resultVelocity / M_S_TO_FPM, 0)} ${units === 'IP' ? 'FPM' : 'm/s'}`,
      friction: `${formatNumber(units === 'IP' ? resultFriction : resultFriction / PA_M_TO_IN_100FT, 2)} ${units === 'IP' ? 'in.wg/100ft' : 'Pa/m'}`,
      roundSize: `${formatNumber(units === 'IP' ? resultDia : resultDia / MM_TO_IN, 1)}" ${units === 'IP' ? 'Round' : 'mm Round'}`,
      rectSize: `${formatNumber(units === 'IP' ? rectSideIP : rectSideIP / MM_TO_IN, 0)} x ${formatNumber(units === 'IP' ? resultRectSide : resultRectSide / MM_TO_IN, 0)} ${units === 'IP' ? 'inches' : 'mm'}`
    };

    let userPrompt = "";
    if (type === 'analyze') {
      userPrompt = `Act as a senior HVAC Engineer. Analyze this duct design based on SMACNA standards. 
      Data: ${JSON.stringify(dataContext)}. 
      Please provide a concise assessment of: 
      1. Noise risk (is velocity too high for an office?). 
      2. Efficiency (is friction too high?). 
      3. Recommendation. Keep it short (max 3 sentences).`;
    } else {
      userPrompt = `Act as an HVAC Project Manager. Draft a short, professional field instruction note for the installation team.
      Include the Airflow (${dataContext.airflow}), Required Rectangular Size (${dataContext.rectSize}), and mention that it is equivalent to ${dataContext.roundSize}. 
      Remind them to verify field constraints. Keep it purely instructional and ready to copy/paste.`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }]
        })
      });

      if (!response.ok) throw new Error('API Error');
      
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
      setAiResponse(text);

    } catch (err) {
      setAiError("Failed to connect to AI. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  // --- CALCULATION EFFECT ---
  useEffect(() => {
    let d = 0;
    
    // 1. Calculate Diameter based on Mode
    if (mode === 'friction') {
      d = solveDiaByFriction(airflowIP, frictionIP);
      setResultDia(d);
      setResultVelocity(calcVelocity(airflowIP, d));
      setResultFriction(frictionIP); 
    } else {
      d = solveDiaByVelocity(airflowIP, velocityIP);
      setResultDia(d);
      setResultVelocity(velocityIP); 
      setResultFriction(calcFriction(airflowIP, d));
    }

    // 2. Calculate Rectangular Dimension
    if (d > 0 && rectSideIP > 0) {
      setResultRectSide(solveRectDimension(d, rectSideIP));
    } else {
      setResultRectSide(0);
    }

  }, [airflowIP, frictionIP, velocityIP, rectSideIP, mode]);

  // --- DISPLAY HELPERS ---
  const formatNumber = (num, decimals = 1) => {
    if (isNaN(num)) return '-';
    return num.toFixed(decimals);
  };

  // Display Values
  const displayAirflow = units === 'IP' ? airflowIP : airflowIP / CMH_TO_CFM;
  const displayFriction = units === 'IP' ? frictionIP : frictionIP / PA_M_TO_IN_100FT;
  const displayVelocity = units === 'IP' ? velocityIP : velocityIP / M_S_TO_FPM;
  const displayRectSide = units === 'IP' ? rectSideIP : rectSideIP / MM_TO_IN;
  
  const showDia = units === 'IP' ? resultDia : resultDia / MM_TO_IN;
  const showVel = units === 'IP' ? resultVelocity : resultVelocity / M_S_TO_FPM;
  const showFric = units === 'IP' ? resultFriction : resultFriction / PA_M_TO_IN_100FT;
  const showRectRes = units === 'IP' ? resultRectSide : resultRectSide / MM_TO_IN;

  // Aspect Ratio Warning
  const safeDisplayRectSide = displayRectSide || 1; 
  const safeShowRectRes = showRectRes || 1;
  const ratioVal = Math.max(safeDisplayRectSide, safeShowRectRes) / Math.min(safeDisplayRectSide, safeShowRectRes);
  const isRatioWarning = ratioVal > 4;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      
      {/* HEADER */}
      <header className="bg-slate-800 p-4 shadow-lg border-b border-slate-700 sticky top-0 z-20">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Wind size={20} className="text-white" />
            </div>
            <h1 className="font-bold text-lg">DuctMaster Pro</h1>
          </div>
          
          <button 
            onClick={() => setUnits(units === 'IP' ? 'SI' : 'IP')}
            className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-full text-xs font-bold border border-slate-600 transition-colors"
          >
            {units === 'IP' ? 'IP' : 'SI'}
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        
        {/* INPUT CARD */}
        <div className="bg-slate-800 rounded-2xl p-5 shadow-xl border border-slate-700">
          <div className="flex items-center gap-2 mb-4 text-blue-400">
            <Settings size={18} />
            <h2 className="text-sm font-bold uppercase tracking-wider">System Inputs</h2>
          </div>

          {/* Airflow */}
          <div className="mb-6">
            <div className="flex justify-between mb-2">
              <label className="text-sm text-slate-400">Air Flow Volume</label>
              <span className="text-blue-400 font-mono font-bold">
                {formatNumber(displayAirflow, 0)} {units === 'IP' ? 'CFM' : 'CMH'}
              </span>
            </div>
            <input 
              type="range"
              min={units === 'IP' ? 50 : 100}
              max={units === 'IP' ? 10000 : 17000}
              step={units === 'IP' ? 50 : 100}
              value={displayAirflow}
              onChange={(e) => handleAirflowChange(e.target.value)}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
             <div className="flex gap-2 mt-2">
                <input 
                    type="number" 
                    value={Math.round(displayAirflow)}
                    onChange={(e) => handleAirflowChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-center text-white"
                />
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="bg-slate-900 p-1 rounded-lg flex mb-4">
            <button 
              onClick={() => setMode('friction')}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === 'friction' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}
            >
              Friction
            </button>
            <button 
              onClick={() => setMode('velocity')}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === 'velocity' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}
            >
              Velocity
            </button>
          </div>

          {/* Dynamic Slider */}
          {mode === 'friction' ? (
            <div className="animate-in fade-in zoom-in-95 duration-300">
               <div className="flex justify-between mb-2">
                <label className="text-sm text-slate-400">Target Friction</label>
                <span className="text-emerald-400 font-mono font-bold">
                  {formatNumber(displayFriction, 2)} {units === 'IP' ? 'in.wg' : 'Pa/m'}
                </span>
              </div>
              <input 
                type="range"
                min={units === 'IP' ? 0.05 : 0.4}
                max={units === 'IP' ? 1.0 : 8.0}
                step={units === 'IP' ? 0.01 : 0.1}
                value={displayFriction}
                onChange={(e) => handleFrictionChange(e.target.value)}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>
          ) : (
            <div className="animate-in fade-in zoom-in-95 duration-300">
               <div className="flex justify-between mb-2">
                <label className="text-sm text-slate-400">Target Velocity</label>
                <span className="text-orange-400 font-mono font-bold">
                  {formatNumber(displayVelocity, 0)} {units === 'IP' ? 'FPM' : 'm/s'}
                </span>
              </div>
              <input 
                type="range"
                min={units === 'IP' ? 500 : 2.5}
                max={units === 'IP' ? 3500 : 18.0}
                step={units === 'IP' ? 50 : 0.5}
                value={displayVelocity}
                onChange={(e) => handleVelocityChange(e.target.value)}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
            </div>
          )}
        </div>

        {/* RESULTS */}
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-4 text-white shadow-lg relative overflow-hidden">
                <div className="absolute -right-4 -top-4 bg-white/10 w-24 h-24 rounded-full blur-2xl"></div>
                <div className="flex items-center gap-2 mb-1 text-blue-200">
                    <Activity size={16} />
                    <span className="text-xs font-bold uppercase">Round</span>
                </div>
                <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight">{formatNumber(showDia, 0)}</span>
                    <span className="text-sm font-medium opacity-80">{units === 'IP' ? '"' : 'mm'}</span>
                </div>
                <div className="mt-2 text-xs bg-black/20 rounded px-2 py-1 inline-block">
                    Ø {Math.ceil(showDia)} {units === 'IP' ? '"' : 'mm'}
                </div>
            </div>

            <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg flex flex-col justify-center">
                <span className="text-xs text-slate-400 uppercase font-bold mb-1">
                    {mode === 'friction' ? 'Velocity' : 'Friction'}
                </span>
                {mode === 'friction' ? (
                    <div>
                        <div className={`text-2xl font-bold ${showVel > (units==='IP'?1500:7.6) ? 'text-orange-400' : 'text-white'}`}>
                            {formatNumber(showVel, 1)}
                        </div>
                        <span className="text-xs text-slate-500">{units === 'IP' ? 'FPM' : 'm/s'}</span>
                    </div>
                ) : (
                    <div>
                        <div className="text-2xl font-bold text-emerald-400">
                            {formatNumber(showFric, 2)}
                        </div>
                        <span className="text-xs text-slate-500">{units === 'IP' ? 'in.wg' : 'Pa/m'}</span>
                    </div>
                )}
            </div>
        </div>

        {/* RECTANGULAR SIZER */}
        <div className="bg-slate-800 rounded-2xl p-5 shadow-xl border border-slate-700">
             <div className="flex items-center gap-2 mb-4 text-purple-400">
                <MoveHorizontal size={18} />
                <h2 className="text-sm font-bold uppercase tracking-wider">Rectangular Sizer</h2>
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <label className="text-xs text-slate-500 mb-1 block">Constraint ({units === 'IP' ? 'in' : 'mm'})</label>
                        <input 
                            type="number" 
                            value={formatNumber(displayRectSide, 0)}
                            onChange={(e) => handleRectSideChange(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-purple-500 outline-none"
                        />
                    </div>
                    <div className="pb-4 text-slate-600">x</div>
                    <div className="flex-1">
                        <label className="text-xs text-purple-400 mb-1 block">Required ({units === 'IP' ? 'in' : 'mm'})</label>
                        <div className="w-full bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 text-purple-300 font-bold">
                            {formatNumber(showRectRes, 0)}
                        </div>
                    </div>
                </div>
                
                <div className="space-y-2">
                  <div className={`w-full h-16 rounded-lg border relative flex items-center justify-center overflow-hidden transition-colors duration-300 ${isRatioWarning ? 'bg-red-900/10 border-red-500/50' : 'bg-slate-900 border-slate-700'}`}>
                      <div 
                          className={`border-2 rounded flex items-center justify-center transition-all duration-500 ${isRatioWarning ? 'bg-red-500/20 border-red-500' : 'bg-purple-600/30 border-purple-500'}`}
                          style={{
                              width: '60%',
                              height: Math.min(60, Math.max(20, (showRectRes / displayRectSide) * 30)) + 'px'
                          }}
                      >
                          <span className={`text-[10px] font-mono ${isRatioWarning ? 'text-red-300' : 'text-purple-200'}`}>
                            1 : {formatNumber(ratioVal, 2)}
                          </span>
                      </div>
                  </div>

                  <div className="flex items-center justify-between px-1">
                     <span className="text-xs text-slate-500">Max Ratio 1:4</span>
                     {isRatioWarning ? (
                       <span className="text-xs font-bold text-red-400 flex items-center gap-1 animate-pulse">
                         <AlertTriangle size={14} /> Exceeds Limit
                       </span>
                     ) : (
                       <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                         <CheckCircle2 size={14} /> SMACNA OK
                       </span>
                     )}
                  </div>
                </div>
            </div>
        </div>

        {/* GEMINI AI TOOLS SECTION */}
        <div className="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-2xl p-5 shadow-xl border border-indigo-500/30">
          <div className="flex items-center gap-2 mb-4 text-indigo-300">
            <Sparkles size={20} className="text-yellow-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider">AI Superintendent</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => callGemini('analyze')}
              disabled={aiLoading}
              className="flex flex-col items-center justify-center gap-2 p-3 bg-indigo-950/50 hover:bg-indigo-900 border border-indigo-500/50 rounded-xl transition-all disabled:opacity-50"
            >
              <MessageSquare size={20} className="text-indigo-400" />
              <span className="text-xs font-medium text-indigo-200">Safety Check</span>
            </button>
            <button
              onClick={() => callGemini('draft')}
              disabled={aiLoading}
              className="flex flex-col items-center justify-center gap-2 p-3 bg-purple-950/50 hover:bg-purple-900 border border-purple-500/50 rounded-xl transition-all disabled:opacity-50"
            >
              <FileText size={20} className="text-purple-400" />
              <span className="text-xs font-medium text-purple-200">Draft Note</span>
            </button>
          </div>

          {/* AI Response Area */}
          {(aiLoading || aiResponse || aiError) && (
            <div className="bg-slate-950/50 rounded-lg p-4 border border-indigo-500/30 min-h-[100px] relative">
              {aiLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-indigo-300 py-4">
                  <Loader2 size={24} className="animate-spin" />
                  <span className="text-xs">Consulting Standards...</span>
                </div>
              ) : aiError ? (
                <div className="text-red-400 text-sm text-center">{aiError}</div>
              ) : (
                <div className="animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs text-indigo-400 font-bold uppercase">
                      {aiMode === 'analyze' ? 'SMACNA Assessment' : 'Field Instruction'}
                    </span>
                    <button onClick={copyToClipboard} className="text-slate-500 hover:text-white">
                      <Copy size={14} />
                    </button>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {aiResponse}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}