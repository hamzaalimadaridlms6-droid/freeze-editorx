let recognizer=null, recognizerModel='', loading=null, stopped=false;
const send=(type,data={})=>postMessage({type,...data});
function sinc(x){if(Math.abs(x)<1e-8)return 1;const p=Math.PI*x;return Math.sin(p)/p;}
function downmixAndResample(channels,sourceRate){
  const length=channels[0]?.length||0;if(!length)throw new Error('Decoded audio contains no samples.');
  const mono=new Float32Array(length);let strongestChannel=null,strongestRms=0;
  for(const ch of channels){let energy=0;for(let i=0;i<length;i++){mono[i]+=ch[i]/channels.length;energy+=ch[i]*ch[i];}const rms=Math.sqrt(energy/length);if(rms>strongestRms){strongestRms=rms;strongestChannel=ch;}}
  // Opposite-polarity stereo can cancel almost completely in a simple average.
  // Preserve the stronger channel only when the mono sum is severely attenuated.
  let monoEnergy=0;for(let i=0;i<length;i++)monoEnergy+=mono[i]*mono[i];
  if(strongestChannel&&strongestRms>0&&Math.sqrt(monoEnergy/length)<strongestRms*.2)mono.set(strongestChannel);
  if(sourceRate===16000)return mono;
  const ratio=sourceRate/16000,outLength=Math.floor(length/ratio),out=new Float32Array(outLength);
  const cutoff=Math.min(1,16000/sourceRate)*0.94,radius=12;
  for(let i=0;i<outLength;i++){
    const center=i*ratio,base=Math.floor(center);let sum=0,weight=0;
    for(let k=-radius+1;k<=radius;k++){
      const ix=base+k;if(ix<0||ix>=length)continue;
      const d=(ix-center)*cutoff,win=0.5+0.5*Math.cos(Math.PI*(ix-center)/radius);
      if(Math.abs(ix-center)>radius)continue;
      const w=cutoff*sinc(d)*win;sum+=mono[ix]*w;weight+=w;
    }
    out[i]=weight?sum/weight:mono[Math.min(length-1,Math.max(0,Math.round(center)))];
  }
  return out;
}
function cleanBoundary(text){return String(text||'').replace(/\s+/g,' ').trim();}
function cueWords(text){return String(text||'').match(/[\p{L}\p{N}]+/gu)||[];}
function hasCompleteCueCoverage(text,cues){
  const expected=cueWords(text).map(w=>w.normalize('NFC').toLocaleLowerCase());
  const actual=(cues||[]).flatMap(cue=>cueWords(cue.text)).map(w=>w.normalize('NFC').toLocaleLowerCase());
  return expected.length>0&&expected.length===actual.length&&expected.every((word,index)=>word===actual[index]);
}

// Script conversion is a presentation step only. Recognition language is selected
// independently and is passed to Whisper; English output is never romanized.
const URDU_ROMAN={
'ا':'a','آ':'aa','أ':'a','إ':'i','ٱ':'a','ب':'b','پ':'p','ت':'t','ٹ':'t','ث':'th','ج':'j','چ':'ch','ح':'h','خ':'kh','د':'d','ڈ':'d','ذ':'z','ر':'r','ڑ':'r','ز':'z','ژ':'zh','س':'s','ش':'sh','ص':'s','ض':'z','ط':'t','ظ':'z','ع':'','غ':'gh','ف':'f','ق':'q','ک':'k','ك':'k','گ':'g','ل':'l','م':'m','ن':'n','ں':'n','و':'w','ؤ':'w','ه':'h','ہ':'h','ھ':'h','ة':'ah','ۃ':'h','ۀ':'h','ء':'','ئ':'y','ی':'i','ي':'i','ے':'ay','ى':'a','ٖ':'i','ۓ':'ay'
};
const DEV_ROMAN={'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri','ॠ':'rri','क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny','ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f','ं':'n','ँ':'n','ः':'h','्':'','ा':'a','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','़':'','ृ':'ri','।':'.','॥':'.','ऽ':''};
function romanizeText(text,language){
  const value=String(text||'');
  if(language==='english')return value;
  const map=language==='hindi'?DEV_ROMAN:(language==='urdu'||language==='arabic'?URDU_ROMAN:null);
  if(!map)return value;
  if(language==='hindi'){
    const chars=Array.from(value),consonants=new Set(Array.from('कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहक़ख़ग़ज़ड़ढ़फ़'));
    let out='';
    for(let i=0;i<chars.length;i++){
      const ch=chars[i],next=chars[i+1];
      if(consonants.has(ch)){
        out+=map[ch]??ch;
        if(next!=='्' && !(next&&'ािीुूृेैोौॅॉ'.includes(next)))out+='a';
      }else out+=map[ch]??ch;
    }
    return /[\u0900-\u097F]/u.test(out)?value:out;
  }
  const out=Array.from(value).map(ch=>{
    if(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/u.test(ch)||ch==='ـ')return '';
    const normalized=({'ٱ':'ا','أ':'ا','إ':'ا','آ':'ا'}[ch]||ch);
    return map[normalized]??ch;
  }).join('');
  return /[\u0621-\u064A\u066E-\u06D3\u0750-\u077F\u08A0-\u08FF]/u.test(out)?value:out;
}

function isTimestampCueWhollyInOverlap(start,end,overlapSeconds){
  return Number.isFinite(Number(start))&&Number.isFinite(Number(end))&&Number(start)>=0&&Number(end)>Number(start)&&Number(end)<=overlapSeconds;
}
function shouldDiscardOverlapCue(start,end,overlapSeconds,removedWords,cueWordCount,mergeOverlapWords){
  return isTimestampCueWhollyInOverlap(start,end,overlapSeconds)&&cueWordCount>0&&removedWords+cueWordCount<=mergeOverlapWords;
}
function countTimedOverlapWords(pieces,overlapSeconds,chunkText=''){
  const overlapTokens=[];
  for(const piece of Array.isArray(pieces)?pieces:[]){
    const ts=piece&& (piece.timestamp||piece.timestamps)||[],start=Number(ts[0]),end=Number(ts[1]);
    if(!isTimestampCueWhollyInOverlap(start,end,overlapSeconds))continue;
    overlapTokens.push(...cueWords(cleanBoundary(piece.text)));
  }
  if(!overlapTokens.length)return 0;
  const chunkTokens=cueWords(cleanBoundary(chunkText));
  if(overlapTokens.length>chunkTokens.length)return 0;
  for(let i=0;i<overlapTokens.length;i++){
    if(overlapTokens[i].normalize('NFC').toLocaleLowerCase()!==chunkTokens[i].normalize('NFC').toLocaleLowerCase())return 0;
  }
  return overlapTokens.length;
}
function mergeChunkText(previous,next,maxOverlapWords=0){
  const a=cleanBoundary(previous).split(' ').filter(Boolean),b=cleanBoundary(next).split(' ').filter(Boolean);
  let overlap=0;
  const limit=Math.max(0,Math.min(a.length,b.length,Math.floor(Number(maxOverlapWords)||0)));
  for(let n=limit;n>0;n--){
    if(a.slice(-n).map(w=>w.normalize('NFC')).join(' ').toLocaleLowerCase()===b.slice(0,n).map(w=>w.normalize('NFC')).join(' ').toLocaleLowerCase()){overlap=n;break;}
  }
  return {text:[...a,...b.slice(overlap)].join(' '),overlapWords:overlap};
}
function inspectChunkText(text){
  const words=String(text||'').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  let adjacentRepeatedWords=0,longestRepeatedWordRun=words.length?1:0,currentRun=words.length?1:0;
  for(let i=1;i<words.length;i++){
    if(words[i]===words[i-1]){adjacentRepeatedWords++;currentRun++;longestRepeatedWordRun=Math.max(longestRepeatedWordRun,currentRun);}
    else currentRun=1;
  }
  const trigrams=new Map();
  for(let i=0;i+2<words.length;i++){const phrase=words.slice(i,i+3).join(' ');trigrams.set(phrase,(trigrams.get(phrase)||0)+1);}
  let mostRepeatedTrigram='',mostRepeatedTrigramCount=0;
  for(const [phrase,count] of trigrams){if(count>mostRepeatedTrigramCount){mostRepeatedTrigram=phrase;mostRepeatedTrigramCount=count;}}
  return {wordCount:words.length,adjacentRepeatedWords,longestRepeatedWordRun,mostRepeatedTrigram,mostRepeatedTrigramCount};
}
function measureChunkAudio(samples){
  if(!samples||!samples.length)return {rms:0,peak:0};
  let squareSum=0,peak=0;
  for(let i=0;i<samples.length;i++){const v=samples[i],a=Math.abs(v);squareSum+=v*v;if(a>peak)peak=a;}
  return {rms:Number(Math.sqrt(squareSum/samples.length).toFixed(5)),peak:Number(peak.toFixed(5))};
}
function detectDegenerateOutput(text,stats,audioStats={}){
  const value=String(text||'');
  const words=value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  const repeatedWordLoop=words.length>=30&&stats.longestRepeatedWordRun>=24&&stats.longestRepeatedWordRun/words.length>=0.65;
  const repeatedCharacterLoop=/([\p{L}\p{M}])\1{24,}/u.test(value);
  const tinyTokenShare=words.filter(w=>Array.from(w).length<=2).length/Math.max(1,words.length),uniqueTinyTokens=new Set(words.filter(w=>Array.from(w).length<=2));
  const tinyTokenFlood=words.length>=30&&tinyTokenShare>=0.92&&(stats.adjacentRepeatedWords>=12||uniqueTinyTokens.size<=3);
  const oneCharacterShare=words.filter(w=>Array.from(w).length===1).length/Math.max(1,words.length);
  const shortCharacterNoise=words.length>=3&&words.length<=12&&oneCharacterShare>=0.5&&words.filter(w=>Array.from(w).length===1).length>=2;
  const nonSpeechLabel=/^[[(]\s*(?:music|arabic|singing in foreign language|background music)\s*[)\]]$/iu.test(value.trim())||/^\[music\]$/iu.test(value.trim());
  // A lone token from a long, clearly active chunk is usually an under-decode.
  // Do not apply this to quiet chunks, which may contain a brief isolated word.
  const underfilledActiveChunk=words.length>0&&words.length<=2&&Number(audioStats.durationSec)>=15&&Number(audioStats.rms)>=0.035;
  // Catch sustained phrase loops before they reach the captions. A single
  // refrain repeated a few times remains acceptable; the count, share and
  // output-length gates together target chunks dominated by one phrase.
  const trigramShare=stats.mostRepeatedTrigramCount/Math.max(1,words.length-2);
  const repeatedPhraseLoop=(words.length>=60&&stats.mostRepeatedTrigramCount>=12&&trigramShare>=0.12)||(words.length>=60&&stats.mostRepeatedTrigramCount>=8&&trigramShare>=0.10)||(words.length>=24&&stats.mostRepeatedTrigramCount>=8&&trigramShare>=0.25);
  return {suspected:repeatedWordLoop||repeatedCharacterLoop||tinyTokenFlood||shortCharacterNoise||nonSpeechLabel||underfilledActiveChunk||repeatedPhraseLoop,reasons:[repeatedWordLoop?'long repeated-word run':null,repeatedCharacterLoop?'long repeated-character run':null,tinyTokenFlood?'mostly one/two-character repeated tokens':null,shortCharacterNoise?'short output dominated by repeated one-character tokens':null,nonSpeechLabel?'non-speech music/language label':null,underfilledActiveChunk?'very short decode for a long active-audio chunk':null,repeatedPhraseLoop?`repeated multi-word phrase loop (${stats.mostRepeatedTrigramCount} occurrences; ${(trigramShare*100).toFixed(1)}% of trigrams)`:null].filter(Boolean)};
}

async function getRecognizer(modelId='Xenova/whisper-base'){
  if(recognizer&&recognizerModel===modelId)return recognizer;
  // Share an in-flight load, but do not retain a resolved promise forever:
  // the device profile may select a different model on a later job.
  if(loading){
    await loading;
    if(recognizer&&recognizerModel===modelId)return recognizer;
  }
  const loadPromise=(async()=>{
    const mod=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    mod.env.allowLocalModels=false;mod.env.useBrowserCache=true;
    const nextRecognizer=await mod.pipeline('automatic-speech-recognition',modelId,{quantized:true,device:'wasm',progress_callback:p=>{
      if(p&&p.status)send('model-progress',{status:p.status,progress:Number.isFinite(p.progress)?p.progress:null,file:p.file||''});
    }});
    recognizer=nextRecognizer;
    recognizerModel=modelId;
    return recognizer;
  })();
  loading=loadPromise;
  try{return await loadPromise;}
  finally{if(loading===loadPromise)loading=null;}
}

onmessage=async event=>{
  const msg=event.data||{};
  if(msg.type==='cancel'){stopped=true;return;}
  if(msg.type!=='transcribe')return;
  stopped=false;
  const failureState={stage:'starting',selectedLanguage:String(msg.language||'unspecified'),model:msg.model||'Xenova/whisper-base',duration:0,totalChunks:0,currentChunk:0,chunkDiagnostics:[],totalInferenceMs:0,totalMergedOverlapWords:0,rawWordCueCount:0};
  try{
    if(!Array.isArray(msg.channels)||!msg.channels.length)throw new Error('No decoded audio channels were received.');
    send('progress',{stage:'resample',percent:5,message:'Preparing mono 16 kHz audio…'});
    const channels=msg.channels.map(a=>new Float32Array(a));
    const audio=downmixAndResample(channels,msg.sampleRate);
    for(let i=0;i<channels.length;i++)channels[i]=null;
    if(!audio.length)throw new Error('Audio resampling produced no samples.');
    const sr=16000;failureState.duration=audio.length/sr;failureState.stage='model-loading';
    const asr=await getRecognizer(msg.model||'Xenova/whisper-base');if(stopped)return;
    const chunkSeconds=28,overlapSeconds=1,chunkSize=chunkSeconds*sr,step=(chunkSeconds-overlapSeconds)*sr;
    let mergedText='';const timed=[],rawTimed=[],allRawChunkTexts=[],chunkDiagnostics=[];let totalInferenceMs=0,totalMergedOverlapWords=0,emptyDecodeChunks=0,degenerateChunks=0,timestampFallbacks=0;const total=Math.ceil(audio.length/step);
    failureState.totalChunks=total;failureState.chunkDiagnostics=chunkDiagnostics;failureState.stage='transcribing';
    for(let index=0,start=0;start<audio.length;index++,start+=step){
      if(stopped){send('cancelled');return;}
      failureState.currentChunk=index+1;failureState.stage='chunk-inference';
      const end=Math.min(audio.length,start+chunkSize),chunk=audio.slice(start,end);
      send('progress',{stage:'chunk-start',percent:10+Math.round((index/total)*85),message:`Starting Whisper chunk ${index+1}/${total} at ${(start/sr).toFixed(1)}s…`,chunk:index+1,totalChunks:total});
      const languageAliases={urdu:'urdu',hindi:'hindi',arabic:'arabic',english:'english',ur:'urdu',hi:'hindi',ar:'arabic',en:'english'};
      const requestedLanguage=String(msg.language||'').trim().toLowerCase();
      if(!Object.prototype.hasOwnProperty.call(languageAliases,requestedLanguage)){
        throw new Error(`Unsupported language selection: ${requestedLanguage}. Choose Urdu, Hindi, Arabic or English.`);
      }
      const forcedLanguage=languageAliases[requestedLanguage];
      // Transformers.js 2.17.2 accepts generation kwargs directly in ASR options.
      // A token cap prevents pathological Whisper loops from consuming the full decoder limit.
      const MAX_NEW_TOKENS=192;
      const opts={sampling_rate:sr,return_timestamps:'word',task:'transcribe',max_new_tokens:MAX_NEW_TOKENS};
      if(forcedLanguage)opts.language=forcedLanguage;
      const audioStats={...measureChunkAudio(chunk),durationSec:chunk.length/sr};
      const inferenceStarted=performance.now();
      let result,usedTimestampFallback=false,timestampDecoderRetry=false,emptyDecodeError='';
      try{
        result=await asr(chunk,opts);
      }catch(firstError){
        const message=String(firstError&&firstError.message||firstError);
        if(forcedLanguage && /language|unsupported|invalid/i.test(message) && !/token_ids must be a non-empty array/i.test(message)){
          throw new Error(`Whisper could not use the selected ${forcedLanguage} language. Original error: ${message}`);
        }
        if(/token_ids must be a non-empty array of integers/i.test(message)){
          // Retry without word-level token timestamps. A no-speech/empty final segment
          // can fail inside the v2.17.2 word-timestamp decoder even when earlier chunks worked.
          try{
            timestampDecoderRetry=true;
            result=await asr(chunk,{...opts,return_timestamps:true});
          }catch(retryError){
            const retryMessage=String(retryError&&retryError.message||retryError);
            if(!/token_ids must be a non-empty array of integers/i.test(retryMessage))throw retryError;
            emptyDecodeError=retryMessage;
            result={text:'',chunks:[]};
            emptyDecodeChunks++;
          }
        }else{
          throw firstError;
        }
      }
      const inferenceMs=Math.round(performance.now()-inferenceStarted);totalInferenceMs+=inferenceMs;failureState.totalInferenceMs=totalInferenceMs;
      if(stopped){send('cancelled');return;}
      const chunkText=cleanBoundary(result&&result.text);
      if(!chunkText){
        if(!emptyDecodeError)emptyDecodeChunks++;
        emptyDecodeError=emptyDecodeError||'Whisper returned empty text for this chunk.';
      }
      allRawChunkTexts.push(chunkText);
      const quality=inspectChunkText(chunkText);
      const degeneration=detectDegenerateOutput(chunkText,quality,audioStats);
      const pieces=Array.isArray(result&&result.chunks)?result.chunks:[];
      const timedOverlapWords=index>0?countTimedOverlapWords(pieces,overlapSeconds,chunkText):0;
      // De-duplicate only words Whisper timestamped inside the actual shared
      // audio window. Without usable timestamps, preserve repeated poetry.
      const mergeResult=(!degeneration.suspected&&chunkText)?mergeChunkText(mergedText,chunkText,timedOverlapWords):{text:mergedText,overlapWords:0};
      if(!degeneration.suspected&&chunkText)mergedText=mergeResult.text;
      if(degeneration.suspected)degenerateChunks++;
      totalMergedOverlapWords+=mergeResult.overlapWords;
      const rawTimedCueCountBefore=rawTimed.length,timedCueCountBefore=timed.length;
      let overlapCueWordsRemoved=0;
      for(const piece of pieces){
        const ts=piece.timestamp||piece.timestamps||[],localStart=Number(ts[0]),localEnd=Number(ts[1]),pieceText=cleanBoundary(piece.text);
        if(!pieceText||!Number.isFinite(localStart)||!Number.isFinite(localEnd)||localEnd<=localStart)continue;
        // Only discard cues fully contained in the shared samples. A word
        // crossing the overlap boundary may extend beyond the previous chunk.
        // And only discard timestamped prefix words that text merging actually removed.
        const pieceWordCount=cueWords(pieceText).length;
        if(index>0&&shouldDiscardOverlapCue(localStart,localEnd,overlapSeconds,overlapCueWordsRemoved,pieceWordCount,mergeResult.overlapWords)){overlapCueWordsRemoved+=pieceWordCount;continue;}
        const globalStart=Math.max(0,start/sr+localStart),globalEnd=Math.min(audio.length/sr,start/sr+localEnd);
        if(globalEnd>globalStart){
          const cue={start:globalStart,end:globalEnd,text:pieceText,timingSource:timestampDecoderRetry?'segment':'whisper'};rawTimed.push(cue);
          if(!degeneration.suspected)timed.push(cue);
        }
      }
      let timestampFallbackReason='';
      const chunkTimed=timed.slice(timedCueCountBefore);
      const acceptedChunkText=chunkText.split(/\s+/u).filter(Boolean).slice(mergeResult.overlapWords).join(' ');
      const timestampCoverageComplete=hasCompleteCueCoverage(acceptedChunkText,chunkTimed);
      if(!degeneration.suspected&&chunkText&&!timestampCoverageComplete){
        // If even one accepted word lacks a usable model timestamp, replace this
        // chunk's partial timings with a clearly diagnosed estimated fallback.
        // This avoids silently dropping words from captions. Rejected chunks
        // never receive fallback cues.
        timed.splice(timedCueCountBefore);
        // Match the boundary de-duplication already applied to accepted text.
        const words=acceptedChunkText.split(/\s+/u).filter(Boolean);
        const fallbackStart=Math.min(end/sr,start/sr+(index>0?overlapSeconds:0));
        const fallbackEnd=end/sr;
        if(words.length&&fallbackEnd>fallbackStart){
          const weights=words.map(word=>Math.max(1,Array.from(word).length));
          const totalWeight=weights.reduce((sum,weight)=>sum+weight,0);
          let cursor=fallbackStart;
          words.forEach((word,wordIndex)=>{
            const cueEnd=wordIndex===words.length-1?fallbackEnd:cursor+(fallbackEnd-fallbackStart)*weights[wordIndex]/totalWeight;
            if(cueEnd>cursor)timed.push({start:cursor,end:cueEnd,text:word,timingSource:'estimated'});
            cursor=cueEnd;
          });
          usedTimestampFallback=true;
          timestampFallbackReason=chunkTimed.length?'estimated timing used because Whisper timestamps did not cover every accepted word':'estimated word timing used because this accepted chunk had no usable Whisper timestamps';
        }
      }
      if(usedTimestampFallback)timestampFallbacks++;
      chunkDiagnostics.push({
        chunk:index+1,startSec:Number((start/sr).toFixed(2)),endSec:Number((end/sr).toFixed(2)),
        rawText:chunkText.slice(0,3500),rawTextTruncated:chunkText.length>3500,
        wordCount:quality.wordCount,adjacentRepeatedWords:quality.adjacentRepeatedWords,
        longestRepeatedWordRun:quality.longestRepeatedWordRun,
        mostRepeatedTrigram:quality.mostRepeatedTrigram,mostRepeatedTrigramCount:quality.mostRepeatedTrigramCount,
        timedCueCount:rawTimed.length-rawTimedCueCountBefore,usableTimedCueCount:timed.length-timedCueCountBefore,
        mergeOverlapWordsRemoved:mergeResult.overlapWords,inferenceMs,audioRms:audioStats.rms,audioPeak:audioStats.peak,
        suspectedDegeneration:degeneration.suspected,degenerationReasons:degeneration.reasons,
        acceptedForTranscript:!degeneration.suspected&&!!chunkText,
        timestampFallback:usedTimestampFallback,timestampDecoderRetry,timestampFallbackReason,emptyDecode:!chunkText,
        errorMessage:emptyDecodeError
      });
      failureState.rawWordCueCount=rawTimed.length;failureState.totalMergedOverlapWords=totalMergedOverlapWords;failureState.stage='chunk-complete';
      send('progress',{stage:'transcribe',percent:10+Math.round(((index+1)/total)*85),message:`Completed Whisper chunk ${index+1}/${total} · ${(inferenceMs/1000).toFixed(1)}s inference`,chunk:index+1,totalChunks:total});
      await new Promise(r=>setTimeout(r,0));
    }
    if(stopped){send('cancelled');return;}
    failureState.stage='post-processing';
    const rawText=allRawChunkTexts.filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    const rawCaptions=rawTimed.map(c=>({...c}));
    let text=mergedText.replace(/\s+/g,' ').trim();
    let finalTimed=timed.map(c=>({...c}));
    if(msg.romanize){
      text=romanizeText(text,msg.language);
      finalTimed=timed.map(c=>({...c,text:romanizeText(c.text,msg.language)}));
    }else{
      text=String(text);
      finalTimed=timed.map(c=>({...c}));
    }
    const scriptEstimate=/[\u0900-\u097F]/u.test(rawText)?'Devanagari':/[\u0600-\u06FF\u0750-\u077F]/u.test(rawText)?'Arabic-script (Urdu/Arabic not distinguishable by script alone)':/[A-Za-z]/u.test(rawText)?'Latin':'Other/undetermined';
    const countWords=cues=>cues.reduce((sum,cue)=>sum+cueWords(cue.text).length,0);
    send('complete',{
      text,rawText,captions:finalTimed,rawCaptions,
      duration:audio.length/sr,chunkCount:total,selectedLanguage:String(msg.language||'unspecified'),
      romanize:!!msg.romanize,model:msg.model||'Xenova/whisper-base',scriptEstimate,
      rawWordCueCount:countWords(rawCaptions),processedWordCueCount:countWords(finalTimed),
      rawTimestampCueCount:rawCaptions.length,processedTimestampCueCount:finalTimed.length,
      whisperTimestampCueCount:finalTimed.filter(c=>c.timingSource==='whisper').length,
      segmentTimestampCueCount:finalTimed.filter(c=>c.timingSource==='segment').length,
      estimatedTimestampCueCount:finalTimed.filter(c=>c.timingSource==='estimated').length,
      chunkDiagnostics,totalInferenceMs,totalMergedOverlapWords,maxNewTokens:192,
      emptyDecodeChunks,degenerateChunks,timestampFallbacks,partial:emptyDecodeChunks>0||degenerateChunks>0
    });
  }catch(error){
    const partialChunks=Array.isArray(failureState.chunkDiagnostics)?failureState.chunkDiagnostics:[];
    const partialRawText=partialChunks.map(c=>String(c.rawText||'')).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    send('error',{
      message:error&&error.message?error.message:String(error),
      errorName:error&&error.name?String(error.name):'Error',
      errorStack:error&&error.stack?String(error.stack).slice(0,5000):'',
      diagnostics:{...failureState,completedChunks:partialChunks.length,partialRawText,chunkDiagnostics:partialChunks}
    });
  }
};
