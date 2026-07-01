// FormatFlow site + online tester. Loaded with defer, so the DOM is ready.
window.plausible = window.plausible || function(){ (window.plausible.q = window.plausible.q || []).push(arguments); };

const demoFile = document.getElementById('demoFile');
const fileList = document.getElementById('fileList');
const runDemo = document.getElementById('runDemo');
const progressBar = document.getElementById('progressBar');
const demoStatusTitle = document.getElementById('demoStatusTitle');
const demoStatusText = document.getElementById('demoStatusText');
const resultGrid = document.getElementById('resultGrid');
const qaList = document.getElementById('qaList');
const textPreview = document.getElementById('textPreview');
const downloadReport = document.getElementById('downloadReport');
const translatePreview = document.getElementById('translatePreview');
const translateFile = document.getElementById('translateFile');
const translateResult = document.getElementById('translateResult');
let selectedFile = null;
const API_BASE = location.hostname.endsWith('vercel.app') || location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '' : 'https://formatflow-ai.vercel.app';
let lastReport = null;

// Free round-trip translation caps: larger files belong in the Windows app.
const MAX_RT_SEGMENTS = 150;
const MAX_RT_TOTAL_CHARS = 9000;
const MAX_RT_SEGMENT_CHARS = 600;
const RUN_RE = /(<(a|w):t(?:\s[^>]*)?>)([\s\S]*?)(<\/\2:t>)/g;

function track(event, props){ try{ window.plausible && window.plausible(event, props ? {props} : undefined); }catch(e){} }
document.querySelectorAll('[data-track="download"]').forEach(el => el.addEventListener('click', () => track('Download', {location: el.dataset.loc || 'unknown'})));
document.querySelectorAll('[data-track="early-access"]').forEach(el => el.addEventListener('click', () => track('Early Access')));

let jsZipPromise = null;
function loadJSZip(){
  if(window.JSZip) return Promise.resolve(window.JSZip);
  if(!jsZipPromise){
    jsZipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/assets/vendor/jszip.min.js';
      s.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip failed to initialise.'));
      s.onerror = () => reject(new Error('Could not load the file reader library. Check your connection and retry.'));
      document.head.appendChild(s);
    });
  }
  return jsZipPromise;
}

let pdfJsPromise = null;
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(!pdfJsPromise){
    pdfJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = () => {
        if(window.pdfjsLib){
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('PDF reader failed to initialise.'));
        }
      };
      s.onerror = () => reject(new Error('Could not load the PDF reader library. Check your connection and retry.'));
      document.head.appendChild(s);
    });
  }
  return pdfJsPromise;
}

async function extractPdf(file){
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({data}).promise;
  const pageCap = Math.min(doc.numPages, 40);
  const texts = [];
  for(let i = 1; i <= pageCap; i++){
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = normaliseText(content.items.map(item => item.str).join(' '));
    if(line) texts.push(`Page ${i}: ${line}`);
  }
  return {kind:'PDF Document', units:doc.numPages, unitLabel:'pages', texts, pdfTruncated:doc.numPages > pageCap, pdfScanned:texts.join('').length < doc.numPages * 8};
}

function readableSize(bytes){ if(!bytes) return '0 MB'; const mb=bytes/1024/1024; return `${mb.toFixed(2)} MB`; }
function selectedLanguages(){ return Array.from(document.querySelectorAll('.language-grid input:checked')).map(input=>input.value); }
function escapeHtml(value){ return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function setProgress(value){ progressBar.style.width = `${value}%`; }
function normaliseText(text){ return text.replace(/\s+/g,' ').trim(); }
function decodeXml(value){ return value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function encodeXml(value){ return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function xmlToTexts(xml){ const decoded = decodeXml(xml); const matches = [...decoded.matchAll(/<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g)].map(m => normaliseText(m[1])).filter(Boolean); return matches; }
function docxPartNames(zip){ return Object.keys(zip.files).filter(name => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name)); }
function pptxPartNames(zip){ return Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1]||0)-Number(b.match(/slide(\d+)/)?.[1]||0)); }
async function extractDocx(zip){ const files = docxPartNames(zip); let texts=[]; for(const name of files){ const xml = await zip.file(name).async('string'); texts = texts.concat(xmlToTexts(xml)); } return {kind:'Word Document', units:files.length, unitLabel:'document XML parts', texts}; }
async function extractPptx(zip){ const slideNames = pptxPartNames(zip); let texts=[]; for(const name of slideNames){ const xml = await zip.file(name).async('string'); const slideTexts = xmlToTexts(xml); if(slideTexts.length) texts.push(`Slide ${name.match(/slide(\d+)/)?.[1] || ''}: ${slideTexts.join(' | ')}`); } return {kind:'PowerPoint Presentation', units:slideNames.length, unitLabel:'slides', texts}; }
function buildChecks({file, kind, units, unitLabel, texts, languages}){ const words = texts.join(' ').split(/\s+/).filter(Boolean).length; const longSegments = texts.filter(t => t.length > 160).length; const checks = ['✓ File type recognised', `✓ ${kind} structure detected`, `✓ ${units} ${unitLabel || (units === 1 ? 'unit' : 'units')} scanned`, `✓ ${languages.length} target language${languages.length === 1 ? '' : 's'} selected`]; if(kind !== 'PDF Document') checks.push('✓ Review-ready naming preview generated'); if(longSegments) checks.push(`⚠ ${longSegments} long text segment${longSegments === 1 ? '' : 's'} may need fit checks after translation`); if(words > 1200) checks.push('⚠ Larger file: split review into sections for better QA'); if(file.size > 20 * 1024 * 1024) checks.push('⚠ Large file: online processing may be slower'); return {words,longSegments,checks}; }
function makeOutputs(fileName, languages){ if(/\.pdf$/i.test(fileName)) return []; const base = fileName.replace(/\.(pptx|docx)$/i,''); const ext = fileName.toLowerCase().endsWith('.docx') ? 'docx' : 'pptx'; return languages.map(lang => `${base}_${lang.slice(0,2).toUpperCase()}.${ext}`); }
function renderAnalysis(report){ resultGrid.innerHTML = `<div class="result-card"><h4>Detected File</h4><p>${escapeHtml(report.fileName)}<br>${report.fileSize}</p></div><div class="result-card"><h4>Structure</h4><p>${report.kind}<br>${report.units} ${report.unitLabel}<br>${report.words} words extracted</p></div><div class="result-card"><h4>Translation Plan</h4><p>${escapeHtml(report.languages.join(', '))}<br>${escapeHtml(report.docType)}</p></div><div class="result-card"><h4>Export Preview</h4><p>${report.outputs.length ? report.outputs.map(escapeHtml).join('<br>') : 'PDF translation is on the roadmap — this report covers analysis and QA only.'}</p></div>`; qaList.innerHTML = report.checks.map(item => `<div>${escapeHtml(item)}</div>`).join(''); textPreview.textContent = report.preview || 'No extractable text found. The file may contain images, scanned content or unsupported objects.'; downloadReport.disabled = false; translatePreview.disabled = !report.preview; if(translateFile) translateFile.disabled = !(report.preview && /\.(pptx|docx)$/i.test(report.fileName)); }
function downloadHtmlReport(report){ const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FormatFlow Review Report</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;line-height:1.55;color:#111}h1{font-size:32px}.card{border:1px solid #ddd;border-radius:16px;padding:18px;margin:14px 0}pre{white-space:pre-wrap;background:#f6f8fa;padding:16px;border-radius:12px}</style></head><body><h1>FormatFlow Review Report</h1><div class="card"><strong>File:</strong> ${escapeHtml(report.fileName)}<br><strong>Type:</strong> ${escapeHtml(report.kind)}<br><strong>Size:</strong> ${escapeHtml(report.fileSize)}<br><strong>Structure:</strong> ${report.units} ${escapeHtml(report.unitLabel)}<br><strong>Words extracted:</strong> ${report.words}</div><div class="card"><h2>Target Languages</h2><p>${escapeHtml(report.languages.join(', '))}</p><h2>Planned Outputs</h2><ul>${report.outputs.length ? report.outputs.map(o=>`<li>${escapeHtml(o)}</li>`).join('') : '<li>PDF translation is on the roadmap — analysis and QA only today.</li>'}</ul></div><div class="card"><h2>QA Checks</h2><ul>${report.checks.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul></div><div class="card"><h2>Extracted Text Preview</h2><pre>${escapeHtml(report.preview)}</pre></div><p>This report was generated locally in the browser by the FormatFlow online file tester.</p></body></html>`; const blob = new Blob([html], {type:'text/html'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${report.fileName.replace(/\.(pptx|docx|pdf)$/i,'')}_FormatFlow_Report.html`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }

demoFile.addEventListener('change',(event)=>{ const file=event.target.files && event.target.files[0]; if(!file) return; const lower=file.name.toLowerCase(); selectedFile = file; downloadReport.disabled = true; if(translateFile) translateFile.disabled = true; lastReport = null; if(!lower.endsWith('.pptx') && !lower.endsWith('.docx') && !lower.endsWith('.pdf')){ fileList.innerHTML=`<div class="file-item"><span>${escapeHtml(file.name)}</span><span>Unsupported</span></div>`; demoStatusTitle.textContent='Unsupported file type'; demoStatusText.textContent='Please choose a PPTX, DOCX or PDF file for the FormatFlow tester.'; track('Tester Unsupported', {ext: lower.includes('.') ? lower.split('.').pop() : 'none'}); setProgress(0); return;} fileList.innerHTML=`<div class="file-item"><span>${escapeHtml(file.name)}</span><span>${lower.endsWith('.pptx')?'PPTX':lower.endsWith('.docx')?'DOCX':'PDF'} · ${readableSize(file.size)}</span></div>`; demoStatusTitle.textContent='File ready'; demoStatusText.textContent='Click Analyse File to inspect the document structure and text.'; setProgress(10); textPreview.textContent='Ready to analyse.'; });
runDemo.addEventListener('click', async ()=>{ try{ if(!selectedFile){ demoStatusTitle.textContent='Choose a file first'; demoStatusText.textContent='Upload a PPTX or DOCX file before running the tester.'; return;} const languages=selectedLanguages(); if(!languages.length){ demoStatusTitle.textContent='Choose at least one language'; demoStatusText.textContent='Select one or more target languages before analysing.'; return;} runDemo.disabled=true; downloadReport.disabled=true; setProgress(20); demoStatusTitle.textContent='Reading file locally'; const lower=selectedFile.name.toLowerCase(); let extracted; if(lower.endsWith('.pdf')){ demoStatusText.textContent='Opening the PDF in your browser.'; setProgress(40); demoStatusTitle.textContent='Extracting text and structure'; extracted = await extractPdf(selectedFile); } else { demoStatusText.textContent='Opening the Office document package in your browser.'; const JSZipLib = await loadJSZip(); const zip = await JSZipLib.loadAsync(selectedFile); setProgress(50); demoStatusTitle.textContent='Extracting text and structure'; extracted = lower.endsWith('.docx') ? await extractDocx(zip) : await extractPptx(zip); } setProgress(78); demoStatusTitle.textContent='Running QA checks'; const docType = document.getElementById('docType').value; const finalDocType = docType === 'Auto-detect' ? extracted.kind : docType; const checks = buildChecks({file:selectedFile, kind:extracted.kind, units:extracted.units, unitLabel:extracted.unitLabel, texts:extracted.texts, languages}); if(lower.endsWith('.pdf')){ if(extracted.pdfScanned && checks.words < 20){ checks.checks.push('⚠ Low text layer: this PDF may be scanned. OCR is not supported yet.'); } if(extracted.pdfTruncated){ checks.checks.push('⚠ Large PDF: this preview analysed the first 40 pages.'); } checks.checks.push('ℹ PDF translation is on the roadmap — this report covers analysis and QA only.'); } const outputs = makeOutputs(selectedFile.name, languages); const preview = extracted.texts.slice(0, 30).join('\n\n').slice(0, 4500); lastReport = {fileName:selectedFile.name,fileSize:readableSize(selectedFile.size),kind:extracted.kind,docType:finalDocType,units:extracted.units,unitLabel:extracted.unitLabel,words:checks.words,languages,outputs,checks:checks.checks,preview}; setProgress(100); demoStatusTitle.textContent='File analysis complete'; demoStatusText.textContent='FormatFlow has extracted text, checked structure and prepared a review report.'; renderAnalysis(lastReport); if(lower.endsWith('.pdf')){ translateResult.innerHTML = '<div class="privacy-note" style="margin-top:18px">FormatFlow Studio translates PPTX and DOCX today. <strong>PDF translate is the next format on the roadmap</strong> — Translate Preview below works on this PDF\'s text, and layout-preserving PDF export is coming. <a class="plausible-event-name=PDF+Early+Access" href="mailto:hello@formatflow.ai?subject=PDF translate early access" style="color:#bfffea;font-weight:800;text-decoration:underline">Request PDF early access</a>.</div>'; } track('Tester Analyse', {type: extracted.kind}); } catch(error){ console.error(error); demoStatusTitle.textContent='Analysis failed'; demoStatusText.textContent=error.message || 'The file could not be analysed in the browser.'; setProgress(0); } finally{ runDemo.disabled=false; } });
downloadReport.addEventListener('click',()=>{ if(lastReport){ downloadHtmlReport(lastReport); track('Report Download'); } });

function renderTranslations(data){
  const blocks = (data.translations || []).map(t => `<div class="result-card"><h4>${escapeHtml(t.language || 'Translation')}</h4><p>${escapeHtml(t.translatedPreview || '').slice(0,1200)}</p>${(t.notes && t.notes.length) ? `<div class="qa-list">${t.notes.map(n=>`<div>• ${escapeHtml(n)}</div>`).join('')}</div>` : ''}</div>`).join('');
  const checks = (data.qaChecks || []).map(c=>`<div>✓ ${escapeHtml(c)}</div>`).join('');
  translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">${escapeHtml(data.summary || 'Translation preview generated. Review before client use.')}</div><div class="result-grid" style="margin-top:14px">${blocks}</div>${checks ? `<div class="qa-list" style="margin-top:14px">${checks}</div>` : ''}`;
}

function showServiceError(res, data){
  if(res.status === 500 && /OPENAI_API_KEY/i.test(data.error || '')){
    translateResult.innerHTML = '<div class="privacy-note" style="margin-top:18px">Online translation is not enabled on this deployment yet. The full translation and export workflow lives in <strong>FormatFlow Studio</strong> for Windows — download it above to translate this file end to end.</div>';
  } else if(res.status === 429){
    translateResult.innerHTML = '<div class="privacy-note" style="margin-top:18px">You’ve hit the free translation limit. Please wait a few minutes and try again, or use the Windows app for unlimited translation.</div>';
  } else {
    translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">Translation failed: ${escapeHtml(data.error || ('HTTP '+res.status))}. You can still use the Windows app for full translation.</div>`;
  }
}

translatePreview.addEventListener('click', async ()=>{
  if(!lastReport || !lastReport.preview){ return; }
  translatePreview.disabled = true;
  const original = translatePreview.textContent;
  translatePreview.textContent = 'Translating…';
  translateResult.innerHTML = '<div class="privacy-note" style="margin-top:18px">Contacting the FormatFlow translation preview service…</div>';
  track('Translate Preview', {type: lastReport.kind});
  try{
    const res = await fetch(API_BASE + '/api/translate-demo', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        fileName: lastReport.fileName,
        documentType: lastReport.docType || lastReport.kind,
        toneNotes: document.getElementById('toneNotes').value,
        sourceText: lastReport.preview,
        targetLanguages: lastReport.languages
      })
    });
    const data = await res.json().catch(()=>({error:'Unexpected response from the server.'}));
    if(!res.ok){
      showServiceError(res, data);
    } else {
      renderTranslations(data);
    }
  }catch(err){
    translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">Could not reach the translation preview service: ${escapeHtml(err.message || 'network error')}.</div>`;
  }finally{
    translatePreview.textContent = original;
    translatePreview.disabled = false;
  }
});

// ---- Round-trip translation: translate the actual file in the browser and download it. ----
// The document is unzipped and rebuilt locally; only the extracted text segments
// are sent to the translation API, consistent with the local-first design.
async function collectTranslatableParts(zip, lower){
  const partNames = lower.endsWith('.docx') ? docxPartNames(zip) : pptxPartNames(zip);
  const parts = [];
  const segments = [];
  const skipped = [];
  for(const name of partNames){
    const xml = await zip.file(name).async('string');
    const map = [];
    xml.replace(RUN_RE, (match, open, tag, inner) => {
      const text = normaliseText(decodeXml(inner));
      if(!text){ map.push(-1); return match; }
      if(text.length > MAX_RT_SEGMENT_CHARS){ map.push(-1); skipped.push(text.slice(0, 60)); return match; }
      segments.push(text);
      map.push(segments.length - 1);
      return match;
    });
    parts.push({name, xml, map});
  }
  return {parts, segments, skipped};
}

function rebuildParts(zip, parts, translations){
  for(const part of parts){
    let runIndex = 0;
    const rebuilt = part.xml.replace(RUN_RE, (match, open, tag, inner, close) => {
      const segIndex = part.map[runIndex++];
      if(segIndex < 0) return match;
      const translated = translations[segIndex];
      if(typeof translated !== 'string' || !translated) return match;
      return open + encodeXml(translated) + close;
    });
    zip.file(part.name, rebuilt);
  }
}

function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

if(translateFile) translateFile.addEventListener('click', async ()=>{
  if(!selectedFile || !lastReport) return;
  const lower = selectedFile.name.toLowerCase();
  if(!lower.endsWith('.pptx') && !lower.endsWith('.docx')) return;
  const language = selectedLanguages()[0];
  if(!language){ demoStatusTitle.textContent='Choose at least one language'; demoStatusText.textContent='Select a target language before translating.'; return; }
  translateFile.disabled = true;
  const original = translateFile.textContent;
  translateFile.textContent = 'Translating file…';
  translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">Translating your file to <strong>${escapeHtml(language)}</strong>. The document is rebuilt in your browser — only the extracted text goes to the translation service.</div>`;
  track('Translate File', {type: lastReport.kind, language});
  try{
    const JSZipLib = await loadJSZip();
    const zip = await JSZipLib.loadAsync(selectedFile);
    const {parts, segments, skipped} = await collectTranslatableParts(zip, lower);
    if(!segments.length) throw new Error('No translatable text found in this file.');
    const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
    if(segments.length > MAX_RT_SEGMENTS || totalChars > MAX_RT_TOTAL_CHARS){
      translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">This file has <strong>${segments.length} text segments (${totalChars.toLocaleString()} characters)</strong> — beyond the free online limit of ${MAX_RT_SEGMENTS} segments / ${MAX_RT_TOTAL_CHARS.toLocaleString()} characters. <strong>FormatFlow Studio for Windows</strong> translates whole files and folders with no caps, under your own API key. <a href="#download" style="color:#ffd166;font-weight:900">Download it above</a>.</div>`;
      track('Translate File Over Cap', {segments: segments.length});
      return;
    }
    const res = await fetch(API_BASE + '/api/translate-file', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        fileName: selectedFile.name,
        documentType: lastReport.docType || lastReport.kind,
        toneNotes: document.getElementById('toneNotes').value,
        targetLanguage: language,
        segments
      })
    });
    const data = await res.json().catch(()=>({error:'Unexpected response from the server.'}));
    if(!res.ok){ showServiceError(res, data); return; }
    const translations = Array.isArray(data.translations) ? data.translations : [];
    if(translations.length !== segments.length) throw new Error('The translation service returned an incomplete result. Please try again.');
    rebuildParts(zip, parts, translations);
    const ext = lower.endsWith('.docx') ? 'docx' : 'pptx';
    const outName = `${selectedFile.name.replace(/\.(pptx|docx)$/i,'')}_${language.slice(0,2).toUpperCase()}.${ext}`;
    const blob = await zip.generateAsync({type:'blob', compression:'DEFLATE'});
    downloadBlob(blob, outName);
    const notes = (data.notes || []).map(n=>`<div>• ${escapeHtml(n)}</div>`).join('');
    const skippedNote = skipped.length ? `<div>• ${skipped.length} very long text segment${skipped.length===1?' was':'s were'} left in the source language — the Windows app handles these.</div>` : '';
    translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px"><strong>${escapeHtml(outName)}</strong> is downloading — ${segments.length} text segments translated to ${escapeHtml(language)} with the original layout kept. This beta translates run-by-run; check phrasing where one sentence spans several formatting runs. <strong>FormatFlow Studio</strong> adds glossaries, translation memory, overflow QA and whole-folder batches.</div>${(notes || skippedNote) ? `<div class="qa-list" style="margin-top:14px">${notes}${skippedNote}</div>` : ''}`;
    track('Translate File Done', {language, segments: segments.length});
  }catch(err){
    console.error(err);
    translateResult.innerHTML = `<div class="privacy-note" style="margin-top:18px">File translation failed: ${escapeHtml(err.message || 'unexpected error')}. You can still use the Windows app for full translation.</div>`;
  }finally{
    translateFile.textContent = original;
    translateFile.disabled = false;
  }
});

if('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(()=>{}); });
}
