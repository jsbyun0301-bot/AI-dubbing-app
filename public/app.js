document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('video-upload');
    const videoPreviewContainer = document.getElementById('video-preview-container');
    const videoPreview = document.getElementById('video-preview');
    const btnRemoveVideo = document.getElementById('btn-remove-video');
    const btnExtractScript = document.getElementById('btn-extract-script');
    const analysisResults = document.getElementById('analysis-results');
    const loadingOverlay = document.getElementById('loading-overlay');
    window.isSequentialMode = false; // Flag to control sync/sequential playback

    const btnNextStep3 = document.getElementById('btn-next-step-3'); // Hidden but kept the ID
    const btnNextStep4 = document.getElementById('btn-next-step-4');
    const resultScriptTextarea = document.getElementById('result-script');
    window.isSyncPlaying = false; // Initialize globally

    const translatedScriptTextarea = document.getElementById('translated-script');
    const loadingText = document.getElementById('loading-text');
    const btnDownloadSrt = document.getElementById('btn-download-srt');
    const dialogueEditor = document.getElementById('dialogue-editor');
    const containerBody = document.getElementById('step-content');

    // Translation Elements
    const translationSection = document.getElementById('translation-section');
    const btnTranslateScript = document.getElementById('btn-translate-script');
    const targetLanguageSelect = document.getElementById('target-language');

    const translationStepSubtitle = document.getElementById('translation-step-subtitle');
    const translationBadgeSpan = document.getElementById('translation-badge-span');

    // API 키는 서버에서만 다룹니다. 브라우저는 /api/* 프록시를 호출합니다.


    // UI Navigation Elements
    const step2Nav = document.getElementById('step-2-nav');
    const step3Nav = document.getElementById('step-3-nav');
    const mainHeader = document.getElementById('main-header');

    // ── 진행 표시 ────────────────────────────────────────────
    const progressTrack = document.getElementById('progress-track');
    const progressFill = document.getElementById('progress-fill');
    const progressCount = document.getElementById('progress-count');

    function setProgress(done, total) {
        if (!progressTrack) return;
        if (!total) {
            progressTrack.classList.add('hidden');
            progressCount.classList.add('hidden');
            return;
        }
        progressTrack.classList.remove('hidden');
        progressCount.classList.remove('hidden');
        progressFill.style.width = `${Math.round((done / total) * 100)}%`;
        progressCount.textContent = `${done} / ${total}`;
    }

    // ── 오류 메시지 ────────────────────────────────────────────
    // 서버·외부 API의 원문 메시지를 사용자가 이해할 수 있는 안내로 바꿉니다.
    const ERROR_HINTS = [
        [/cannot find ffmpeg|ffmpeg/i,
         '영상 병합 기능을 사용할 수 없는 상태입니다. 자동 재생이나 SRT 자막 내려받기를 이용해 주세요.'],
        [/payload too large|413|too large/i,
         '파일이 너무 큽니다. 2분 이내 영상으로 다시 시도해 주세요.'],
        [/429|rate limit|한도/i,
         '요청이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.'],
        [/401|unauthorized|api key|authentication/i,
         'API 인증에 실패했습니다. 서버의 키 설정을 확인해 주세요.'],
        [/quota|payment|credit|402/i,
         'API 사용량이 한도에 도달했습니다. 잠시 후 또는 다음 달에 다시 시도해 주세요.'],
        [/timeout|timed out|network|failed to fetch/i,
         '서버 응답이 지연되고 있습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.'],
        [/오디오 트랙/i,
         '영상에서 소리를 찾지 못했습니다. 음성이 포함된 파일인지 확인해 주세요.'],
    ];

    function friendlyError(prefix, error) {
        const raw = (error && error.message) || String(error || '');
        for (const [pattern, hint] of ERROR_HINTS) {
            if (pattern.test(raw)) return `${prefix}\n\n${hint}`;
        }
        // 한글 안내가 이미 담긴 메시지는 그대로 전달
        if (/[가-힣]/.test(raw)) return `${prefix}\n\n${raw}`;
        return `${prefix}\n\n잠시 후 다시 시도해 주세요. 문제가 계속되면 다른 파일로 시도해 보세요.`;
    }

    // 결과 영역이 영상 바로 아래에 있어, 세로 배치에서는
    // 합성 버튼보다 위에 놓이는 문제가 있었습니다. 순서를 바로잡습니다.
    // 번역 설정(언어 선택 · 번역 시작)은 대사 카드 위에 있어야
    // 버튼을 누른 자리에서 바로 결과를 볼 수 있습니다.
    (function relocateTranslationControls() {
        const section = document.getElementById('translation-section');
        const editor = document.getElementById('dialogue-editor');
        const details = document.querySelector('#analysis-results > .analysis-details');
        if (!section || !editor || !details) return;

        // 번역 헤더 + 언어 선택을 카드 위로 이동
        const header = section.querySelector('h3');
        const selector = section.querySelector('.language-selector');
        const controls = document.createElement('div');
        controls.className = 'translation-controls';
        if (header) controls.appendChild(header);
        if (selector) controls.appendChild(selector);
        details.insertBefore(controls, editor);

        // 남은 '다음 단계' 버튼은 카드 아래에 유지
        section.classList.add('translation-footer');
    })();

    (function relocateResultSection() {
        const result = document.getElementById('audio-result-container');
        const dubbing = document.getElementById('dubbing-section');
        if (result && dubbing && dubbing.parentNode) {
            dubbing.parentNode.insertBefore(result, dubbing.nextSibling);
        }
    })();

    // 3단계에서는 영상 플레이어를 결과 칸 안으로 옮겨,
    // 합성한 음성이 영상에 어떻게 얹히는지 같은 자리에서 확인하도록 합니다.
    const videoHomeAnchor = document.createComment('video-preview-home');
    if (videoPreviewContainer && videoPreviewContainer.parentNode) {
        videoPreviewContainer.parentNode.insertBefore(videoHomeAnchor, videoPreviewContainer);
    }

    function placeVideoForStep(step) {
        const result = document.getElementById('audio-result-container');
        if (!videoPreviewContainer) return;
        const inResult = step === 3 && result && !result.classList.contains('hidden');

        if (inResult) {
            if (videoPreviewContainer.parentNode !== result) {
                const title = result.querySelector('.result-title');
                result.insertBefore(videoPreviewContainer, title ? title.nextSibling : result.firstChild);
            }
            videoPreviewContainer.classList.add('in-result');
        } else {
            videoPreviewContainer.classList.remove('in-result');
            if (videoHomeAnchor.parentNode && videoPreviewContainer.parentNode !== videoHomeAnchor.parentNode) {
                videoHomeAnchor.parentNode.insertBefore(videoPreviewContainer, videoHomeAnchor.nextSibling);
            }
        }
    }

    // ── 단계 전환 ────────────────────────────────────────────────
    // 1 스크립트 추출 · 2 번역 · 3 더빙 생성
    // 각 단계에서 필요한 영역만 보이도록 정리합니다.
    const STEP_TITLES = {
        1: '1단계 · 영상 업로드 및 스크립트 추출',
        2: '2단계 · 스크립트 번역',
        3: '3단계 · AI 음성 더빙 생성'
    };
    window.currentStep = 1;

    function goToStep(step) {
        window.currentStep = step;
        const $ = (id) => document.getElementById(id);
        const show = (el, on) => el && el.classList.toggle('hidden', !on);

        const hasVideo = Boolean(window.currentVideoFile || currentVideoFile);
        const hasScript = Boolean(window.dialogues && window.dialogues.length);

        // 왼쪽 — 영상 영역
        show($('drop-zone'), step === 1 && !hasVideo);
        show($('video-preview-container'), hasVideo);
        const actions = document.querySelector('#video-preview-container .video-actions');
        if (actions) actions.style.display = step === 1 ? '' : 'none';
        show($('audio-result-container'), step === 3 && Boolean(window.generatedAudioBlobs?.length));

        // 오른쪽 — 단계별 작업 영역
        show($('analysis-results'), step >= 1 && hasScript);
        show($('translation-section'), step === 2);
        show($('dubbing-section'), step === 3);

        // 레이아웃 · 제목 · 사이드바
        const body = $('step-content');
        if (body) {
            body.classList.toggle('studio-mode', hasScript);
            // 스크립트가 생성된 뒤에는 모든 단계에서 전체 폭 배치를 씁니다.
            // 단계마다 좌우 배치가 바뀌면 화면이 흔들려 보이기 때문입니다.
            body.classList.toggle('layout-full', hasScript);
        }
        if (mainHeader) mainHeader.textContent = STEP_TITLES[step] || STEP_TITLES[1];

        [['step-2-nav', 1], ['step-3-nav', 2], ['step-4-nav', 3]].forEach(([id, n]) => {
            const nav = $(id);
            if (!nav) return;
            nav.classList.toggle('active', n === step);
            nav.style.opacity = n === step ? '1' : '0.5';
            nav.style.cursor = n < step ? 'pointer' : 'default';
        });

        placeVideoForStep(step);

        if (body) body.scrollTop = 0;
    }

    // 사이드바로 이전 단계 되돌아가기
    [['step-2-nav', 1], ['step-3-nav', 2], ['step-4-nav', 3]].forEach(([id, n]) => {
        const nav = document.getElementById(id);
        if (nav) nav.addEventListener('click', () => {
            if (n < window.currentStep) goToStep(n);
        });
    });



    let currentVideoFile = null;

    // --- File Upload Logic ---

    // Click to upload
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // Drag and drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    fileInput.addEventListener('change', function () {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        if (files.length === 0) return;

        const file = files[0];
        currentVideoFile = file;

        // Show preview if it's a video/audio
        const fileURL = URL.createObjectURL(file);
        videoPreview.src = fileURL;

        // Update UI
        videoPreview.src = URL.createObjectURL(file);
        if (btnNextStep3) btnNextStep3.disabled = true;
        window.dialogues = [];
        goToStep(1);
    }

    // Remove video
    btnRemoveVideo.addEventListener('click', () => {
        currentVideoFile = null;
        window.currentVideoFile = null;
        window.dialogues = [];
        window.generatedAudioBlobs = [];
        videoPreview.src = '';
        goToStep(1);
    });

    // --- Extract Script Logic (Step 2) ---
    videoPreview.onloadedmetadata = () => {
        if (window.dialogues && window.dialogues.length > 0) {
            renderSegmentsTimeline();
        }
    };

    // Helper to sanitize header values (remove non-ISO-8859-1 chars)
    function sanitizeHeaderValue(val) {
        return val.replace(/[^\x00-\xFF]/g, '').trim();
    }

    btnExtractScript.addEventListener('click', async () => {
        if (!currentVideoFile) {
            alert('업로드된 파일이 없습니다.');
            return;
        }

        // Show loading + Skeletons
        loadingText.textContent = '오디오를 추출하고 스크립트를 작성 중입니다 (ElevenLabs)...';
        loadingOverlay.classList.remove('hidden');
        renderSkeletonCards(); // Show skeleton cards

        try {
            await extractScriptWithElevenLabs(currentVideoFile);
        } catch (error) {
            console.error('STT Error:', error);
            alert(friendlyError('스크립트를 추출하지 못했습니다.', error));
            dialogueEditor.innerHTML = ''; // Clear skeletons on error
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    });

    // ── 오디오 추출 ────────────────────────────────────────────
    // 서버리스 요청 본문 상한(4.5MB) 때문에 영상을 그대로 올릴 수 없어,
    // 브라우저에서 오디오만 뽑아 16kHz 모노 WAV로 변환한 뒤 업로드합니다.
    const STT_SAMPLE_RATE = 16000;
    const STT_MAX_BYTES = 4 * 1024 * 1024;

    function encodeWav(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        let off = 44;
        for (let i = 0; i < samples.length; i++, off += 2) {
            const v = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    async function extractAudioForStt(file) {
        const arrayBuffer = await file.arrayBuffer();
        const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
        let decoded;
        try {
            decoded = await decodeCtx.decodeAudioData(arrayBuffer);
        } finally {
            decodeCtx.close();
        }
        if (!decoded || decoded.length === 0) {
            throw new Error('오디오 트랙을 찾을 수 없습니다.');
        }

        // 16kHz 모노로 리샘플링
        const frames = Math.ceil(decoded.duration * STT_SAMPLE_RATE);
        const offline = new OfflineAudioContext(1, frames, STT_SAMPLE_RATE);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();

        const wav = encodeWav(rendered.getChannelData(0), STT_SAMPLE_RATE);
        if (wav.size > STT_MAX_BYTES) {
            const limitMin = Math.floor(STT_MAX_BYTES / (STT_SAMPLE_RATE * 2) / 60);
            throw new Error(
                `영상이 너무 깁니다. 약 ${limitMin}분 이내로 잘라서 올려주세요. ` +
                `(현재 ${Math.round(decoded.duration)}초)`
            );
        }
        return wav;
    }

    async function extractScriptWithElevenLabs(file) {
        loadingText.textContent = '영상에서 오디오를 추출하고 있습니다...';
        const audioBlob = await extractAudioForStt(file);

        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.wav');
        formData.append('model_id', 'scribe_v1'); // Using scribe_v1 for diarization
        formData.append('diarize', 'true'); // Enable speaker diarization
        formData.append('tag_audio_events', 'false');

        const response = await fetch('/api/stt', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errResult = await response.json().catch(() => ({}));
            if (response.status === 413) {
                throw new Error('오디오 용량이 서버 한도를 넘었습니다. 더 짧은 영상으로 시도해 주세요.');
            }
            throw new Error(errResult.error || errResult.detail?.message || `요청 실패 (status: ${response.status})`);
        }

        const data = await response.json();
        const transcribedText = parseDiarizedText(data);

        if (!transcribedText || transcribedText.trim() === '') {
            throw new Error('인식된 음성이 없습니다. (빈 스크립트)');
        }

        displayScriptResults(transcribedText);
    }

    // Helper to format Scribe API response by speaker
    function parseDiarizedText(data) {
        if (!data || !data.words || data.words.length === 0) return data.text || '';
        if (!data.words[0].speaker_id) return data.text; // Fallback if no speaker data

        let formattedScript = "";
        let currentSpeaker = data.words[0].speaker_id;
        let currentSentence = "";
        let currentStart = data.words[0].start || 0;
        let currentEnd = data.words[0].end || 0;
        window.originalBlocks = [];

        function formatTime(seconds) {
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        // 한 화자가 길게 말하면 자막·카드가 한 덩어리로 뭉치므로,
        // 문장이 끝나거나 일정 길이를 넘으면 블록을 나눕니다.
        const SENT_END = /[.!?。？！]$|(다|요|죠|까|나|네|군요|습니다|입니다)$/;
        const MAX_BLOCK_SEC = 8;
        const MAX_BLOCK_CHARS = 60;

        const flush = () => {
            const text = currentSentence.trim();
            if (!text) return;
            window.originalBlocks.push({ speaker: currentSpeaker, start: currentStart, end: currentEnd, text });
            formattedScript += `[${currentSpeaker}][${formatTime(currentStart)}-${formatTime(currentEnd)}]: ${text}\n\n`;
            currentSentence = "";
        };

        data.words.forEach((wordObj) => {
            if (wordObj.speaker_id === currentSpeaker) {
                currentSentence += wordObj.text + " ";
                currentEnd = wordObj.end || currentEnd; // Keep track of the last word's end time

                const trimmed = currentSentence.trim();
                const tooLong = (currentEnd - currentStart) >= MAX_BLOCK_SEC || trimmed.length >= MAX_BLOCK_CHARS;
                const sentenceDone = SENT_END.test(trimmed.replace(/\s+$/, ''));
                if (trimmed && (sentenceDone || tooLong)) {
                    flush();
                    currentStart = wordObj.end || currentEnd;
                }
            } else {
                // Speaker changed, append previous sentence
                flush();
                // Start new sentence for new speaker
                currentSpeaker = wordObj.speaker_id;
                currentSentence = wordObj.text + " ";
                currentStart = wordObj.start || 0;
                currentEnd = wordObj.end || 0;
            }
        });

        flush();
        return formattedScript.trim();
    }

    function displayScriptResults(text) {
        resultScriptTextarea.value = text;
        
        // Parse raw text into structured window.dialogues
        window.dialogues = [];
        const lines = text.split('\n\n').filter(Boolean);
        lines.forEach(line => {
            const regex = /\[(speaker_\d+)\]\[(\d{2}:\d{2})-(\d{2}:\d{2})\]:\s*(.*)/;
            const match = line.match(regex);
            if (match) {
                window.dialogues.push({
                    speaker: match[1],
                    startTime: match[2],
                    endTime: match[3],
                    originalText: match[4].trim(),
                    translatedText: '',
                    emotion: ''
                });
            }
        });

        renderDialogueCards();
        renderSegmentsTimeline();
        analysisResults.classList.remove('hidden');
        goToStep(2);

        // Save the script for Step 3 in a global var
        window.extractedScript = text;
    }

    // --- Translate Script Logic (Step 3) ---
    btnTranslateScript.addEventListener('click', async () => {
        const scriptToTranslate = window.extractedScript;
        const targetLanguage = targetLanguageSelect.value;

        if (!scriptToTranslate) {
            alert('번역할 원본 스크립트가 없습니다.');
            return;
        }

        // --- Button Loading State ---
        const originalBtnText = btnTranslateScript.innerHTML;
        btnTranslateScript.disabled = true;
        btnTranslateScript.innerHTML = `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px; display: inline-block; margin-right: 8px; vertical-align: middle;"></span> 번역 중...`;

        loadingText.textContent = `${targetLanguage} 언어로 번역 중입니다 (Gemini 2.5 Flash)...`;
        loadingOverlay.classList.remove('hidden');

        try {
            await translateWithGemini(scriptToTranslate, targetLanguage);
        } catch (error) {
            console.error('Translation Error:', error);
            alert(friendlyError('번역에 실패했습니다.', error));
        } finally {
            loadingOverlay.classList.add('hidden');
            // --- Restore Button State ---
            btnTranslateScript.disabled = false;
            btnTranslateScript.innerHTML = originalBtnText;
        }
    });

    async function translateWithGemini(text, targetLang) {
        const prompt = `
당신은 극영화 미디어 자막 번역가입니다. 제공된 대화 스크립트를 ${targetLang} 언어로 가장 자연스럽게 번역해주세요.
[필수 규칙]
1. 원본 스크립트에 포함된 대괄호 형태의 화자 및 시간 표시 (예: [speaker_0][00:00-00:05]:) 구조와 줄바꿈을 절대 훼손하지 말고 그대로 유지하세요.
2. 번역된 전체 스크립트 텍스트만 출력하고, 불필요한 마크다운 기호(\`\`\`)나 인사말, 설명은 절대 포함하지 마세요.
3. [감정 연기 지시] 각 대사마다 맨 앞에 그 상황이나 문맥에 꼭 맞는 '감정 및 연기 지시문'을 괄호 안에 한국어로 넣어주세요. (예: \`[speaker_0][00:00-00:05]: (화난 목소리로) 도대체 왜 그러는 거야!\`, \`[speaker_1][00:06-00:10]: (슬프게 속삭이듯) 미안해...\`)
4. [대사 길이 조절] 동영상 하이라이트 더빙용이므로, 읽는 시간이 몹시 길어지지 않도록 한국어 번역문을 적당히 간결하게(의역) 다듬어주세요. 너무 길게 번역하지 마세요.

원본 스크립트:
${text}
`;

        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Gemini API request failed');
        }

        const data = await response.json();
        const translatedText = data.candidates[0].content.parts[0].text.trim();

        displayTranslatedResults(translatedText);
    }

    function displayTranslatedResults(text) {
        translatedScriptTextarea.value = text;

        // Parse translated text and merge into existing dialogues
        const lines = text.split('\n').filter(Boolean);
        const regex = /\[speaker_\w+\]\[\d{2}:\d{2}-\d{2}:\d{2}\]:\s*(.*)/;
        
        let dialogueIndex = 0;
        lines.forEach(line => {
            const match = line.match(regex);
            if (match && window.dialogues[dialogueIndex]) {
                let transText = match[1].trim();
                
                // Extract emotion if present: (joy) Hello -> emotion: joy, text: Hello
                const emotionMatch = transText.match(/^\(([^)]+)\)\s*(.*)/);
                if (emotionMatch) {
                    window.dialogues[dialogueIndex].emotion = emotionMatch[1];
                    window.dialogues[dialogueIndex].translatedText = emotionMatch[2];
                } else {
                    window.dialogues[dialogueIndex].translatedText = transText;
                }
                dialogueIndex++;
            }
        });

        renderDialogueCards();
        btnNextStep4.disabled = false;

        // 번역이 끝나면 첫 대사부터 확인할 수 있도록 이동
        requestAnimationFrame(() => {
            const editor = document.getElementById('dialogue-editor');
            if (editor) editor.scrollTop = 0;
            const controls = document.querySelector('.translation-controls');
            if (controls) controls.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        
        // Ensure legacy variable and textarea are updated
        updateLegacyTextarea();
        
        // Use updated dialogues instead of raw text
        injectWebVTTFromDialogues();
    }

    function renderDialogueCards() {
        if (!dialogueEditor) return;
        
        if (!window.dialogues || window.dialogues.length === 0) {
            dialogueEditor.innerHTML = '<div class="empty-state"><span>📝</span><p>출력된 스크립트가 없습니다.</p></div>';
            return;
        }

        dialogueEditor.innerHTML = '';
        window.dialogues.forEach((dlg, index) => {
            const card = document.createElement('div');
            card.className = 'dialogue-card';
            card.innerHTML = `
                <div class="card-speaker">
                    <span class="speaker-id">${dlg.speaker}</span>
                    <span class="speaker-time">${dlg.startTime}-${dlg.endTime}</span>
                    <div class="card-actions">
                        <div class="waveform-icon">
                            <div class="waveform-bar"></div>
                            <div class="waveform-bar"></div>
                            <div class="waveform-bar"></div>
                            <div class="waveform-bar"></div>
                        </div>
                        <button class="card-play-btn" data-index="${index}" title="개별 재생">
                            <span class="play-icon">▶</span>
                        </button>
                    </div>
                </div>
                <div class="card-content">
                    <div class="content-block">
                        <label>원문</label>
                        <div class="original-text">${dlg.originalText}</div>
                    </div>
                    <div class="content-block" style="position: relative;">
                        <label>번역 <span class="label-hint">클릭해 수정</span></label>
                        <div contenteditable="true" class="editable-text translated-text" data-index="${index}">${dlg.translatedText || '...'}</div>
                        <div class="sync-indicator hidden" id="sync-ind-${index}">
                            <span class="spinner-small"></span>
                            <span>음성 재생성 중</span>
                        </div>
                    </div>
                </div>
                ${dlg.emotion ? `<div class="emotion-tag">(${dlg.emotion})</div>` : ''}
            `;
            
            // Sync edits back to state and VTT
            const editable = card.querySelector('.translated-text');
            let originalCardText = dlg.translatedText;

            editable.addEventListener('input', (e) => {
                const idx = e.target.dataset.index;
                window.dialogues[idx].translatedText = e.target.innerText;
                injectWebVTTFromDialogues(); // Real-time preview update
                updateLegacyTextarea(); // Keep legacy textarea in sync
            });

            // Individual Audio Playback
            const playBtn = card.querySelector('.card-play-btn');
            playBtn.addEventListener('click', () => {
                // Stop everything first
                videoPreview.pause();
                const audios = document.querySelectorAll('.playlist-audio');
                audios.forEach(a => { a.pause(); a.currentTime = 0; });
                
                // Disable sequential/synced triggers
                window.isSequentialMode = false;
                videoPreview.ontimeupdate = null; 

                audios.forEach(aud => {
                    if (parseInt(aud.dataset.index, 10) === index) {
                        // Play only this audio
                        aud.currentTime = 0;
                        aud.play();
                        
                        // Jump video to this time
                        const timeParts = dlg.startTime.split(':');
                        const startTimeSec = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
                        videoPreview.currentTime = startTimeSec;
                        
                        // Visual feedback on card
                        card.style.borderColor = "var(--primary)";
                        setTimeout(() => card.style.borderColor = "transparent", 2000);
                    }
                });
            });

            // Automatic Audio Sync on Blur
            editable.addEventListener('blur', async (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                const currentText = e.target.innerText;
                
                // Only re-generate if text actually changed and audio exists
                if (currentText !== originalCardText && window.generatedAudioBlobs && window.generatedAudioBlobs[idx]) {
                    originalCardText = currentText;
                    await regenerateSingleAudio(idx);
                }
            });
            
            dialogueEditor.appendChild(card);
        });
    }

    async function regenerateSingleAudio(index) {
        const dlg = window.dialogues[index];
        const indicator = document.getElementById(`sync-ind-${index}`);
        if (!dlg.translatedText) return;

        // Show syncing state
        if (indicator) indicator.classList.remove('hidden');
        
        try {
            // Find voice mapping for this speaker
            const selects = document.querySelectorAll('.speaker-voice-select');
            let voiceId = availableVoices[0]?.voice_id;
            selects.forEach(s => {
                if (s.dataset.speaker === dlg.speaker && s.value) {
                    voiceId = s.value;
                }
            });
            if (!voiceId) {
                alert('사용 가능한 보이스가 없습니다. ElevenLabs 계정의 보이스를 확인해 주세요.');
                return;
            }

            const textForTTS = dlg.translatedText.replace(/\(.*?\)/g, '').trim();
            const { audioUrl, blob } = await generateSpeechWithElevenLabs(textForTTS, voiceId);

            // Update global state
            if (window.generatedAudioBlobs && window.generatedAudioBlobs[index]) {
                window.generatedAudioBlobs[index].blob = blob;
                
                // Update specific audio element and its label in the playlist
                const audios = document.querySelectorAll('.playlist-audio');
                audios.forEach(aud => {
                    if (parseInt(aud.dataset.index, 10) === index) {
                        aud.src = audioUrl;
                        
                        // Update text label above audio
                        const label = document.querySelector(`.playlist-label[data-index="${index}"]`);
                        if (label) {
                            label.innerHTML = `<b>[${dlg.speaker}]</b> ${dlg.translatedText} <span class="playlist-range">${dlg.startTime}초 ~ ${dlg.endTime}초</span>`;
                        }

                        // Briefly highlight to show sync success
                        aud.parentElement.style.boxShadow = "0 0 10px var(--success)";
                        setTimeout(() => aud.parentElement.style.boxShadow = "none", 1000);
                    }
                });
            }
        } catch (error) {
            console.error('Single Audio Sync Error:', error);
        } finally {
            if (indicator) indicator.classList.add('hidden');
        }
    }

    // Keep legacy hidden textareas updated for any other dependency
    function updateLegacyTextarea() {
        if (!window.dialogues) return;
        let trans = "";
        window.dialogues.forEach(d => {
            const emotionStr = d.emotion ? `(${d.emotion}) ` : "";
            trans += `[${d.speaker}][${d.startTime}-${d.endTime}]: ${emotionStr}${d.translatedText}\n`;
        });
        window.translatedScript = trans.trim();
        translatedScriptTextarea.value = trans.trim();
    }

    function injectWebVTTFromDialogues() {
        if (!window.dialogues) return;
        let vtt = "WEBVTT\n\n";
        
        window.dialogues.forEach((dlg, index) => {
            const formatTime = (timeStr) => {
                const parts = timeStr.split(':');
                return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}.000`;
            };
            
            const start = formatTime(dlg.startTime);
            const end = formatTime(dlg.endTime);
            let text = dlg.translatedText.trim() || "...";
            // 자막 한 줄이 길면 가운데에서 나눠 최대 두 줄로 표시
            if (text.length > 34) {
                const mid = text.lastIndexOf(' ', Math.ceil(text.length / 2));
                if (mid > 0) text = text.slice(0, mid) + '\n' + text.slice(mid + 1);
            }

            vtt += `${index + 1}\n${start} --> ${end} line:88%\n${text}\n\n`;
        });

        // Inject logic...
        Array.from(videoPreview.getElementsByTagName('track')).forEach(t => t.remove());
        const vttBlob = new Blob([vtt], { type: 'text/vtt' });
        const vttUrl = URL.createObjectURL(vttBlob);
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.srclang = 'ko';
        track.src = vttUrl;
        track.default = true;
        videoPreview.appendChild(track);
        setTimeout(() => { if (videoPreview.textTracks[0]) videoPreview.textTracks[0].mode = 'showing'; }, 100);
    }

    function renderSegmentsTimeline() {
        const timeline = document.getElementById('segments-timeline');
        if (!timeline || !videoPreview.duration || !window.dialogues) return;
        
        timeline.innerHTML = '';
        const duration = videoPreview.duration;

        window.dialogues.forEach((dlg, idx) => {
            const parseTime = (str) => {
                const parts = str.split(':');
                return parseInt(parts[0]) * 60 + parseInt(parts[1]);
            };
            const start = parseTime(dlg.startTime);
            const end = parseTime(dlg.endTime);
            
            const left = (start / duration) * 100;
            const width = ((end - start) / duration) * 100;
            
            const seg = document.createElement('div');
            seg.className = 'timeline-segment';
            seg.style.left = `${left}%`;
            seg.style.width = `${width}%`;
            seg.dataset.index = idx;
            seg.title = `[${dlg.speaker}] ${dlg.startTime}-${dlg.endTime}`;
            
            seg.onclick = () => {
                // Stop any playing audio before jumping
                document.querySelectorAll('.playlist-audio').forEach(a => { a.pause(); a.currentTime = 0; });
                videoPreview.currentTime = start;
                // Highlight corresponding card
                const cards = document.querySelectorAll('.dialogue-card');
                cards.forEach(c => c.classList.remove('active-playing'));
                const targetCard = cards[idx];
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetCard.style.borderColor = "var(--primary)";
                    setTimeout(() => targetCard.style.borderColor = "transparent", 2000);
                }
            };
            
            timeline.appendChild(seg);
        });
    }




    function generateSRT() {
        if (!window.dialogues) return "";
        let srt = "";
        window.dialogues.forEach((dlg, index) => {
            const formatTimeSRT = (timeStr) => {
                const parts = timeStr.split(':');
                return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')},000`;
            };
            const start = formatTimeSRT(dlg.startTime);
            const end = formatTimeSRT(dlg.endTime);
            const text = dlg.translatedText.trim() || "...";
            srt += `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
        });
        return srt;
    }

    // --- AI Dubbing Logic (Step 4) ---
    const dubbingSection = document.getElementById('dubbing-section');
    const step4Nav = document.getElementById('step-4-nav');
    const btnGenerateDubbing = document.getElementById('btn-generate-dubbing');
    const dynamicVoiceSelectors = document.getElementById('dynamic-voice-selectors');
    const audioResultContainer = document.getElementById('audio-result-container');
    const playlistContainer = document.getElementById('playlist-container');

    // 계정에서 실제 사용 가능한 보이스를 서버에서 불러옵니다.
    // (무료 등급은 라이브러리 보이스를 API로 쓸 수 없어, 계정 보유 목록을 기준으로 합니다)
    let availableVoices = [];

    async function loadVoices() {
        if (availableVoices.length > 0) return availableVoices;
        try {
            const res = await fetch('/api/voices');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '보이스 목록 오류');
            availableVoices = data.voices || [];
        } catch (err) {
            console.error('보이스 목록을 불러오지 못했습니다:', err);
            availableVoices = [];
        }
        return availableVoices;
    }

    function buildVoiceOptions() {
        if (availableVoices.length === 0) {
            return '<option value="">사용 가능한 보이스가 없습니다</option>';
        }
        return availableVoices.map((v) => {
            const desc = [v.labels?.gender, v.labels?.accent, v.labels?.description]
                .filter(Boolean).join('/');
            return `<option value="${v.voice_id}">${v.name}${desc ? ` (${desc})` : ''}</option>`;
        }).join('');
    }

    async function generateVoiceSelectors() {
        if (!window.dialogues || window.dialogues.length === 0) return;
        await loadVoices();
        
        const speakers = new Set();
        window.dialogues.forEach(d => speakers.add(d.speaker));
        
        dynamicVoiceSelectors.innerHTML = '';
        speakers.forEach(speaker => {
            const html = `
                <div style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem;">
                    <span style="font-weight: bold; color: var(--primary); width: 100px;">${speaker}</span>
                    <select class="premium-input speaker-voice-select" data-speaker="${speaker}" style="flex: 1;">
                        ${buildVoiceOptions()}
                    </select>
                </div>
            `;
            dynamicVoiceSelectors.insertAdjacentHTML('beforeend', html);
        });
    }

    btnNextStep4.addEventListener('click', () => {
        goToStep(3);
        generateVoiceSelectors();
    });





    btnGenerateDubbing.addEventListener('click', async () => {

        if (!window.dialogues || window.dialogues.length === 0) {
            alert('합성할 번역된 스크립트가 없습니다.');
            return;
        }

        const voiceMapping = {};
        const selects = document.querySelectorAll('.speaker-voice-select');
        selects.forEach(select => {
            const speaker = select.dataset.speaker;
            voiceMapping[speaker] = select.value || availableVoices[0]?.voice_id;
        });

        // Use structured dialogues for TTS
        const lines = window.dialogues.map(d => {
            const parseTime = (str) => {
                const parts = str.split(':');
                return parseInt(parts[0]) * 60 + parseInt(parts[1]);
            };
            return {
                speaker: d.speaker,
                text: d.translatedText,
                start: parseTime(d.startTime),
                end: parseTime(d.endTime),
                emotion: d.emotion
            };
        });
        
        if (lines.length === 0) {
            alert('합성할 대사 내용이 없습니다.');
            return;
        }

        const originalBtnText = btnGenerateDubbing.innerHTML;
        btnGenerateDubbing.disabled = true;
        btnGenerateDubbing.innerHTML = `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px; display: inline-block; margin-right: 8px; vertical-align: middle;"></span> 오디오 생성 중...`;

        playlistContainer.innerHTML = '';
        audioResultContainer.classList.remove('hidden');
        placeVideoForStep(3);
        loadingOverlay.classList.remove('hidden');

        try {
            for (let i = 0; i < lines.length; i++) {
                 loadingText.textContent = '대사를 음성으로 만들고 있습니다';
                 setProgress(i, lines.length);
                 const { speaker, text, start, end } = lines[i];
                 const voiceId = voiceMapping[speaker];
                 
                // Remove bracketed emotion tags just before sending to TTS
                 const textForTTS = text.replace(/\(.*?\)/g, '').trim();
                 
                 const { audioUrl, blob } = await generateSpeechWithElevenLabs(textForTTS, voiceId);
                 
                 if (!window.generatedAudioBlobs) window.generatedAudioBlobs = [];
                 window.generatedAudioBlobs.push({ start, end, blob });

                 const audioHtml = `
                     <div class="playlist-item">
                         <span class="playlist-label" data-index="${i}"><b>[${speaker}]</b> ${text} <span class="playlist-range">${start}초 ~ ${end}초</span></span>
                         <audio controls src="${audioUrl}" class="playlist-audio" data-start="${start}" data-end="${end}" data-index="${i}"></audio>
                     </div>
                 `;
                 playlistContainer.insertAdjacentHTML('beforeend', audioHtml);
                 setProgress(i + 1, lines.length);
            }

            setupSequentialPlayback();

            // 합성이 끝나면 결과가 바로 보이도록 이동
            requestAnimationFrame(() => {
                audioResultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            
        } catch (error) {
            console.error('TTS Error:', error);
            alert(friendlyError('음성을 만들지 못했습니다.', error));
        } finally {
            loadingOverlay.classList.add('hidden');
            btnGenerateDubbing.disabled = false;
            btnGenerateDubbing.innerHTML = originalBtnText;
            loadingText.textContent = '영상을 분석하고 있습니다...';
            setProgress(0, 0);
        }
    });

    async function generateSpeechWithElevenLabs(text, voiceId) {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voiceId })
        });

        if (!response.ok) {
            const errResult = await response.json().catch(() => ({}));
            if (response.status === 413) {
                throw new Error('오디오 용량이 서버 한도를 넘었습니다. 더 짧은 영상으로 시도해 주세요.');
            }
            throw new Error(errResult.error || errResult.detail?.message || `요청 실패 (status: ${response.status})`);
        }

        const blob = await response.blob();
        return { audioUrl: URL.createObjectURL(blob), blob };
    }

    function setupSequentialPlayback() {
        const audios = document.querySelectorAll('.playlist-audio');
        for (let i = 0; i < audios.length - 1; i++) {
            audios[i].onended = () => {
                if (window.isSequentialMode && (!videoPreview.currentTime || videoPreview.paused)) {
                    audios[i+1].play();
                }
            };
        }
    }

    // --- Sync Video & Dubbing Logic ---
    // 병합된 영상을 결과 칸의 플레이어에 그대로 띄웁니다.
    // 파일을 내려받아 따로 열어보지 않아도 적용 결과를 확인할 수 있습니다.
    function showMergedResult(blob) {
        const result = document.getElementById('audio-result-container');
        if (!videoPreview || !result) return;

        // 원본 재생 상태 정리
        videoPreview.ontimeupdate = null;
        window.isSyncPlaying = false;
        document.querySelectorAll('.playlist-audio').forEach(a => { a.pause(); a.currentTime = 0; });

        if (!window.originalVideoUrl) window.originalVideoUrl = videoPreview.src;
        if (window.mergedVideoUrl) URL.revokeObjectURL(window.mergedVideoUrl);
        window.mergedVideoUrl = URL.createObjectURL(blob);

        // 자막은 영상에 구워져 있으므로 별도 트랙을 걷어냅니다
        Array.from(videoPreview.getElementsByTagName('track')).forEach(t => t.remove());
        videoPreview.src = window.mergedVideoUrl;
        videoPreview.muted = false;
        videoPreview.currentTime = 0;
        videoPreview.play().catch(() => {});

        renderMergedNotice(result);
        videoPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function renderMergedNotice(result) {
        let notice = document.getElementById('merged-notice');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'merged-notice';
            notice.className = 'merged-notice';
            const title = result.querySelector('.result-title');
            result.insertBefore(notice, title ? title.nextSibling : result.firstChild);
        }
        notice.innerHTML = `
            <span class="merged-label">더빙 음성과 자막이 입혀진 영상입니다</span>
            <span class="merged-buttons">
                <button type="button" class="btn btn-secondary" id="btn-show-original">원본 보기</button>
                <button type="button" class="btn btn-primary" id="btn-save-merged">MP4 저장</button>
            </span>
        `;
        notice.classList.remove('hidden');

        document.getElementById('btn-save-merged').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = window.mergedVideoUrl;
            a.download = 'ai-dubbing-result.mp4';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        document.getElementById('btn-show-original').addEventListener('click', () => restoreOriginalVideo());
    }

    function restoreOriginalVideo() {
        if (!videoPreview || !window.originalVideoUrl) return;
        videoPreview.pause();
        videoPreview.src = window.originalVideoUrl;
        videoPreview.muted = false;
        injectWebVTTFromDialogues();
        const notice = document.getElementById('merged-notice');
        if (notice) notice.classList.add('hidden');
    }

    const btnPlaySyncedVideo = document.getElementById('btn-play-synced-video');

    if (btnPlaySyncedVideo) {
        btnPlaySyncedVideo.addEventListener('click', () => {
            console.log("Auto Play button clicked");
            if (!videoPreview || !videoPreview.src || videoPreview.src === window.location.href) {
                console.warn("Video source missing or invalid:", videoPreview?.src);
                alert('원본 영상 파일이 제대로 등록되지 않았습니다.');
                return;
            }

            const audios = Array.from(document.querySelectorAll('.playlist-audio'));
            if (audios.length === 0) {
                console.warn("No audio clips found for sync playback");
                alert('재생할 합성된 음성이 없습니다.');
                return;
            }

            // 결과 칸 안의 플레이어로 부드럽게 이동
            videoPreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Reset state
            audios.forEach(a => {
                a.pause();
                a.currentTime = 0;
                a.dataset.played = "false";
            });

            // Prepare Video
            videoPreview.muted = true;
            videoPreview.currentTime = 0;
            
            // Start Video with promise handling
            videoPreview.play().then(() => {
                console.log("Video playback started successfully");
                window.isSequentialMode = true;
                window.isSyncPlaying = true;

                // Sync Audios
                videoPreview.ontimeupdate = () => {
                    const currentVideoTime = videoPreview.currentTime;
                    audios.forEach((audio, index) => {
                        const startTime = parseFloat(audio.dataset.start);
                        const endTime = parseFloat(audio.dataset.end);
                        if (audio.dataset.played === "false" && currentVideoTime >= startTime) {
                            audio.dataset.played = "true";
                            
                            let timeWindow = endTime - startTime;
                            if (timeWindow <= 0 && index < audios.length - 1) {
                                timeWindow = parseFloat(audios[index+1].dataset.start) - startTime;
                            }
                            if (timeWindow <= 0) timeWindow = Infinity;
                            
                            const originalDuration = audio.duration || 0;
                            if (originalDuration > 0 && originalDuration > timeWindow) {
                                let requiredSpeed = originalDuration / timeWindow;
                                requiredSpeed = Math.min(requiredSpeed, 1.5); 
                                audio.playbackRate = requiredSpeed;
                            } else {
                                audio.playbackRate = 1.0;
                            }

                            audio.play().catch(e => console.error(`[Audio ${index}] Play error:`, e));
                        }
                    });

                    updateActiveDialogueCard(currentVideoTime);
                };
            }).catch(error => {
                console.error("Video playback failed:", error);
                alert("영상을 재생할 수 없습니다. 브라우저의 자동 재생 차단 설정을 확인하거나 영상을 다시 클릭해 주세요.");
            });

            videoPreview.onpause = () => {
                window.isSequentialMode = false;
                window.isSyncPlaying = false;
                audios.forEach(a => { if(!a.paused) a.pause() });
            };

            videoPreview.onended = () => {
                window.isSequentialMode = false;
                window.isSyncPlaying = false;
                audios.forEach(a => a.pause());
                videoPreview.ontimeupdate = null;
            };
        });
    }


            if (btnDownloadSrt) {
                btnDownloadSrt.onclick = () => {
                    const srtContent = generateSRT();
                    if (!srtContent) {
                        alert('저장할 자막 내용이 없습니다.');
                        return;
                    }
                    const blob = new Blob([srtContent], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'translated_subtitles.srt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                };
            }

    // --- Backend Muxing Logic (Step 6) ---
    const btnDownloadVideo = document.getElementById('btn-download-video');
    if (btnDownloadVideo) {
        btnDownloadVideo.addEventListener('click', async () => {
            if (!currentVideoFile) {
                alert('업로드된 원본 비디오 파일이 없습니다.');
                return;
            }
            if (!window.generatedAudioBlobs || window.generatedAudioBlobs.length === 0) {
                alert('먼저 오디오를 합성해주세요.');
                return;
            }

            const audios = Array.from(document.querySelectorAll('.playlist-audio'));
            if (audios.length === 0) return;

            const originalBtnText = btnDownloadVideo.innerHTML;
            btnDownloadVideo.disabled = true;
            btnDownloadVideo.innerHTML = `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px; display: inline-block; margin-right: 8px; vertical-align: middle;"></span> 서버에서 영상 렌더링 중... (최대 수 분 소요)`;

            // Pre-calculate playbackRates identical to the sync logic
            const config = [];
            audios.forEach((audio, index) => {
                const startTime = parseFloat(audio.dataset.start);
                const endTime = parseFloat(audio.dataset.end);
                const audioIndex = parseInt(audio.dataset.index, 10);
                
                let timeWindow = endTime - startTime;
                if (timeWindow <= 0 && index < audios.length - 1) {
                    timeWindow = parseFloat(audios[index+1].dataset.start) - startTime;
                }
                if (timeWindow <= 0) timeWindow = Infinity;
                
                let requiredSpeed = 1.0;
                const originalDuration = audio.duration || 0;
                if (originalDuration > 0 && originalDuration > timeWindow) {
                    requiredSpeed = originalDuration / timeWindow;
                    requiredSpeed = Math.min(requiredSpeed, 1.5); 
                }

                config.push({
                    audioIndex: audioIndex,
                    startTime: startTime,
                    playbackRate: requiredSpeed
                });
            });

            // Build FormData
            const formData = new FormData();
            formData.append('video', currentVideoFile);
            formData.append('config', JSON.stringify(config));
            
            // Send subtitles for burn-in
            const srtContent = generateSRT();
            if (srtContent) {
                formData.append('subtitles', srtContent);
            }

            window.generatedAudioBlobs.forEach((item, index) => {
                formData.append(`audio_${index}`, item.blob, `audio_${index}.mp3`);
            });

            try {
                const response = await fetch('/api/merge-video', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const errResult = await response.json().catch(() => ({}));
                    throw new Error(errResult.error || 'Server error during video merging');
                }

                // 병합 결과를 같은 자리에서 바로 재생합니다
                const blob = await response.blob();
                showMergedResult(blob);

            } catch (err) {
                console.error('Muxing error:', err);
                alert(friendlyError('영상 병합에 실패했습니다.', err));
            } finally {
                btnDownloadVideo.disabled = false;
                btnDownloadVideo.innerHTML = originalBtnText;
            }
        });
    }

    // --- UX Enhancement Functions ---

    function parseTime(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        }
        return parseFloat(timeStr) || 0;
    }

    function renderSkeletonCards() {
        if (!dialogueEditor) return;
        let skeletons = '';
        for(let i=0; i<5; i++) {
            skeletons += `
                <div class="skeleton-card">
                    <div class="skeleton-line short"></div>
                    <div class="skeleton-line full"></div>
                    <div class="skeleton-line full"></div>
                    <div class="skeleton-line medium" style="margin-top: 20px;"></div>
                    <div class="skeleton-line full"></div>
                </div>
            `;
        }
        dialogueEditor.innerHTML = skeletons;
    }

    function updateActiveDialogueCard(currentTime) {
        if (!window.dialogues || !dialogueEditor) return;

        const cards = dialogueEditor.querySelectorAll('.dialogue-card');
        let activeFound = false;

        window.dialogues.forEach((dlg, index) => {
            const card = cards[index];
            if (!card) return;

            const start = parseTime(dlg.startTime);
            const end = parseTime(dlg.endTime);

            if (currentTime >= start && currentTime < end) {
                if (!card.classList.contains('active')) {
                    // Remove active from others
                    cards.forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    
                    // Smooth Auto-Scroll within the right column
                    // We use block: 'center' to keep it visible next to the video
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                activeFound = true;
            }
        });

        // If no active dialogue found in current time, clear highlights
        if (!activeFound) {
            cards.forEach(c => c.classList.remove('active'));
        }
    }

    // Register a persistent timeupdate listener for manual playback/scrubbing
    videoPreview.addEventListener('timeupdate', () => {
        // Only run this if we are NOT in synced playback mode (to avoid double work)
        // or just run it always if updateActiveDialogueCard is efficient
        if (!window.isSyncPlaying) { // Flag we might want to toggle in btnPlaySyncedVideo
             updateActiveDialogueCard(videoPreview.currentTime);
        }
    });

    // Note: I'll use window.isSyncPlaying to prevent double logic in btnPlaySyncedVideo

    // 최초 진입
    goToStep(1);
});
