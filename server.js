const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const port = 3000;

const os = require('os');

// Setup temp directory (Vercel에서는 읽기 전용 에러 방지를 위해 /tmp 사용)
let tempDir = path.join(__dirname, 'temp');
try {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
} catch (err) {
    // 만약 읽기 전용(EROFS) 에러가 나면 서버리스 환경이므로 os.tmpdir() 사용
    if (err.code === 'EROFS') {
        tempDir = path.join(os.tmpdir(), 'ai-dubbing');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    } else {
        throw err;
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

app.use(express.static('public'));
app.use(express.json());

app.get('/api/get-keys', (req, res) => {
    try {
        // First check Vercel Environment variables
        let elevenKey = process.env.ELEVENLABS_API_KEY || '';
        
        // If not found, check local file
        const keyPath = path.join(__dirname, 'elevenlabs_api_key.txt');
        if (!elevenKey && fs.existsSync(keyPath)) {
            elevenKey = fs.readFileSync(keyPath, 'utf8').trim();
        } else if (!elevenKey) {
            console.warn('elevenlabs_api_key.txt not found...');
            const fallbackPath = path.join(__dirname, 'elevenlabs_api_key');
            if (fs.existsSync(fallbackPath)) {
                elevenKey = fs.readFileSync(fallbackPath, 'utf8').trim();
            }
        }
        res.json({ elevenlabs: elevenKey });
    } catch (err) {
        console.error('Error reading key file:', err);
        res.status(500).json({ error: 'Failed to read keys' });
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
