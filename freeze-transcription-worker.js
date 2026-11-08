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

// Lightweight script romanizer for English-selected sessions. It converts detected
// Urdu/Arabic-script or Devanagari text to Latin script; it does not translate meaning.
const URDU_ROMAN={
'ا':'a','آ':'aa','أ':'a','إ':'i','ٱ':'a','ب':'b','پ':'p','ت':'t','ٹ':'t','ث':'th','ج':'j','چ':'ch','ح':'h','خ':'kh','د':'d','ڈ':'d','ذ':'z','ر':'r','ڑ':'r','ز':'z','ژ':'zh','س':'s','ش':'sh','ص':'s','ض':'z','ط':'t','ظ':'z','ع':'','غ':'gh','ف':'f','ق':'q','ک':'k','ك':'k','گ':'g','ل':'l','م':'m','ن':'n','ں':'n','و':'w','ؤ':'w','ه':'h','ہ':'h','ھ':'h','ة':'ah','ۃ':'h','ۀ':'h','ء':'','ئ':'y','ی':'i','ي':'i','ے':'ay','ى':'a','ٖ':'i','ۓ':'ay','ٹ':'t','ڑ':'r','ژ':'zh','چ':'ch','پ':'p'
};
const DEV_ROMAN={'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','क':'k','ख':'kh','ग':'g','घ':'gh','च':'ch','छ':'chh','ज':'j','झ':'jh','ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','ं':'n','ँ':'n','ः':'h','्':'','ा':'a','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','़':'','ृ':'ri'};
const COMMON_ROMAN={
'محبت':'mohabbat','نبی':'nabi','مصطفی':'mustafa','محمد':'muhammad','اللہ':'allah','رحمت':'rehmat','رحمة':'rahmat','نور':'noor','مدینہ':'madina','رسول':'rasool','اکرم':'akram','حضور':'huzoor','سلام':'salaam','علیکم':'alaikum','السلام':'assalaam','جان':'jaan','قربان':'qurban','دل':'dil','میرا':'mera','میری':'meri','تیرے':'tere','تیری':'teri','ہے':'hai','ہیں':'hain','کا':'ka','کی':'ki','کے':'ke','سے':'se','میں':'mein','کو':'ko','اور':'aur','یہ':'yeh','وہ':'woh','ہم':'hum','تم':'tum','خدا':'khuda','عشق':'ishq','عطا':'ata','کرم':' karam','نعت':'naat','قرآن':'quran','دنیا':'duniya','زندگی':'zindagi','پیار':'pyaar','علی':'ali','حسن':'hasan','حسین':'hussain','یا':'ya','رب':'rab','پاک':'paak','آقا':'aaka','نورانی':'noorani',
'الله':'allah','بسم':'bism','الرحمن':'ar-rahman','الرحمان':'ar-rahman','الرحيم':'ar-raheem','ان':'in','انا':'inna','اعطيناك':'a\'taynaaka','الكوثر':'al-kawthar','فصل':'fa-salli','لربك':'li-rabbika','وانحر':'wanhar','شانئك':'shani\'aka','هو':'huwa','الابتر':'al-abtar',
'नमस्ते':'namaste','दुनिया':'duniya','मेरा':'mera','मेरी':'meri','है':'hai','हैं':'hain','और':'aur','दिल':'dil','प्यार':'pyaar','प्रेम':'prem','भगवान':'bhagwan'
};
// Urdu orthography omits many short vowels. This small high-frequency lexicon
// improves common-word readability while leaving unknown words transliterated
// mechanically; it is not a substitute for a reviewed Roman Urdu dictionary.
const URDU_COMMON_ROMAN={
'کہ':'ke','ہوتا':'hota','ہوتی':'hoti','ہوتے':'hote','تھا':'tha','تھی':'thi','تھے':'the',
'رہا':'raha','رہی':'rahi','رہے':'rahe','دے':'de','نے':'ne','خیال':'khayal','خیالی':'khayali',
'میرے':'mere','میرا':'mera','میری':'meri','ایسا':'aisa','ایسے':'aise','ایسی':'aisi',
'نہیں':'nahin','بھی':'bhi','ہے':'hai','ہیں':'hain','ہوں':'hoon','ہو':'ho','کر':'kar',
'کیا':'kya','جو':'jo','ہر':'har','یہ':'yeh','وہ':'woh','آجائے':'aajaye','آئیں':'aayen',
'بات':'baat','بہت':'bohat','حضور':'huzoor','آقا':'aaka','رحمت':'rehmat','اللہ':'allah'
};
function romanizeText(text){
  const value=String(text||'');
  return value.split(/(\s+)/u).map(token=>{
    if(!token.trim())return token;
    const match=token.match(/^([^\p{L}\p{M}\p{N}]*)([\p{L}\p{M}\p{N}\p{M}]+)([^\p{L}\p{M}\p{N}]*)$/u);
    if(!match)return token;
    const [,leading,rawCore,trailing]=match;
    const core=rawCore.normalize('NFC');
    const lookup=core.replace(/\u0670/gu,'ا').replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/gu,'').replace(/[ٱأإآ]/gu,'ا').replace(/ـ/gu,'');
    if(URDU_COMMON_ROMAN[lookup]||COMMON_ROMAN[lookup])return leading+(URDU_COMMON_ROMAN[lookup]||COMMON_ROMAN[lookup]).trim()+trailing;
    let converted=core;
    if(/[\u0900-\u097F]/u.test(core)){
      converted=Array.from(core).map(ch=>DEV_ROMAN[ch]??ch).join('');
    }else if(/[\u0600-\u06FF\u0750-\u077F]/u.test(core)){
      converted=Array.from(lookup).map(ch=>URDU_ROMAN[ch]??ch).join('');
    }
    return leading+converted+trailing;
  }).join('');
}

// Freeze Editorx Islamic vocabulary correction layer.
// This is a curated phrase normalizer, not model fine-tuning.
const ISLAMIC_VOCAB_ALIASES = [
{"alias":"فتاویٰ رضویہ","ar":"فتاویٰ رضویہ","roman":"Fatawa-e-Razwiyah"},
{"alias":"Fatawa-e-Razwiyah","ar":"فتاویٰ رضویہ","roman":"Fatawa-e-Razwiyah"},
{"alias":"Fatawa razviya","ar":"فتاویٰ رضویہ","roman":"Fatawa-e-Razwiyah"},
{"alias":"امام احمد رضا","ar":"امام احمد رضا","roman":"Imam Ahmad Raza"},
{"alias":"Imam Ahmad Raza","ar":"امام احمد رضا","roman":"Imam Ahmad Raza"},
{"alias":"Ala Hazrat Imam Ahmad Raza","ar":"امام احمد رضا","roman":"Imam Ahmad Raza"},
{"alias":"مجددِ دین و ملت","ar":"مجددِ دین و ملت","roman":"Mujaddid-e-Deen-o-Millat"},
{"alias":"Mujaddid-e-Deen-o-Millat","ar":"مجددِ دین و ملت","roman":"Mujaddid-e-Deen-o-Millat"},
{"alias":"Mujaddide deen o millat","ar":"مجددِ دین و ملت","roman":"Mujaddid-e-Deen-o-Millat"},
{"alias":"تحقیقِ انیق","ar":"تحقیقِ انیق","roman":"Tahqeeq-e-Aneeq"},
{"alias":"Tahqeeq-e-Aneeq","ar":"تحقیقِ انیق","roman":"Tahqeeq-e-Aneeq"},
{"alias":"Tahqeeqe aneeq","ar":"تحقیقِ انیق","roman":"Tahqeeq-e-Aneeq"},
{"alias":"تدقیقِ جلیل","ar":"تدقیقِ جلیل","roman":"Tadqeeq-e-Jaleel"},
{"alias":"Tadqeeq-e-Jaleel","ar":"تدقیقِ جلیل","roman":"Tadqeeq-e-Jaleel"},
{"alias":"Tadqeeqe jaleel","ar":"تدقیقِ جلیل","roman":"Tadqeeq-e-Jaleel"},
{"alias":"استدلالِ قاطع","ar":"استدلالِ قاطع","roman":"Istidlal-e-Qati"},
{"alias":"Istidlal-e-Qati","ar":"استدلالِ قاطع","roman":"Istidlal-e-Qati"},
{"alias":"Istidlale qati","ar":"استدلالِ قاطع","roman":"Istidlal-e-Qati"},
{"alias":"قولِ مختار","ar":"قولِ مختار","roman":"Qawl-e-Mukhtar"},
{"alias":"Qawl-e-Mukhtar","ar":"قولِ مختار","roman":"Qawl-e-Mukhtar"},
{"alias":"Qawle mukhtar","ar":"قولِ مختار","roman":"Qawl-e-Mukhtar"},
{"alias":"راجح قول","ar":"راجح قول","roman":"Rajih Qawl"},
{"alias":"Rajih Qawl","ar":"راجح قول","roman":"Rajih Qawl"},
{"alias":"مرجوح روایت","ar":"مرجوح روایت","roman":"Marjoohat Riwayat"},
{"alias":"Marjoohat Riwayat","ar":"مرجوح روایت","roman":"Marjoohat Riwayat"},
{"alias":"Marjoh riwayat","ar":"مرجوح روایت","roman":"Marjoohat Riwayat"},
{"alias":"مفتیِ اعظم","ar":"مفتیِ اعظم","roman":"Mufti-e-Azam"},
{"alias":"Mufti-e-Azam","ar":"مفتیِ اعظم","roman":"Mufti-e-Azam"},
{"alias":"Muftie azam","ar":"مفتیِ اعظم","roman":"Mufti-e-Azam"},
{"alias":"فقاہت و درایت","ar":"فقاہت و درایت","roman":"Fiqahat-o-Dirayat"},
{"alias":"Fiqahat-o-Dirayat","ar":"فقاہت و درایت","roman":"Fiqahat-o-Dirayat"},
{"alias":"Fiqahat o dirayat","ar":"فقاہت و درایت","roman":"Fiqahat-o-Dirayat"},
{"alias":"اصولِ فقہ","ar":"اصولِ فقہ","roman":"Usool-e-Fiqh"},
{"alias":"Usool-e-Fiqh","ar":"اصولِ فقہ","roman":"Usool-e-Fiqh"},
{"alias":"Usoole fiqh","ar":"اصولِ فقہ","roman":"Usool-e-Fiqh"},
{"alias":"فروعی مسائل","ar":"فروعی مسائل","roman":"Furoo'i Masa'il"},
{"alias":"Furoo'i Masa'il","ar":"فروعی مسائل","roman":"Furoo'i Masa'il"},
{"alias":"Furooi masail","ar":"فروعی مسائل","roman":"Furoo'i Masa'il"},
{"alias":"قطعی الدلالہ","ar":"قطعی الدلالہ","roman":"Qat'i-ul-Dalalah"},
{"alias":"Qat'i-ul-Dalalah","ar":"قطعی الدلالہ","roman":"Qat'i-ul-Dalalah"},
{"alias":"Qatiul dalalah","ar":"قطعی الدلالہ","roman":"Qat'i-ul-Dalalah"},
{"alias":"ظنی الثبوت","ar":"ظنی الثبوت","roman":"Zanni-us-Suboot"},
{"alias":"Zanni-us-Suboot","roman":"Zanni-us-Suboot","ar":"ظنی الثبوت"},
{"alias":"Zannius suboot","ar":"ظنی الثبوت","roman":"Zanni-us-Suboot"},
{"alias":"اجماعِ امت","ar":"اجماعِ امت","roman":"Ijma-e-Ummat"},
{"alias":"Ijma-e-Ummat","ar":"اجماعِ امت","roman":"Ijma-e-Ummat"},
{"alias":"Ijmae ummat","ar":"اجماعِ امت","roman":"Ijma-e-Ummat"},
{"alias":"قیاسِ جلی","ar":"قیاسِ جلی","roman":"Qiyas-e-Jali"},
{"alias":"Qiyas-e-Jali","ar":"قیاسِ جلی","roman":"Qiyas-e-Jali"},
{"alias":"Qiyase jali","ar":"قیاسِ جلی","roman":"Qiyas-e-Jali"},
{"alias":"استحسان","ar":"استحسان","roman":"Istihsan"},
{"alias":"Istihsan","ar":"استحسان","roman":"Istihsan"},
{"alias":"Istihsaan","ar":"استحسان","roman":"Istihsan"},
{"alias":"عرفِ عام","ar":"عرفِ عام","roman":"Urf-e-Aam"},
{"alias":"Urf-e-Aam","ar":"عرفِ عام","roman":"Urf-e-Aam"},
{"alias":"Urfe aam","ar":"عرفِ عام","roman":"Urf-e-Aam"},
{"alias":"مضمراتِ فقہی","ar":"مضمراتِ فقہی","roman":"Mudamarat-e-Fiqhi"},
{"alias":"Mudamarat-e-Fiqhi","ar":"مضمراتِ فقہی","roman":"Mudamarat-e-Fiqhi"},
{"alias":"Mudamrate fiqhi","ar":"مضمراتِ فقہی","roman":"Mudamarat-e-Fiqhi"},
{"alias":"تنقیحِ مناط","ar":"تنقیحِ مناط","roman":"Tanqeh-e-Manat"},
{"alias":"Tanqeh-e-Manat","ar":"تنقیحِ مناط","roman":"Tanqeh-e-Manat"},
{"alias":"Tanqehe manat","ar":"تنقیحِ مناط","roman":"Tanqeh-e-Manat"},
{"alias":"تخریجِ احکام","ar":"تخریجِ احکام","roman":"Takhreej-e-Ahkam"},
{"alias":"Takhreej-e-Ahkam","ar":"تخریجِ احکام","roman":"Takhreej-e-Ahkam"},
{"alias":"Takhreeje ahkam","ar":"تخریجِ احکام","roman":"Takhreej-e-Ahkam"},
{"alias":"منصوص علیہ","ar":"منصوص علیہ","roman":"Mansoos 'Alayh"},
{"alias":"Mansoos 'Alayh","ar":"منصوص علیہ","roman":"Mansoos 'Alayh"},
{"alias":"Mansoos alayh","ar":"منصوص علیہ","roman":"Mansoos 'Alayh"},
{"alias":"مستنبط مسئلہ","ar":"مستنبط مسئلہ","roman":"Mustanbat Mas'ala"},
{"alias":"Mustanbat Mas'ala","ar":"مستنبط مسئلہ","roman":"Mustanbat Mas'ala"},
{"alias":"Mustanbat masala","ar":"مستنبط مسئلہ","roman":"Mustanbat Mas'ala"},
{"alias":"حکمِ شرعی","ar":"حکمِ شرعی","roman":"Hukm-e-Shari"},
{"alias":"Hukm-e-Shari","ar":"حکمِ شرعی","roman":"Hukm-e-Shari"},
{"alias":"Hukme shari","ar":"حکمِ شرعی","roman":"Hukm-e-Shari"},
{"alias":"مکروہِ تحریمی","ar":"مکروہِ تحریمی","roman":"Makrooh-e-Tahreemi"},
{"alias":"Makrooh-e-Tahreemi","ar":"مکروہِ تحریمی","roman":"Makrooh-e-Tahreemi"},
{"alias":"Makrooh tahreemi","ar":"مکروہِ تحریمی","roman":"Makrooh-e-Tahreemi"},
{"alias":"مکروہِ تنزیہی","ar":"مکروہِ تنزیہی","roman":"Makrooh-e-Tanzeeh"},
{"alias":"Makrooh-e-Tanzeeh","ar":"مکروہِ تنزیہی","roman":"Makrooh-e-Tanzeeh"},
{"alias":"Makrooh tanzeehi","ar":"مکروہِ تنزیہی","roman":"Makrooh-e-Tanzeeh"},
{"alias":"واجبِ عملی","ar":"واجبِ عملی","roman":"Wajib-e-Amali"},
{"alias":"Wajib-e-Amali","ar":"واجبِ عملی","roman":"Wajib-e-Amali"},
{"alias":"Wajibe amali","ar":"واجبِ عملی","roman":"Wajib-e-Amali"},
{"alias":"سنتِ مؤکدہ","ar":"سنتِ مؤکدہ","roman":"Sunnat-e-Mu'akkadah"},
{"alias":"Sunnat-e-Mu'akkadah","ar":"سنتِ مؤکدہ","roman":"Sunnat-e-Mu'akkadah"},
{"alias":"Sunnat-e-muakkada","ar":"سنتِ مؤکدہ","roman":"Sunnat-e-Mu'akkadah"},
{"alias":"مستحبِ عین","ar":"مستحبِ عین","roman":"Mustahabb-e-Ayn"},
{"alias":"Mustahabb-e-Ayn","ar":"مستحبِ عین","roman":"Mustahabb-e-Ayn"},
{"alias":"Mustahabbe ayn","ar":"مستحبِ عین","roman":"Mustahabb-e-Ayn"},
{"alias":"مباحِ محض","ar":"مباحِ محض","roman":"Mubah-e-Mahz"},
{"alias":"Mubah-e-Mahz","ar":"مباحِ محض","roman":"Mubah-e-Mahz"},
{"alias":"Mubahe mahz","ar":"مباحِ محض","roman":"Mubah-e-Mahz"},
{"alias":"حرامِ قطعی","ar":"حرامِ قطعی","roman":"Haram-e-Qati"},
{"alias":"Haram-e-Qati","ar":"حرامِ قطعی","roman":"Haram-e-Qati"},
{"alias":"Harame qati","ar":"حرامِ قطعی","roman":"Haram-e-Qati"},
{"alias":"شبهہ ناک","ar":"شبهہ ناک","roman":"Shubha-Naak"},
{"alias":"Shubha-Naak","ar":"شبهہ ناک","roman":"Shubha-Naak"},
{"alias":"Shubhanak","ar":"شبهہ ناک","roman":"Shubha-Naak"},
{"alias":"ورع و تقویٰ","ar":"ورع و تقویٰ","roman":"Wara'-o-Taqwa"},
{"alias":"Wara'-o-Taqwa","ar":"ورع و تقویٰ","roman":"Wara'-o-Taqwa"},
{"alias":"Wara o taqwa","ar":"ورع و تقویٰ","roman":"Wara'-o-Taqwa"},
{"alias":"احتیاطِ تام","ar":"احتیاطِ تام","roman":"Ehtiyat-e-Taam"},
{"alias":"Ehtiyat-e-Taam","ar":"احتیاطِ تام","roman":"Ehtiyat-e-Taam"},
{"alias":"Ehtiyate taam","ar":"احتیاطِ تام","roman":"Ehtiyat-e-Taam"},
{"alias":"فتوٰی نویسی","ar":"فتوٰی نویسی","roman":"Fatwa-Nawisi"},
{"alias":"Fatwa-Nawisi","ar":"فتوٰی نویسی","roman":"Fatwa-Nawisi"},
{"alias":"Fatwanawisi","ar":"فتوٰی نویسی","roman":"Fatwa-Nawisi"},
{"alias":"مستفتی","ar":"مستفتی","roman":"Mustafti"},
{"alias":"Mustafti","ar":"مستفتی","roman":"Mustafti"},
{"alias":"Mustaftee","ar":"مستفتی","roman":"Mustafti"},
{"alias":"مجيب","ar":"مجيب","roman":"Mujeeb"},
{"alias":"Mujeeb","ar":"مجيب","roman":"Mujeeb"},
{"alias":"Al-Mujeeb","ar":"مجيب","roman":"Mujeeb"},
{"alias":"حاشیہ آرائی","ar":"حاشیہ آرائی","roman":"Hashiya-Arai"},
{"alias":"Hashiya-Arai","ar":"حاشیہ آرائی","roman":"Hashiya-Arai"},
{"alias":"Hashiya arai","ar":"حاشیہ آرائی","roman":"Hashiya-Arai"},
{"alias":"تشریحِ عبارات","ar":"تشریحِ عبارات","roman":"Tashreeh-e-Ibarat"},
{"alias":"Tashreeh-e-Ibarat","ar":"تشریحِ عبارات","roman":"Tashreeh-e-Ibarat"},
{"alias":"Tashreehe ibarat","ar":"تشریحِ عبارات","roman":"Tashreeh-e-Ibarat"},
{"alias":"متنِ کتاب","ar":"متنِ کتاب","roman":"Matn-e-Kitab"},
{"alias":"Matn-e-Kitab","ar":"متنِ کتاب","roman":"Matn-e-Kitab"},
{"alias":"Matne kitab","ar":"متنِ کتاب","roman":"Matn-e-Kitab"},
{"alias":"شرحِ مبسوط","ar":"شرحِ مبسوط","roman":"Sharh-e-Mabsoot"},
{"alias":"Sharh-e-Mabsoot","ar":"شرحِ مبسوط","roman":"Sharh-e-Mabsoot"},
{"alias":"Sharhe mabsoot","ar":"شرحِ مبسوط","roman":"Sharh-e-Mabsoot"},
{"alias":"حواشیِ مطبوعہ","ar":"حواشیِ مطبوعہ","roman":"Hawashi-e-Matboo'ah"},
{"alias":"Hawashi-e-Matboo'ah","ar":"حواشیِ مطبوعہ","roman":"Hawashi-e-Matboo'ah"},
{"alias":"Hawashi matbooa","ar":"حواشیِ مطبوعہ","roman":"Hawashi-e-Matboo'ah"},
{"alias":"سندِ حدیث","ar":"سندِ حدیث","roman":"Sanad-e-Hadith"},
{"alias":"Sanad-e-Hadith","ar":"سندِ حدیث","roman":"Sanad-e-Hadith"},
{"alias":"Sanade hadith","ar":"سندِ حدیث","roman":"Sanad-e-Hadith"},
{"alias":"متنِ حدیث","ar":"متنِ حدیث","roman":"Matn-e-Hadith"},
{"alias":"Matn-e-Hadith","ar":"متنِ حدیث","roman":"Matn-e-Hadith"},
{"alias":"Matne hadith","ar":"متنِ حدیث","roman":"Matn-e-Hadith"},
{"alias":"صحیح و سقیم","ar":"صحیح و سقیم","roman":"Sahih-o-Saqeem"},
{"alias":"Sahih-o-Saqeem","ar":"صحیح و سقیم","roman":"Sahih-o-Saqeem"},
{"alias":"Sahih o saqeem","ar":"صحیح و سقیم","roman":"Sahih-o-Saqeem"},
{"alias":"جرح و تعدیل","ar":"جرح و تعدیل","roman":"Jarh-o-Ta'deel"},
{"alias":"Jarh-o-Ta'deel","ar":"جرح و تعدیل","roman":"Jarh-o-Ta'deel"},
{"alias":"Jarh o tadeel","ar":"جرح و تعدیل","roman":"Jarh-o-Ta'deel"},
{"alias":"مرسل روایت","ar":"مرسل روایت","roman":"Mursal Riwayat"},
{"alias":"Mursal Riwayat","ar":"مرسل روایت","roman":"Mursal Riwayat"},
{"alias":"Mursal riwayath","ar":"مرسل روایت","roman":"Mursal Riwayat"},
{"alias":"منقطع اثر","ar":"منقطع اثر","roman":"Munqati Asar"},
{"alias":"Munqati Asar","ar":"منقطع اثر","roman":"Munqati Asar"},
{"alias":"شاذ روایت","ar":"شاذ روایت","roman":"Shaz Riwayat"},
{"alias":"Shaz Riwayat","ar":"شاذ روایت","roman":"Shaz Riwayat"},
{"alias":"Shaz riwayath","ar":"شاذ روایت","roman":"Shaz Riwayat"},
{"alias":"موضوع روایت","ar":"موضوع روایت","roman":"Muzoo' Riwayat"},
{"alias":"Muzoo' Riwayat","ar":"موضوع روایت","roman":"Muzoo' Riwayat"},
{"alias":"Muzoo riwayath","ar":"موضوع روایت","roman":"Muzoo' Riwayat"},
{"alias":"حسنِ درجۃ","ar":"حسنِ درجۃ","roman":"Hasan-ud-Darajah"},
{"alias":"Hasan-ud-Darajah","ar":"حسنِ درجۃ","roman":"Hasan-ud-Darajah"},
{"alias":"Hasand darajah","ar":"حسنِ درجۃ","roman":"Hasan-ud-Darajah"},
{"alias":"متواتر خبر","ar":"متواتر خبر","roman":"Mutawatir Khabar"},
{"alias":"Mutawatir Khabar","ar":"متواتر خبر","roman":"Mutawatir Khabar"},
{"alias":"آحاد روایت","ar":"آحاد روایت","roman":"Ahad Riwayat"},
{"alias":"Ahad Riwayat","ar":"آحاد روایت","roman":"Ahad Riwayat"},
{"alias":"Ahad riwayath","ar":"آحاد روایت","roman":"Ahad Riwayat"},
{"alias":"ناسخ و منسوخ","ar":"ناسخ و منسوخ","roman":"Nasikh-o-Mansookh"},
{"alias":"Nasikh-o-Mansookh","ar":"ناسخ و منسوخ","roman":"Nasikh-o-Mansookh"},
{"alias":"Nasikh o mansookh","ar":"ناسخ و منسوخ","roman":"Nasikh-o-Mansookh"},
{"alias":"عام و خاص","ar":"عام و خاص","roman":"Aam-o-Khas"},
{"alias":"Aam-o-Khas","ar":"عام و خاص","roman":"Aam-o-Khas"},
{"alias":"Aam o khas","ar":"عام و خاص","roman":"Aam-o-Khas"},
{"alias":"مطلق و مقید","ar":"مطلق و مقید","roman":"Mutlaq-o-Muqayyad"},
{"alias":"Mutlaq-o-Muqayyad","ar":"مطلق و مقید","roman":"Mutlaq-o-Muqayyad"},
{"alias":"Mutlaq o muqayyad","ar":"مطلق و مقید","roman":"Mutlaq-o-Muqayyad"},
{"alias":"مجمل و مبین","ar":"مجمل و مبین","roman":"Mujmal-o-Mubeen"},
{"alias":"Mujmal-o-Mubeen","ar":"مجمل و مبین","roman":"Mujmal-o-Mubeen"},
{"alias":"Mujmal o mubeen","ar":"مجمل و مبین","roman":"Mujmal-o-Mubeen"},
{"alias":"ظاہر و نص","ar":"ظاہر و نص","roman":"Zahir-o-Nas"},
{"alias":"Zahir-o-Nas","ar":"ظاہر و نص","roman":"Zahir-o-Nas"},
{"alias":"Zahir o nas","ar":"ظاہر و نص","roman":"Zahir-o-Nas"},
{"alias":"مفسر و محکم","ar":"مفسر و محکم","roman":"Mufassar-o-Muhkam"},
{"alias":"Mufassar-o-Muhkam","ar":"مفسر و محکم","roman":"Mufassar-o-Muhkam"},
{"alias":"Mufassar o muhkam","ar":"مفسر و محکم","roman":"Mufassar-o-Muhkam"},
{"alias":"خفی و مشکل","ar":"خفی و مشکل","roman":"Khafi-o-Mushkil"},
{"alias":"Khafi-o-Mushkil","ar":"خفی و مشکل","roman":"Khafi-o-Mushkil"},
{"alias":"Khafi o mushkil","ar":"خفی و مشکل","roman":"Khafi-o-Mushkil"},
{"alias":"مجمل و متشابہ","ar":"مجمل و متشابہ","roman":"Mujmal-o-Mutashabih"},
{"alias":"Mujmal-o-Mutashabih","ar":"مجمل و متشابہ","roman":"Mujmal-o-Mutashabih"},
{"alias":"Mujmal o mutashabih","ar":"مجمل و متشابہ","roman":"Mujmal-o-Mutashabih"},
{"alias":"عبارت النص","ar":"عبارت النص","roman":"Ibarat-un-Nas"},
{"alias":"Ibarat-un-Nas","ar":"عبارت النص","roman":"Ibarat-un-Nas"},
{"alias":"Ibaratun nas","ar":"عبارت النص","roman":"Ibarat-un-Nas"},
{"alias":"دلالۃ النص","ar":"دلالۃ النص","roman":"Dalalat-un-Nas"},
{"alias":"Dalalat-un-Nas","ar":"دلالۃ النص","roman":"Dalalat-un-Nas"},
{"alias":"Dalalatun nas","ar":"دلالۃ النص","roman":"Dalalat-un-Nas"},
{"alias":"إشارۃ النص","ar":"إشارۃ النص","roman":"Isharat-un-Nas"},
{"alias":"Isharat-un-Nas","ar":"إشارۃ النص","roman":"Isharat-un-Nas"},
{"alias":"Isharatun nas","ar":"إشارۃ النص","roman":"Isharat-un-Nas"},
{"alias":"اقتضآء النص","ar":"اقتضآء النص","roman":"Iqtida-un-Nas"},
{"alias":"Iqtida-un-Nas","ar":"اقتضآء النص","roman":"Iqtida-un-Nas"},
{"alias":"Iqtidaun nas","ar":"اقتضآء النص","roman":"Iqtida-un-Nas"},
{"alias":"دلالتِ التزام","ar":"دلالتِ التزام","roman":"Dalalat-e-Iltizam"},
{"alias":"Dalalat-e-Iltizam","ar":"دلالتِ التزام","roman":"Dalalat-e-Iltizam"},
{"alias":"Dalalate iltizam","ar":"دلالتِ التزام","roman":"Dalalat-e-Iltizam"},
{"alias":"معانیِ مفردات","ar":"معانیِ مفردات","roman":"Ma'ani-e-Mufradat"},
{"alias":"Ma'ani-e-Mufradat","ar":"معانیِ مفردات","roman":"Ma'ani-e-Mufradat"},
{"alias":"Maanie mufradat","ar":"معانیِ مفردات","roman":"Ma'ani-e-Mufradat"},
{"alias":"اشتقاقِ لغوی","ar":"اشتقاقِ لغوی","roman":"Ishtiqaq-e-Lughawi"},
{"alias":"Ishtiqaq-e-Lughawi","ar":"اشتقاقِ لغوی","roman":"Ishtiqaq-e-Lughawi"},
{"alias":"Ishtiqaqe lughawi","ar":"اشتقاقِ لغوی","roman":"Ishtiqaq-e-Lughawi"},
{"alias":"صرفی تحقیق","ar":"صرفی تحقیق","roman":"Sarf-e-Tahqeeq"},
{"alias":"Sarf-e-Tahqeeq","ar":"صرفی تحقیق","roman":"Sarf-e-Tahqeeq"},
{"alias":"Sarfe tahqeeq","ar":"صرفی تحقیق","roman":"Sarf-e-Tahqeeq"},
{"alias":"نحوی ترکیب","ar":"نحوی ترکیب","roman":"Nahwi Tarkeeb"},
{"alias":"Nahwi Tarkeeb","ar":"نحوی ترکیب","roman":"Nahwi Tarkeeb"},
{"alias":"بلاغتِ کلام","ar":"بلاغتِ کلام","roman":"Balaghat-e-Kalam"},
{"alias":"Balaghat-e-Kalam","ar":"بلاغتِ کلام","roman":"Balaghat-e-Kalam"},
{"alias":"Balaghate kalam","ar":"بلاغتِ کلام","roman":"Balaghat-e-Kalam"},
{"alias":"فصاحتِ بیان","ar":"فصاحتِ بیان","roman":"Fasahat-e-Bayan"},
{"alias":"Fasahat-e-Bayan","ar":"فصاحتِ بیان","roman":"Fasahat-e-Bayan"},
{"alias":"Fasahate bayan","ar":"فصاحتِ بیان","roman":"Fasahat-e-Bayan"},
{"alias":"محاوراتِ عرب","ar":"محاوراتِ عرب","roman":"Muhawarat-e-Arab"},
{"alias":"Muhawarat-e-Arab","ar":"محاوراتِ عرب","roman":"Muhawarat-e-Arab"},
{"alias":"Muhawarate arab","ar":"محاوراتِ عرب","roman":"Muhawarat-e-Arab"},
{"alias":"بلاغی نکات","ar":"بلاغی نکات","roman":"Balaghi Nukat"},
{"alias":"Balaghi Nukat","ar":"بلاغی نکات","roman":"Balaghi Nukat"},
{"alias":"بدیع و بیان","ar":"بدیع و بیان","roman":"Badi'-o-Bayan"},
{"alias":"Badi'-o-Bayan","ar":"بدیع و بیان","roman":"Badi'-o-Bayan"},
{"alias":"Badi o bayan","ar":"بدیع و بیان","roman":"Badi'-o-Bayan"},
{"alias":"علمِ معانی","ar":"علمِ معانی","roman":"Ilm-e-Ma'ani"},
{"alias":"Ilm-e-Ma'ani","ar":"علمِ معانی","roman":"Ilm-e-Ma'ani"},
{"alias":"Ilme maani","ar":"علمِ معانی","roman":"Ilm-e-Ma'ani"},
{"alias":"علمِ عروض","ar":"علمِ عروض","roman":"Ilm-e-Arooz"},
{"alias":"Ilm-e-Arooz","ar":"علمِ عروض","roman":"Ilm-e-Arooz"},
{"alias":"Ilme arooz","ar":"علمِ عروض","roman":"Ilm-e-Arooz"},
{"alias":"علمِ قوافی","ar":"علمِ قوافی","roman":"Ilm-e-Qawafi"},
{"alias":"Ilm-e-Qawafi","ar":"علمِ قوافی","roman":"Ilm-e-Qawafi"},
{"alias":"Ilme qawafi","ar":"علمِ قوافی","roman":"Ilm-e-Qawafi"},
{"alias":"لطائفِ ادبی","ar":"لطائفِ ادبی","roman":"Lataif-e-Adabi"},
{"alias":"Lataif-e-Adabi","ar":"لطائفِ ادبی","roman":"Lataif-e-Adabi"},
{"alias":"Lataife adabi","ar":"لطائفِ ادبی","roman":"Lataif-e-Adabi"},
{"alias":"طرزِ استدلال","ar":"طرزِ استدلال","roman":"Tarz-e-Istidlal"},
{"alias":"Tarz-e-Istidlal","ar":"طرزِ استدلال","roman":"Tarz-e-Istidlal"},
{"alias":"Tarze istidlal","ar":"طرزِ استدلال","roman":"Tarz-e-Istidlal"},
{"alias":"منہجِ محققین","ar":"منہجِ محققین","roman":"Manhaj-e-Muhaqqiqeen"},
{"alias":"Manhaj-e-Muhaqqiqeen","ar":"منہجِ محققین","roman":"Manhaj-e-Muhaqqiqeen"},
{"alias":"Manhaje muhaqqiqeen","ar":"منہجِ محققین","roman":"Manhaj-e-Muhaqqiqeen"},
{"alias":"مسلکِ احناف","ar":"مسلکِ احناف","roman":"Maslak-e-Ahnaaf"},
{"alias":"Maslak-e-Ahnaaf","ar":"مسلکِ احناف","roman":"Maslak-e-Ahnaaf"},
{"alias":"Maslake ahnaaf","ar":"مسلکِ احناف","roman":"Maslak-e-Ahnaaf"},
{"alias":"مذہبِ حنفی","ar":"مذہبِ حنفی","roman":"Mazhab-e-Hanafi"},
{"alias":"Mazhab-e-Hanafi","ar":"مذہبِ حنفی","roman":"Mazhab-e-Hanafi"},
{"alias":"Mazhabe hanafi","ar":"مذہبِ حنفی","roman":"Mazhab-e-Hanafi"},
{"alias":"امامِ اعظم","ar":"امامِ اعظم","roman":"Imam-e-Azam"},
{"alias":"Imam-e-Azam","ar":"امامِ اعظم","roman":"Imam-e-Azam"},
{"alias":"Imame azam","ar":"امامِ اعظم","roman":"Imam-e-Azam"},
{"alias":"صاحبین","ar":"صاحبین","roman":"Sahibain"},
{"alias":"Sahibain","ar":"صاحبین","roman":"Sahibain"},
{"alias":"Sahibayn","ar":"صاحبین","roman":"Sahibain"},
{"alias":"امامِ محمد","ar":"امامِ محمد","roman":"Imam Muhammad"},
{"alias":"Imam Muhammad","ar":"امامِ محمد","roman":"Imam Muhammad"},
{"alias":"Imam Muhammad al-Shaybani","ar":"امامِ محمد","roman":"Imam Muhammad"},
{"alias":"امامِ ابو یوسف","ar":"امامِ ابو یوسف","roman":"Imam Abu Yusuf"},
{"alias":"Imam Abu Yusuf","ar":"امامِ ابو یوسف","roman":"Imam Abu Yusuf"},
{"alias":"Qadi Abu Yusuf","ar":"امامِ ابو یوسف","roman":"Imam Abu Yusuf"},
{"alias":"زفر بن ہذیل","ar":"زفر بن ہذیل","roman":"Zufar ibn Huzayl"},
{"alias":"Zufar ibn Huzayl","ar":"زفر بن ہذیل","roman":"Zufar ibn Huzayl"},
{"alias":"Imam Zufar","ar":"زفر بن ہذیل","roman":"Zufar ibn Huzayl"},
{"alias":"حسن بن زياد","ar":"حسن بن زياد","roman":"Hasan ibn Ziyad"},
{"alias":"Hasan ibn Ziyad","ar":"حسن بن زياد","roman":"Hasan ibn Ziyad"},
{"alias":"Hasan ibn Ziyad al-Lu'lu'i","ar":"حسن بن زياد","roman":"Hasan ibn Ziyad"},
{"alias":"متونِ اربعہ","ar":"متونِ اربعہ","roman":"Mutoon-e-Arba'ah"},
{"alias":"Mutoon-e-Arba'ah","ar":"متونِ اربعہ","roman":"Mutoon-e-Arba'ah"},
{"alias":"Mutoone arbaah","ar":"متونِ اربعہ","roman":"Mutoon-e-Arba'ah"},
{"alias":"ہدایہ شریف","ar":"ہدایہ شریف","roman":"Hidayah Shareef"},
{"alias":"Hidayah Shareef","ar":"ہدایہ شریف","roman":"Hidayah Shareef"},
{"alias":"Al-Hidayah","ar":"ہدایہ شریف","roman":"Hidayah Shareef"},
{"alias":"تنوير الأبصار","ar":"تنوير الأبصار","roman":"Tanwir-ul-Absar"},
{"alias":"Tanwir-ul-Absar","ar":"تنوير الأبصار","roman":"Tanwir-ul-Absar"},
{"alias":"Tanwirul absar","ar":"تنوير الأبصار","roman":"Tanwir-ul-Absar"},
{"alias":"در مختار","ar":"در مختار","roman":"Durr-ul-Mukhtar"},
{"alias":"Durr-ul-Mukhtar","ar":"در مختار","roman":"Durr-ul-Mukhtar"},
{"alias":"Durrul mukhtar","ar":"در مختار","roman":"Durr-ul-Mukhtar"},
{"alias":"رد المحتار","ar":"رد المحتار","roman":"Radd-ul-Muhtar"},
{"alias":"Radd-ul-Muhtar","ar":"رد المحتار","roman":"Radd-ul-Muhtar"},
{"alias":"Raddul muhtar","ar":"رد المحتار","roman":"Radd-ul-Muhtar"},
{"alias":"علامہ شامی","ar":"علامہ شامی","roman":"Allama Shami"},
{"alias":"Allama Shami","ar":"علامہ شامی","roman":"Allama Shami"},
{"alias":"Ibn Abidin al-Shami","ar":"علامہ شامی","roman":"Allama Shami"},
{"alias":"فتح القدیر","ar":"فتح القدیر","roman":"Fath-ul-Qadeer"},
{"alias":"Fath-ul-Qadeer","ar":"فتح القدیر","roman":"Fath-ul-Qadeer"},
{"alias":"Fathul qadeer","ar":"فتح القدیر","roman":"Fath-ul-Qadeer"},
{"alias":"بحر الرائق","ar":"بحر الرائق","roman":"Bahr-ul-Raiq"},
{"alias":"Bahr-ul-Raiq","ar":"بحر الرائق","roman":"Bahr-ul-Raiq"},
{"alias":"Bahrul raiq","ar":"بحر الرائق","roman":"Bahr-ul-Raiq"},
{"alias":"تبیین الحقائق","ar":"تبیین الحقائق","roman":"Tabyin-ul-Haqaiq"},
{"alias":"Tabyin-ul-Haqaiq","ar":"تبیین الحقائق","roman":"Tabyin-ul-Haqaiq"},
{"alias":"Tabyinul haqaiq","ar":"تبیین الحقائق","roman":"Tabyin-ul-Haqaiq"},
{"alias":"محیطِ سرسری","ar":"محیطِ سرسری","roman":"Muheet-e-Sarakhsi"},
{"alias":"Muheet-e-Sarakhsi","ar":"محیطِ سرسری","roman":"Muheet-e-Sarakhsi"},
{"alias":"Muheete sarakhsi","ar":"محیطِ سرسری","roman":"Muheet-e-Sarakhsi"},
{"alias":"فتاویٰ قاضی خان","ar":"فتاویٰ قاضی خان","roman":"Fatawa Qazi Khan"},
{"alias":"Fatawa Qazi Khan","ar":"فتاویٰ قاضی خان","roman":"Fatawa Qazi Khan"},
{"alias":"Fatawa qazikhan","ar":"فتاویٰ قاضی خان","roman":"Fatawa Qazi Khan"},
{"alias":"فتاویٰ ہندیہ","ar":"فتاویٰ ہندیہ","roman":"Fatawa Hindiyyah"},
{"alias":"Fatawa Hindiyyah","ar":"فتاویٰ ہندیہ","roman":"Fatawa Hindiyyah"},
{"alias":"Fatawa alamgiri","ar":"فتاویٰ ہندیہ","roman":"Fatawa Hindiyyah"},
{"alias":"تاتارخانیہ","ar":"تاتارخانیہ","roman":"Tatarkhaniyyah"},
{"alias":"Tatarkhaniyyah","ar":"تاتارخانیہ","roman":"Tatarkhaniyyah"},
{"alias":"Fatawa tatarkhani","ar":"تاتارخانیہ","roman":"Tatarkhaniyyah"},
{"alias":"بدائع الصنائع","ar":"بدائع الصنائع","roman":"Bada'i-us-Sana'i"},
{"alias":"Bada'i-us-Sana'i","ar":"بدائع الصنائع","roman":"Bada'i-us-Sana'i"},
{"alias":"Badaius sanaic","ar":"بدائع الصنائع","roman":"Bada'i-us-Sana'i"},
{"alias":"المبسوط للسرخسی","ar":"المبسوط للسرخسی","roman":"Al-Mabsoot lil-Sarakhsi"},
{"alias":"Al-Mabsoot lil-Sarakhsi","ar":"المبسوط للسرخسی","roman":"Al-Mabsoot lil-Sarakhsi"},
{"alias":"Mabsoot sarakhsi","ar":"المبسوط للسرخسی","roman":"Al-Mabsoot lil-Sarakhsi"},
{"alias":"کتاب الاصل","ar":"کتاب الاصل","roman":"Kitab-ul-Asl"},
{"alias":"Kitab-ul-Asl","ar":"کتاب الاصل","roman":"Kitab-ul-Asl"},
{"alias":"Kitabul asl","ar":"کتاب الاصل","roman":"Kitab-ul-Asl"},
{"alias":"جامع الصغير","ar":"جامع الصغير","roman":"Al-Jami'-us-Sagheer"},
{"alias":"Al-Jami'-us-Sagheer","ar":"جامع الصغير","roman":"Al-Jami'-us-Sagheer"},
{"alias":"Jamius sagheer","ar":"جامع الصغير","roman":"Al-Jami'-us-Sagheer"},
{"alias":"جامع الكبير","ar":"جامع الكبير","roman":"Al-Jami'-ul-Kabeer"},
{"alias":"Al-Jami'-ul-Kabeer","ar":"جامع الكبير","roman":"Al-Jami'-ul-Kabeer"},
{"alias":"Jamiul kabeer","ar":"جامع الكبير","roman":"Al-Jami'-ul-Kabeer"},
{"alias":"الزیادات","ar":"الزیادات","roman":"Al-Ziyadat"},
{"alias":"Al-Ziyadat","ar":"الزیادات","roman":"Al-Ziyadat"},
{"alias":"Kitab al-ziyadat","ar":"الزیادات","roman":"Al-Ziyadat"},
{"alias":"السير الكبير","ar":"السير الكبير","roman":"Al-Siyar-ul-Kabeer"},
{"alias":"Al-Siyar-ul-Kabeer","ar":"السير الكبير","roman":"Al-Siyar-ul-Kabeer"},
{"alias":"Siyar kabeer","ar":"السير الكبير","roman":"Al-Siyar-ul-Kabeer"},
{"alias":"عقود الدُرِّيۃ","ar":"عقود الدُرِّيۃ","roman":"Uqud-ud-Durriyyah"},
{"alias":"Uqud-ud-Durriyyah","ar":"عقود الدُرِّيۃ","roman":"Uqud-ud-Durriyyah"},
{"alias":"Uqudud durriyyah","ar":"عقود الدُرِّيۃ","roman":"Uqud-ud-Durriyyah"},
{"alias":"تنقیح الحکام","ar":"تنقیح الحکام","roman":"Tanqeh-ul-Ahkam"},
{"alias":"Tanqeh-ul-Ahkam","ar":"تنقیح الحکام","roman":"Tanqeh-ul-Ahkam"},
{"alias":"Tanqehul ahkam","ar":"تنقیح الحکام","roman":"Tanqeh-ul-Ahkam"},
{"alias":"عقیدۂ اہلسنت","ar":"عقیدۂ اہلسنت","roman":"Aqida-e-Ahlesnat"},
{"alias":"Aqida-e-Ahlesnat","ar":"عقیدۂ اہلسنت","roman":"Aqida-e-Ahlesnat"},
{"alias":"Aqidae ahlesnat","ar":"عقیدۂ اہلسنت","roman":"Aqida-e-Ahlesnat"},
{"alias":"مسلکِ حق","ar":"مسلکِ حق","roman":"Maslak-e-Haq"},
{"alias":"Maslak-e-Haq","ar":"مسلکِ حق","roman":"Maslak-e-Haq"},
{"alias":"Maslake haq","ar":"مسلکِ حق","roman":"Maslak-e-Haq"},
{"alias":"سوادِ اعظم","ar":"سوادِ اعظم","roman":"Sawad-e-Azam"},
{"alias":"Sawad-e-Azam","ar":"سوادِ اعظم","roman":"Sawad-e-Azam"},
{"alias":"Sawade azam","ar":"سوادِ اعظم","roman":"Sawad-e-Azam"},
{"alias":"فرقۂ ناجیہ","ar":"فرقۂ ناجیہ","roman":"Firqa-e-Najiya"},
{"alias":"Firqa-e-Najiya","ar":"فرقۂ ناجیہ","roman":"Firqa-e-Najiya"},
{"alias":"Firqae najiya","ar":"فرقۂ ناجیہ","roman":"Firqa-e-Najiya"},
{"alias":"بدعتی گمراہ","ar":"بدعتی گمراہ","roman":"Bid'ati Gumrah"},
{"alias":"Bid'ati Gumrah","ar":"بدعتی گمراہ","roman":"Bid'ati Gumrah"},
{"alias":"Bidati gumrah","ar":"بدعتی گمراہ","roman":"Bid'ati Gumrah"},
{"alias":"مخالفِ سنت","ar":"مخالفِ سنت","roman":"Mukhalif-e-Sunnat"},
{"alias":"Mukhalif-e-Sunnat","ar":"مخالفِ سنت","roman":"Mukhalif-e-Sunnat"},
{"alias":"Mukhalife sunnat","ar":"مخالفِ سنت","roman":"Mukhalif-e-Sunnat"},
{"alias":"مرتد و زندیق","ar":"مرتد و زندیق","roman":"Murtad-o-Zindiq"},
{"alias":"Murtad-o-Zindiq","ar":"مرتد و زندیق","roman":"Murtad-o-Zindiq"},
{"alias":"Murtad o zindiq","ar":"مرتد و زندیق","roman":"Murtad-o-Zindiq"},
{"alias":"الحاد و زندقہ","ar":"الحاد و زندقہ","roman":"Ilhad-o-Zandaqah"},
{"alias":"Ilhad-o-Zandaqah","ar":"الحاد و زندقہ","roman":"Ilhad-o-Zandaqah"},
{"alias":"Ilhad o zandaqah","ar":"الحاد و زندقہ","roman":"Ilhad-o-Zandaqah"},
{"alias":"فتنہ پرداز","ar":"فتنہ پرداز","roman":"Fitna-Pardaz"},
{"alias":"Fitna-Pardaz","ar":"فتنہ پرداز","roman":"Fitna-Pardaz"},
{"alias":"Fitnapardaz","ar":"فتنہ پرداز","roman":"Fitna-Pardaz"},
{"alias":"ردِ باطل","ar":"ردِ باطل","roman":"Radd-e-Batil"},
{"alias":"Radd-e-Batil","ar":"ردِ باطل","roman":"Radd-e-Batil"},
{"alias":"Radde batil","ar":"ردِ باطل","roman":"Radd-e-Batil"},
{"alias":"حفظِ دین","ar":"حفظِ دین","roman":"Hifz-e-Deen"},
{"alias":"Hifz-e-Deen","ar":"حفظِ دین","roman":"Hifz-e-Deen"},
{"alias":"Hifze deen","ar":"حفظِ دین","roman":"Hifz-e-Deen"},
{"alias":"قمعِ شر","ar":"قمعِ شر","roman":"Qam'-e-Sharr"},
{"alias":"Qam'-e-Sharr","ar":"قمعِ شر","roman":"Qam'-e-Sharr"},
{"alias":"Qame sharr","ar":"قمعِ شر","roman":"Qam'-e-Sharr"},
{"alias":"مقامِ تحفظ","ar":"مقامِ تحفظ","roman":"Maqam-e-Tahaffuz"},
{"alias":"Maqam-e-Tahaffuz","ar":"مقامِ تحفظ","roman":"Maqam-e-Tahaffuz"},
{"alias":"Maqame tahaffuz","ar":"مقامِ تحفظ","roman":"Maqam-e-Tahaffuz"},
{"alias":"سيفِ برہاں","ar":"سيفِ برہاں","roman":"Saif-e-Burhan"},
{"alias":"Saif-e-Burhan","ar":"سيفِ برہاں","roman":"Saif-e-Burhan"},
{"alias":"Saife burhan","ar":"سيفِ برہاں","roman":"Saif-e-Burhan"},
{"alias":"تیرِ سدید","ar":"تیرِ سدید","roman":"Teer-e-Sadeed"},
{"alias":"Teer-e-Sadeed","ar":"تیرِ سدید","roman":"Teer-e-Sadeed"},
{"alias":"Teere sadeed","ar":"تیرِ سدید","roman":"Teer-e-Sadeed"},
{"alias":"بیانِ شافی","ar":"بیانِ شافی","roman":"Bayan-e-Shafi"},
{"alias":"Bayan-e-Shafi","ar":"بیانِ شافی","roman":"Bayan-e-Shafi"},
{"alias":"Bayane shafi","ar":"بیانِ شافی","roman":"Bayan-e-Shafi"},
{"alias":"تحقیقِ شافی","ar":"تحقیقِ شافی","roman":"Tahqeeq-e-Shafi"},
{"alias":"Tahqeeq-e-Shafi","ar":"تحقیقِ شافی","roman":"Tahqeeq-e-Shafi"},
{"alias":"Tahqeeqe shafi","ar":"تحقیقِ شافی","roman":"Tahqeeq-e-Shafi"},
{"alias":"برہانِ قاطع","ar":"برہانِ قاطع","roman":"Burhan-e-Qati"},
{"alias":"Burhan-e-Qati","ar":"برہانِ قاطع","roman":"Burhan-e-Qati"},
{"alias":"Burhane qati","ar":"برہانِ قاطع","roman":"Burhan-e-Qati"},
{"alias":"دلیلِ روشن","ar":"دلیلِ روشن","roman":"Dalil-e-Roshan"},
{"alias":"Dalil-e-Roshan","ar":"دلیلِ روشن","roman":"Dalil-e-Roshan"},
{"alias":"Dalile roshan","ar":"دلیلِ روشن","roman":"Dalil-e-Roshan"},
{"alias":"نورِ بصیرت","ar":"نورِ بصیرت","roman":"Noor-e-Baseerat"},
{"alias":"Noor-e-Baseerat","ar":"نورِ بصیرت","roman":"Noor-e-Baseerat"},
{"alias":"Noore baseerat","ar":"نورِ بصیرت","roman":"Noor-e-Baseerat"},
{"alias":"فہمِ عمیق","ar":"فہمِ عمیق","roman":"Fahm-e-Ameeq"},
{"alias":"Fahm-e-Ameeq","ar":"فہمِ عمیق","roman":"Fahm-e-Ameeq"},
{"alias":"Fahme ameeq","ar":"فہمِ عمیق","roman":"Fahm-e-Ameeq"},
{"alias":"ذکاوتِ طبع","ar":"ذکاوتِ طبع","roman":"Zakawat-e-Tab'"},
{"alias":"Zakawat-e-Tab'","ar":"ذکاوتِ طبع","roman":"Zakawat-e-Tab'"},
{"alias":"Zakawate tab","ar":"ذکاوتِ طبع","roman":"Zakawat-e-Tab'"},
{"alias":"حفظِ متن","ar":"حفظِ متن","roman":"Hifz-e-Matn"},
{"alias":"Hifz-e-Matn","ar":"حفظِ متن","roman":"Hifz-e-Matn"},
{"alias":"Hifze matn","ar":"حفظِ متن","roman":"Hifz-e-Matn"},
{"alias":"استحضارِ کتب","ar":"استحضارِ کتب","roman":"Istihzar-e-Kutub"},
{"alias":"Istihzar-e-Kutub","ar":"استحضارِ کتب","roman":"Istihzar-e-Kutub"},
{"alias":"Istihzare kutub","ar":"استحضارِ کتب","roman":"Istihzar-e-Kutub"},
{"alias":"عبقریِ عصر","ar":"عبقریِ عصر","roman":"Abqari-e-Asr"},
{"alias":"Abqari-e-Asr","ar":"عبقریِ عصر","roman":"Abqari-e-Asr"},
{"alias":"Abqarie asr","ar":"عبقریِ عصر","roman":"Abqari-e-Asr"},
{"alias":"فردِ فرید","ar":"فردِ فرید","roman":"Fard-e-Fareed"},
{"alias":"Fard-e-Fareed","ar":"فردِ فرید","roman":"Fard-e-Fareed"},
{"alias":"Farde fareed","ar":"فردِ فرید","roman":"Fard-e-Fareed"},
{"alias":"یگانۂ روزگار","ar":"یگانۂ روزگار","roman":"Yagana-e-Rozgar"},
{"alias":"Yagana-e-Rozgar","ar":"یگانۂ روزگار","roman":"Yagana-e-Rozgar"},
{"alias":"Yagane rozgar","ar":"یگانۂ روزگار","roman":"Yagana-e-Rozgar"},
{"alias":"عدیم المثال","ar":"عدیم المثال","roman":"Adeem-ul-Misaal"},
{"alias":"Adeem-ul-Misaal","ar":"عدیم المثال","roman":"Adeem-ul-Misaal"},
{"alias":"Adeemul misaal","ar":"عدیم المثال","roman":"Adeem-ul-Misaal"},
{"alias":"لامثال شخصیت","ar":"لامثال شخصیت","roman":"La-Misaal Shakhsiyat"},
{"alias":"La-Misaal Shakhsiyat","ar":"لامثال شخصیت","roman":"La-Misaal Shakhsiyat"},
{"alias":"Lamisaal shakhsiyat","ar":"لامثال شخصیت","roman":"La-Misaal Shakhsiyat"},
{"alias":"حقیقۃ اللفظ","ar":"حقیقۃ اللفظ","roman":"Haqiqat-ul-Lafz"},
{"alias":"Haqiqat-ul-Lafz","ar":"حقیقۃ اللفظ","roman":"Haqiqat-ul-Lafz"},
{"alias":"مجازِ مرسل","ar":"مجازِ مرسل","roman":"Majaz-e-Mursal"},
{"alias":"Majaz-e-Mursal","ar":"مجازِ مرسل","roman":"Majaz-e-Mursal"},
{"alias":"دلالتِ اقتضاء","ar":"دلالتِ اقتضاء","roman":"Dalalat-e-Iqtida"},
{"alias":"Dalalat-e-Iqtida","ar":"دلالتِ اقتضاء","roman":"Dalalat-e-Iqtida"},
{"alias":"دلالتِ اشارہ","ar":"دلالتِ اشارہ","roman":"Dalalat-e-Isharah"},
{"alias":"Dalalat-e-Isharah","ar":"دلالتِ اشارہ","roman":"Dalalat-e-Isharah"},
{"alias":"دلالتِ نص","ar":"دلالتِ نص","roman":"Dalalat-e-Nas"},
{"alias":"Dalalat-e-Nas","ar":"دلالتِ نص","roman":"Dalalat-e-Nas"},
{"alias":"دلالتِ دلالہ","ar":"دلالتِ دلالہ","roman":"Dalalat-e-Dalalah"},
{"alias":"Dalalat-e-Dalalah","ar":"دلالتِ دلالہ","roman":"Dalalat-e-Dalalah"},
{"alias":"عزم و رخصت","ar":"عزم و رخصت","roman":"Azm-o-Rukhsat"},
{"alias":"Azm-o-Rukhsat","ar":"عزم و رخصت","roman":"Azm-o-Rukhsat"},
{"alias":"حرمتِ مصاہرت","ar":"حرمتِ مصاہرت","roman":"Hurmat-e-Musaharat"},
{"alias":"Hurmat-e-Musaharat","ar":"حرمتِ مصاہرت","roman":"Hurmat-e-Musaharat"},
{"alias":"رضاعی حرمت","ar":"رضاعی حرمت","roman":"Ridae Hurmat"},
{"alias":"Ridae Hurmat","ar":"رضاعی حرمت","roman":"Ridae Hurmat"},
{"alias":"محرماتِ ابدی","ar":"محرماتِ ابدی","roman":"Muharromat-e-Abadi"},
{"alias":"Muharromat-e-Abadi","ar":"محرماتِ ابدی","roman":"Muharromat-e-Abadi"},
{"alias":"محرماتِ مؤقت","ar":"محرماتِ مؤقت","roman":"Muharromat-e-Moaqqat"},
{"alias":"Muharromat-e-Moaqqat","ar":"محرماتِ مؤقت","roman":"Muharromat-e-Moaqqat"},
{"alias":"نکاحِ فضولی","ar":"نکاحِ فضولی","roman":"Nikah-e-Fuzuli"},
{"alias":"Nikah-e-Fuzuli","ar":"نکاحِ فضولی","roman":"Nikah-e-Fuzuli"},
{"alias":"خیارِ بلوغ","ar":"خیارِ بلوغ","roman":"Khiyar-e-Bulugh"},
{"alias":"Khiyar-e-Bulugh","ar":"خیارِ بلوغ","roman":"Khiyar-e-Bulugh"},
{"alias":"کفائتِ زوجین","ar":"کفائتِ زوجین","roman":"Kafaat-e-Zawjain"},
{"alias":"Kafaat-e-Zawjain","ar":"کفائتِ زوجین","roman":"Kafaat-e-Zawjain"},
{"alias":"مہرِ مثل","ar":"مہرِ مثل","roman":"Mahr-e-Misl"},
{"alias":"Mahr-e-Misl","ar":"مہرِ مثل","roman":"Mahr-e-Misl"},
{"alias":"مہرِ معجل","ar":"مہرِ معجل","roman":"Mahr-e-Moajjal"},
{"alias":"Mahr-e-Moajjal","ar":"مہرِ معجل","roman":"Mahr-e-Moajjal"},
{"alias":"نجاسْتِ غلیظہ","ar":"نجاسْتِ غلیظہ","roman":"Najasat-e-Ghalizah"},
{"alias":"Najasat-e-Ghalizah","ar":"نجاسْتِ غلیظہ","roman":"Najasat-e-Ghalizah"},
{"alias":"نجاستِ خفیفہ","ar":"نجاستِ خفیفہ","roman":"Najasat-e-Khafifah"},
{"alias":"Najasat-e-Khafifah","ar":"نجاستِ خفیفہ","roman":"Najasat-e-Khafifah"},
{"alias":"استنجاء","ar":"استنجاء","roman":"Istinja"},
{"alias":"Istinja","ar":"استنجاء","roman":"Istinja"},
{"alias":"استبراء","ar":"استبراء","roman":"Istibra"},
{"alias":"Istibra","ar":"استبراء","roman":"Istibra"},
{"alias":"فجر کی سنت","ar":"فجر کی سنت","roman":"Sunnah-e-Fajr"},
{"alias":"Sunnah-e-Fajr","ar":"فجر کی سنت","roman":"Sunnah-e-Fajr"},
{"alias":"وترِ واجب","ar":"وترِ واجب","roman":"Witr-e-Wajib"},
{"alias":"Witr-e-Wajib","ar":"وترِ واجب","roman":"Witr-e-Wajib"},
{"alias":"نمازِ کسوف","ar":"نمازِ کسوف","roman":"Namaz-e-Kusoof"},
{"alias":"Namaz-e-Kusoof","ar":"نمازِ کسوف","roman":"Namaz-e-Kusoof"},
{"alias":"نمازِ خسوف","ar":"نمازِ خسوف","roman":"Namaz-e-Khusoof"},
{"alias":"Namaz-e-Khusoof","ar":"نمازِ خسوف","roman":"Namaz-e-Khusoof"},
{"alias":"نمازِ استسقاء","ar":"نمازِ استسقاء","roman":"Namaz-e-Istisqa"},
{"alias":"Namaz-e-Istisqa","ar":"نمازِ استسقاء","roman":"Namaz-e-Istisqa"},
{"alias":"صلاۃ التسبیح","ar":"صلاۃ التسبیح","roman":"Salat-ut-Tasbih"},
{"alias":"Salat-ut-Tasbih","ar":"صلاۃ التسبیح","roman":"Salat-ut-Tasbih"},
{"alias":"سجدۂ سہو","ar":"سجدۂ سہو","roman":"Sajda-e-Sahw"},
{"alias":"Sajda-e-Sahw","ar":"سجدۂ سہو","roman":"Sajda-e-Sahw"},
{"alias":"قعدۂ اخیرہ","ar":"قعدۂ اخیرہ","roman":"Qa'dah-e-Akhirah"},
{"alias":"Qa'dah-e-Akhirah","ar":"قعدۂ اخیرہ","roman":"Qa'dah-e-Akhirah"},
{"alias":"تشمیتِ عاطس","ar":"تشمیتِ عاطس","roman":"Tashmeet-e-Aatis"},
{"alias":"Tashmeet-e-Aatis","ar":"تشمیتِ عاطس","roman":"Tashmeet-e-Aatis"},
{"alias":"اعتکافِ مسنون","ar":"اعتکافِ مسنون","roman":"I'tikaf-e-Masnoon"},
{"alias":"I'tikaf-e-Masnoon","ar":"اعتکافِ مسنون","roman":"I'tikaf-e-Masnoon"}
];
function applyIslamicVocabulary(text, preferRoman=false){
  let out=String(text||'');
  const arabicScript=/[\u0600-\u06FF\u0750-\u077F]/u.test(out);
  const targetRoman=!!preferRoman || !arabicScript;
  for(const item of ISLAMIC_VOCAB_ALIASES){
    if(!item || !item.alias)continue;
    const replacement=targetRoman?item.roman:item.ar;
    if(typeof replacement!=='string' || !replacement.trim())continue;
    const escaped=String(item.alias).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let pattern;
    try{pattern=new RegExp('(^|[^\\p{L}\\p{N}])('+escaped+')(?=$|[^\\p{L}\\p{N}])','giu');}
    catch{pattern=new RegExp('(^|[^A-Za-z0-9\\u0600-\\u06FF])('+escaped+')(?=$|[^A-Za-z0-9\\u0600-\\u06FF])','gi');}
    out=out.replace(pattern,(_m,left)=>left+replacement);
  }
  return out;
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
  const failureState={stage:'starting',selectedLanguage:String(msg.language||'auto'),model:msg.model||'Xenova/whisper-base',duration:0,totalChunks:0,currentChunk:0,chunkDiagnostics:[],totalInferenceMs:0,totalMergedOverlapWords:0,rawWordCueCount:0};
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
      const languageAliases={auto:null,urdu:'urdu',hindi:'hindi',arabic:'arabic',english:'english',ur:'urdu',hi:'hindi',ar:'arabic',en:'english'};
      const requestedLanguage=String(msg.language||'auto').trim().toLowerCase();
      if(!Object.prototype.hasOwnProperty.call(languageAliases,requestedLanguage)){
        throw new Error(`Unsupported language selection: ${requestedLanguage}. Choose Auto, Urdu, Hindi, Arabic or English.`);
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
          const cue={start:globalStart,end:globalEnd,text:pieceText};rawTimed.push(cue);
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
            if(cueEnd>cursor)timed.push({start:cursor,end:cueEnd,text:word});
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
      text=applyIslamicVocabulary(romanizeText(text),true);
      finalTimed=timed.map(c=>({...c,text:applyIslamicVocabulary(romanizeText(c.text),true)}));
    }else{
      text=applyIslamicVocabulary(text,false);
      finalTimed=timed.map(c=>({...c,text:applyIslamicVocabulary(c.text,false)}));
    }
    const scriptEstimate=/[\u0900-\u097F]/u.test(rawText)?'Devanagari':/[\u0600-\u06FF\u0750-\u077F]/u.test(rawText)?'Arabic-script (Urdu/Arabic not distinguishable by script alone)':/[A-Za-z]/u.test(rawText)?'Latin':'Other/undetermined';
    const countWords=cues=>cues.reduce((sum,cue)=>sum+cueWords(cue.text).length,0);
    send('complete',{
      text,rawText,captions:finalTimed,rawCaptions,
      duration:audio.length/sr,chunkCount:total,selectedLanguage:String(msg.language||'auto'),
      romanize:!!msg.romanize,model:msg.model||'Xenova/whisper-base',scriptEstimate,
      rawWordCueCount:countWords(rawCaptions),processedWordCueCount:countWords(finalTimed),
      rawTimestampCueCount:rawCaptions.length,processedTimestampCueCount:finalTimed.length,
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
