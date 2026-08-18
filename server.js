require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const port = 3000;

const os = require('os');

// Setup temp directory (Vercel에서는 읽기 전용/경로 에러 방지를 위해 /tmp 사용)
let tempDir = path.join(__dirname, 'temp');
try {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
} catch (err) {
    // 로컬 권한 문제, 읽기 전용(EROFS), 또는 Vercel 특유의 경로 에러(ENOENT) 등
    // 어떤 이유로든 로컬 temp 폴더 생성을 실패하면 무조건 os.tmpdir()로 우회합니다.
    tempDir = path.join(os.tmpdir(), 'ai-dubbing');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        // preserve extension
        let ext = path.extname(file.originalname);
        if (!ext && file.mimetype === 'audio/mpeg') ext = '.mp3';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
});
const upload = multer({ storage: storage });

// Vercel에서 public 폴더를 안전하게 찾을 수 있도록 절대 경로(__dirname) 지정
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use(express.json());

// 루트 접속 시 index.html 띄우기 (Cannot GET / 방지)
app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// ─────────────────────────────────────────────────────────────
// API 프록시 — 키는 서버에만 두고, 브라우저로 내려보내지 않습니다.
// 로컬: .env  /  배포: 호스팅 환경변수
// ─────────────────────────────────────────────────────────────
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

function requireKey(res, key, name) {
    if (!key) {
        res.status(500).json({ error: `${name} 키가 설정되지 않았습니다. .env 파일을 확인해 주세요.` });
        return false;
    }
    return true;
}

// STT — 음성/영상에서 스크립트 추출
app.post('/api/stt', upload.single('file'), async (req, res) => {
    if (!requireKey(res, ELEVEN_KEY, 'ELEVENLABS_API_KEY')) return;
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
    try {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(req.file.path)]), req.file.originalname);
        form.append('model_id', 'scribe_v1');
        form.append('diarize', 'true');
        form.append('tag_audio_events', 'false');

        const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: { 'xi-api-key': ELEVEN_KEY },
            body: form
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('STT error:', err);
        res.status(500).json({ error: 'STT 처리에 실패했습니다.' });
    } finally {
        fs.unlink(req.file.path, () => {});
    }
});

// 번역 — Gemini
app.post('/api/translate', async (req, res) => {
    if (!requireKey(res, GEMINI_KEY, 'GEMINI_API_KEY')) return;
    const { prompt, model = 'gemini-2.5-flash', temperature = 0.3 } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt가 없습니다.' });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature }
            })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Translate error:', err);
        res.status(500).json({ error: '번역에 실패했습니다.' });
    }
});

// TTS — 음성 합성
app.post('/api/tts', async (req, res) => {
    if (!requireKey(res, ELEVEN_KEY, 'ELEVENLABS_API_KEY')) return;
    const { text, voiceId } = req.body || {};
    if (!text || !voiceId) return res.status(400).json({ error: 'text 또는 voiceId가 없습니다.' });
    try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVEN_KEY
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.35, similarity_boost: 0.65 }
            })
        });
        if (!r.ok) {
            const e = await r.text();
            return res.status(r.status).json({ error: e });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
        console.error('TTS error:', err);
        res.status(500).json({ error: '음성 합성에 실패했습니다.' });
    }
});

app.post('/api/merge-video', upload.any(), (req, res) => {
    try {
        const configStr = req.body.config;
        if (!configStr) {
            return res.status(400).json({ error: 'Missing config JSON' });
        }
        const config = JSON.parse(configStr);

        let videoFile = null;
        const audioFiles = {};

        req.files.forEach(file => {
            if (file.fieldname === 'video') {
                videoFile = file;
            } else if (file.fieldname.startsWith('audio_')) {
                const index = parseInt(file.fieldname.split('_')[1], 10);
                audioFiles[index] = file;
            }
        });

        if (!videoFile) {
            return res.status(400).json({ error: 'Missing video file' });
        }

        const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
        let subtitlePath = null;

        // Save subtitles to temp file if provided
        if (req.body.subtitles) {
            subtitlePath = path.join(tempDir, `subs_${Date.now()}.srt`);
            fs.writeFileSync(subtitlePath, req.body.subtitles);
        }

        let command = ffmpeg(videoFile.path);

        // input all audio files
        config.forEach(item => {
            const af = audioFiles[item.audioIndex];
            if (af) {
                command = command.input(af.path);
            }
        });

        let filterComplex = '';
        const mixInputs = [];

        if (config.length === 0) {
            // No audio, just strip the audio
            command = command
                .outputOptions([
                    '-map 0:v:0',
                    '-c:v copy'
                ]);
        } else {
            // Build filter complex
            config.forEach((item, idx) => {
                const inputIndex = idx + 1; // 0 is video, 1 is first audio
                const af = audioFiles[item.audioIndex];
                if (!af) return;

                const delayMs = Math.max(0, Math.floor(item.startTime * 1000));
                let rate = item.playbackRate || 1.0;

                let filter = `[${inputIndex}:a]`;
                if (rate !== 1.0) {
                    filter += `atempo=${rate},`;
                }
                filter += `adelay=${delayMs}|${delayMs}[a${inputIndex}];`;
                filterComplex += filter;
                mixInputs.push(`[a${inputIndex}]`);
            });

            // Mix all delayed and sped-up audios, then RESET timestamps to prevent overflow corruption
            filterComplex += `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,asetpts=PTS-STARTPTS[aout]`;

            // Add Subtitles filter (Burn-in)
            if (subtitlePath) {
                // Windows path escaping for FFmpeg
                const escapedPath = subtitlePath.replace(/\\/g, '/').replace(':', '\\:');
                // Alignment=2 (Bottom Center), MarginV=30 (Approximately 8-10% from bottom to match 92% frontend)
                filterComplex = `[0:v]subtitles='${escapedPath}':force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=1.5,Shadow=0,MarginV=30,Alignment=2'[vsub]; ` + filterComplex;
            }

            command = command
                .complexFilter(filterComplex)
                .outputOptions([
                    '-map ' + (subtitlePath ? '[vsub]' : '0:v:0'), // Use subtitle stream if present
                    '-map [aout]',   // include our mixed audio stream
                    '-c:v libx264',  // Force H.264 video encoding for maximum compatibility
                    '-preset fast',  // Encoding speed vs compression ratio
                    '-profile:v main',// Ensure wide compatibility (prevent High Profile playback issues)
                    '-crf 23',       // Constant Rate Factor (0-51, lower is better quality, 23 is default)
                    '-pix_fmt yuv420p', // Ensure standard pixel format for Windows/Mac players
                    '-movflags +faststart', // Allow video to play before fully downloaded/processed
                    '-c:a aac',      // encode audio
                    '-b:a 192k',
                    '-shortest'      // Ensure output ends when the shortest stream (video) ends
                ]);
        }

        command
            .on('end', () => {
                console.log('Merging finished successfully.');
                res.download(outputPath, 'ai-dubbing-result.mp4', (err) => {
                    // Cleanup files
                    const filesToClean = [videoFile.path, outputPath, ...Object.values(audioFiles).map(f => f.path)];
                    if (subtitlePath) filesToClean.push(subtitlePath);
                    filesToClean.forEach(f => {
                        if (fs.existsSync(f)) fs.unlink(f, () => { });
                    });
                });
            })
            .on('error', (err, stdout, stderr) => {
                console.error('Error merging:', err.message);
                console.error('ffmpeg stderr:', stderr);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error during rendering: ' + err.message });
                }
                // Cleanup files
                const filesToClean = [videoFile.path, outputPath, ...Object.values(audioFiles).map(f => f.path)];
                if (subtitlePath) filesToClean.push(subtitlePath);
                filesToClean.forEach(f => {
                    if (fs.existsSync(f)) fs.unlink(f, () => { });
                });
            })
            .save(outputPath); // CALL SAVE LAST

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Vercel 환경이 아닐 때만 자체 서버 구동 (Vercel에서는 모듈로 로드되므로 require.main !== module이 됨)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`AI Dubbing App Server running at http://localhost:${port}`);
    });
}

// Vercel Serverless 배포를 위한 익스포트
module.exports = app;
