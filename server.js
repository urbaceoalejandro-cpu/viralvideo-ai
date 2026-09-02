const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const generatedDir = path.join(__dirname, "public", "generated");
fs.mkdirSync(generatedDir, { recursive: true });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function fallbackScript(topic, style) {
  return {
    title: topic,
    scenes: [
      { title: "GANCHO", narration: `Hoy vas a descubrir algo que pocas personas conocen sobre ${topic}. Quédate hasta el final porque el último punto puede cambiar por completo la forma en que ves este tema.`, image_prompt: "cinematic abstract background related to the topic" },
      { title: "CONTEXTO", narration: `Antes de entrar en los detalles, necesitamos entender por qué ${topic} ha llamado tanto la atención. Hay preguntas, datos y detalles que hacen que este tema sea especialmente interesante.`, image_prompt: "cinematic documentary background related to the topic" },
      { title: "DESARROLLO", narration: `Ahora llegamos a la parte más interesante. Observa cómo se conectan los hechos principales y por qué algunos detalles siguen generando debate entre quienes investigan este tema.`, image_prompt: "dramatic documentary background related to the topic" },
      { title: "PUNTO CLAVE", narration: `Y aquí está el dato que más sorprende. Cuando juntamos las piezas, aparece una explicación mucho más interesante de lo que parecía al principio.`, image_prompt: "mysterious cinematic background related to the topic" },
      { title: "CIERRE", narration: `En resumen, ${topic} todavía tiene preguntas que merecen nuestra atención. Si quieres más historias como esta, suscríbete y acompáñanos en el próximo video.`, image_prompt: "cinematic ending background related to the topic" }
    ]
  };
}

async function generateScript(topic, style) {
  if (!GEMINI_KEY) return fallbackScript(topic, style);

  const prompt = `Escribe un guion en español para YouTube de aproximadamente 3 minutos sobre: "${topic}".
Estilo: ${style}.
Debe tener exactamente 5 escenas. Devuelve SOLO JSON válido con esta estructura:
{
  "title": "título",
  "scenes": [
    {"title":"GANCHO","narration":"...","image_prompt":"..."},
    {"title":"CONTEXTO","narration":"...","image_prompt":"..."},
    {"title":"DESARROLLO","narration":"...","image_prompt":"..."},
    {"title":"PUNTO CLAVE","narration":"...","image_prompt":"..."},
    {"title":"CIERRE","narration":"...","image_prompt":"..."}
  ]
}
La narración total debe durar cerca de 3 minutos al leerla en voz alta. No inventes citas ni fuentes.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini no devolvió texto.");

  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(clean);
  if (!parsed.scenes || parsed.scenes.length !== 5) throw new Error("Gemini no devolvió exactamente 5 escenas.");
  return parsed;
}

async function makeAudio(text, outPath) {
  await execFileAsync("espeak", [
    "-v", "es-la",
    "-s", "145",
    "-p", "45",
    "-a", "150",
    "-w", outPath,
    text
  ], { maxBuffer: 1024 * 1024 });
}

function safeText(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

async function makeSceneVideo(scene, index, workDir, outPath) {
  const audioPath = path.join(workDir, `audio-${index}.wav`);
  await makeAudio(scene.narration, audioPath);

  // Abstract cinematic background. No paid image API is needed.
  const duration = Math.max(8, Math.ceil((await execFileAsync("ffprobe", [
    "-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1", audioPath
  ])).stdout.trim() * 1 + 0.5));

  const title = safeText(scene.title);

  const backgrounds = ["10182f","1b102f","102f2a","2f2410","24102f"];
  const bg = backgrounds[index % backgrounds.length];

  const filter = [
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`,
    `drawbox=x=0:y=0:w=1280:h=720:color=black@0.28:t=fill`,
    `drawtext=text='VIRALVIDEO AI':x=60:y=52:fontsize=26:fontcolor=white@0.8`,
    `drawtext=text='${title}':x=60:y=590:fontsize=48:fontcolor=white:borderw=3:bordercolor=black@0.7`,
    `drawtext=text='Narración automática':x=60:y=650:fontsize=22:fontcolor=white@0.85:borderw=2:bordercolor=black@0.7`
  ].join(",");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f","lavfi","-i",`color=c=0x${bg}:s=1280x720:r=30`,
    "-i", audioPath,
    "-t", String(duration),
    "-vf", filter,
    "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","128k",
    "-shortest", outPath
  ], { maxBuffer: 2 * 1024 * 1024 });
}

async function buildVideo(script) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "viralvideo-"));
  const clips = [];
  try {
    for (let i = 0; i < script.scenes.length; i++) {
      const clip = path.join(workDir, `scene-${i}.mp4`);
      await makeSceneVideo(script.scenes[i], i, workDir, clip);
      clips.push(clip);
    }

    const listFile = path.join(workDir, "concat.txt");
    fs.writeFileSync(listFile, clips.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

    const id = crypto.randomUUID();
    const output = path.join(generatedDir, `${id}.mp4`);

    await execFileAsync("ffmpeg", [
      "-y","-f","concat","-safe","0","-i",listFile,
      "-c","copy", output
    ], { maxBuffer: 2 * 1024 * 1024 });

    return `/generated/${id}.mp4`;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

app.post("/api/generate", async (req, res) => {
  try {
    const { topic, style = "Viral / Cinematográfico", voice = "Masculina" } = req.body || {};
    if (!topic || !topic.trim()) return res.status(400).json({ error: "Escribe un tema." });

    const script = await generateScript(topic.trim(), style);
    const videoUrl = await buildVideo(script);

    res.json({
      ok: true,
      script,
      videoUrl,
      message: GEMINI_KEY
        ? "Video creado con Gemini + voz local gratuita + FFmpeg."
        : "Video creado con guion local de respaldo + voz local gratuita + FFmpeg. Agrega GEMINI_API_KEY para guiones más inteligentes."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error generando el video." });
  }
});

app.listen(PORT, () => {
  console.log(`ViralVideo AI gratis listo en http://localhost:${PORT}`);
});
