const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);

const app = express();
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_IDS = {
  "Masculina": process.env.VOICE_MASCULINA || "ErXwobaYiN019PkySvjV",
  "Femenina": process.env.VOICE_FEMENINA || "21m00Tcm4TlvDq8ikWAM",
  "Energética": process.env.VOICE_ENERGETICA || "EXAVITQu4vr4xnSDxMaL",
  "Documental": process.env.VOICE_DOCUMENTAL || "JBFqnCBsd6RMkjVDRZzb"
};
const TMP = path.join(os.tmpdir(),"viralvideo-ai");
fs.mkdirSync(TMP,{recursive:true});

function safeName(s){return s.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,50)}
async function openaiChat(prompt){
  if(!OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY en el servidor.");
  const r=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:OPENAI_MODEL,temperature:.8,messages:[
      {role:"system",content:"Eres guionista de YouTube. Responde SOLO JSON válido."},
      {role:"user",content:prompt}
    ]})
  });
  const j=await r.json();
  if(!r.ok) throw new Error(j.error?.message||"Error de OpenAI.");
  let text=j.choices?.[0]?.message?.content||"";
  text=text.replace(/^```json\s*/,"").replace(/```$/,"").trim();
  return JSON.parse(text);
}
async function generateImage(prompt,file){
  if(!OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY en el servidor.");
  const r=await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-image-1",prompt,size:"1024x1024",quality:"medium"})
  });
  const j=await r.json();
  if(!r.ok) throw new Error(j.error?.message||"Error generando imagen.");
  const b64=j.data?.[0]?.b64_json;
  if(!b64) throw new Error("El proveedor de imágenes no devolvió una imagen.");
  fs.writeFileSync(file,Buffer.from(b64,"base64"));
}
async function generateSpeech(text,file,voiceId){
  if(!ELEVENLABS_API_KEY) throw new Error("Falta ELEVENLABS_API_KEY en el servidor.");
  const url=`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const r=await fetch(url,{method:"POST",headers:{"xi-api-key":ELEVENLABS_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({text,model_id:"eleven_multilingual_v2"})});
  if(!r.ok){const t=await r.text();throw new Error("Error de voz: "+t.slice(0,300));}
  fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
}
async function renderVideo(images,audio,out){
  const list=path.join(path.dirname(out),"concat.txt");
  const lines=[];
  for(const img of images) lines.push(`file '${img.replace(/'/g,"'\\''")}'`, "duration 60");
  lines.push(`file '${images[images.length-1].replace(/'/g,"'\\''")}'`);
  fs.writeFileSync(list,lines.join("\n"));
  await execFileAsync("ffmpeg",[
    "-y","-f","concat","-safe","0","-i",list,"-i",audio,
    "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-c:v","libx264","-preset","veryfast","-crf","24","-c:a","aac","-b:a","160k","-shortest","-movflags","+faststart",out
  ]);
}
app.post("/api/generate",async(req,res)=>{
 const {topic,style="Viral / Cinematográfico",voice="Masculina"}=req.body||{};
 if(!topic?.trim()) return res.status(400).json({error:"Escribe un tema."});
 const id=crypto.randomUUID(), dir=path.join(TMP,id); fs.mkdirSync(dir);
 try{
  const prompt=`Crea un guion en español para un video de YouTube de unos 3 minutos.
Tema: ${topic}
Estilo: ${style}
Devuelve EXACTAMENTE este JSON:
{"script":"guion completo narrable en español","scenes":[{"title":"GANCHO","narration":"...","image_prompt":"..."}]}
Usa exactamente 5 escenas. La narración total debe ser aproximadamente 380-480 palabras. Cada image_prompt debe describir una imagen cinematográfica 16:9 relacionada con la escena, sin texto ni logotipos.`;
  const script=await openaiChat(prompt);
  if(!Array.isArray(script.scenes)||script.scenes.length<5) throw new Error("El guion no tiene la estructura esperada.");
  const scenes=script.scenes.slice(0,5);
  const images=[];
  for(let i=0;i<scenes.length;i++){
    const f=path.join(dir,`scene-${i+1}.png`);
    await generateImage(scenes[i].image_prompt,f); images.push(f);
  }
  const audio=path.join(dir,"voice.mp3");
  await generateSpeech(script.script,audio,VOICE_IDS[voice]||VOICE_IDS["Masculina"]);
  const out=path.join(dir,`${safeName(topic)}.mp4`);
  await renderVideo(images,audio,out);
  const publicName=`/generated/${id}.mp4`;
  const generatedDir=path.join(__dirname,"public","generated");
  fs.mkdirSync(generatedDir,{recursive:true});
  fs.copyFileSync(out,path.join(generatedDir,`${id}.mp4`));
  res.json({script:script.script,scenes,videoUrl:publicName});
  setTimeout(()=>fs.rm(dir,{recursive:true,force:true},()=>{}),10*60*1000);
 }catch(e){
  fs.rm(dir,{recursive:true,force:true},()=>{});
  res.status(500).json({error:e.message||"Error generando el video."});
 }
});
app.listen(PORT,()=>console.log(`ViralVideo AI listo en http://localhost:${PORT}`));
