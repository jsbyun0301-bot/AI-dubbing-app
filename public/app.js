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
        const container = document.getElementById('step-content');
        if (container) container.classList.add('studio-mode');
        
        videoPreview.src = URL.createObjectURL(file);
        videoPreviewContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
        analysisResults.classList.add('hidden');
        btnNextStep3.disabled = true;
    }

    // Remove video
    btnRemoveVideo.addEventListener('click', () => {
        currentVideoFile = null;
        videoPreview.src = '';
        dropZone.classList.remove('hidden');
        videoPreviewContainer.classList.add('hidden');
        analysisResults.classList.add('hidden');
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
            alert(`스크립트 추출 중 오류가 발생했습니다: ${error.message}`);
            dialogueEditor.innerHTML = ''; // Clear skeletons on error
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    });

    async function extractScriptWithElevenLabs(file) {
        // Create FormData to send the file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model_id', 'scribe_v1'); // Using scribe_v1 for diarization
        formData.append('diarize', 'true'); // Enable speaker diarization
        formData.append('tag_audio_events', 'false');

        const response = await fetch('/api/stt', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errResult = await response.json().catch(() => ({}));
            throw new Error(errResult.detail?.message || `HTTP error! status: ${response.status}`);
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

        data.words.forEach((wordObj) => {
            if (wordObj.speaker_id === currentSpeaker) {
                currentSentence += wordObj.text + " ";
                currentEnd = wordObj.end || currentEnd; // Keep track of the last word's end time
            } else {
                // Speaker changed, append previous sentence
                window.originalBlocks.push({ speaker: currentSpeaker, start: currentStart, end: currentEnd, text: currentSentence.trim() });
                formattedScript += `[${currentSpeaker}][${formatTime(currentStart)}-${formatTime(currentEnd)}]: ${currentSentence.trim()}\n\n`;
                // Start new sentence for new speaker
                currentSpeaker = wordObj.speaker_id;
                currentSentence = wordObj.text + " ";
                currentStart = wordObj.start || 0;
                currentEnd = wordObj.end || 0;
            }
        });

        // Append the last sentence
        if (currentSentence) {
            window.originalBlocks.push({ speaker: currentSpeaker, start: currentStart, end: currentEnd, text: currentSentence.trim() });
            formattedScript += `[${currentSpeaker}][${formatTime(currentStart)}-${formatTime(currentEnd)}]: ${currentSentence.trim()}`;
        }

        return formattedScript;
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

        // Show translation section
        translationSection.classList.remove('hidden');

        // Update UI Step Indicators to Step 3
        if (step2Nav) {
            step2Nav.classList.remove('active');
            step2Nav.style.opacity = '0.5';
        }
        if (step3Nav) {
            step3Nav.classList.add('active');
            step3Nav.style.opacity = '1';
        }
        if (mainHeader) {
            mainHeader.textContent = "3단계: 추출된 스크립트 다국어 번역";
        }

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
            alert(`번역 중 오류가 발생했습니다: ${error.message}`);
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
                        <label>Original</label>
                        <div class="original-text">${dlg.originalText}</div>
                    </div>
                    <div class="content-block" style="position: relative;">
                        <label>Translated (Click to edit)</label>
                        <div contenteditable="true" class="editable-text translated-text" data-index="${index}">${dlg.translatedText || '...'}</div>
                        <div class="sync-indicator hidden" id="sync-ind-${index}">
                            <span class="spinner-small"></span>
                            <span>Syncing audio...</span>
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
            let voiceId = VOICE_IDS['Rachel'];
            selects.forEach(s => {
                if (s.dataset.speaker === dlg.speaker) {
                    voiceId = VOICE_IDS[s.value] || voiceId;
                }
            });

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
                            label.innerHTML = `<b>[${dlg.speaker}]</b> ${dlg.translatedText} <span style="font-size: 0.8em; color: var(--accent);">(구간: ${dlg.startTime}초 ~ ${dlg.endTime}초)</span>`;
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
            const text = dlg.translatedText.trim() || "...";
            
            vtt += `${index + 1}\n${start} --> ${end} line:92%\n${text}\n\n`;
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
                    targetCard.style.borderColor = "var(--accent)";
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

    const VOICE_OPTIONS_HTML = `
        <option value="Rachel">Rachel (여성/미국/차분한)</option>
        <option value="Domi">Domi (여성/미국/강인한)</option>
        <option value="Adam">Adam (남성/미국/나레이션)</option>
        <option value="Antoni">Antoni (남성/미국/청년)</option>
        <option value="Arnold">Arnold (남성/미국/깊은)</option>
        <option value="Alice">Alice (여성/영국/신뢰감있는)</option>
        <option value="Brian">Brian (남성/미국/중저음)</option>
        <option value="Daniel">Daniel (남성/영국/뉴스)</option>
    `;




    function generateVoiceSelectors() {
        if (!window.dialogues || window.dialogues.length === 0) return;
        
        const speakers = new Set();
        window.dialogues.forEach(d => speakers.add(d.speaker));
        
        dynamicVoiceSelectors.innerHTML = '';
        speakers.forEach(speaker => {
            const html = `
                <div style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem;">
                    <span style="font-weight: bold; color: var(--primary); width: 100px;">${speaker}</span>
                    <select class="premium-input speaker-voice-select" data-speaker="${speaker}" style="flex: 1;">
                        ${VOICE_OPTIONS_HTML}
                    </select>
                </div>
            `;
            dynamicVoiceSelectors.insertAdjacentHTML('beforeend', html);
        });
    }

    btnNextStep4.addEventListener('click', () => {
        dubbingSection.classList.remove('hidden');
        if (step3Nav) {
            step3Nav.classList.remove('active');
            step3Nav.style.opacity = '0.5';
        }
        if (step4Nav) {
            step4Nav.classList.add('active');
            step4Nav.style.opacity = '1';
        }
        if (mainHeader) {
            mainHeader.textContent = "4단계: AI 음성 더빙 합성 (ElevenLabs TTS)";
        }
        generateVoiceSelectors();
    });

    // Voice mapping for ElevenLabs guaranteed 'Pre-made' voices (Free Tier safe)
    const VOICE_IDS = {
        'Rachel': '21m00Tcm4TlvDq8ikWAM',
        'Domi': 'AZn7nNTGLFEHrlPLW9u5',
        'Adam': 'pNInz6obpgDQGcFmaJgB',
        'Antoni': 'ErXwobaYiN019PkySvjV',
        'Arnold': 'VR6AewLTigWG4xSOukaG',
        'Alice': 'Xb7hH8MSUJpSbSDYk0k2',
        'Brian': 'nPczCjzI2devNBz1zQrb',
        'Daniel': 'onwK4e9ZLuTAKqWW03F9'
    };




    btnGenerateDubbing.addEventListener('click', async () => {

        if (!window.dialogues || window.dialogues.length === 0) {
            alert('합성할 번역된 스크립트가 없습니다.');
            return;
        }

        const voiceMapping = {};
        const selects = document.querySelectorAll('.speaker-voice-select');
        selects.forEach(select => {
            const speaker = select.dataset.speaker;
            voiceMapping[speaker] = VOICE_IDS[select.value] || VOICE_IDS['Rachel'];
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
        loadingOverlay.classList.remove('hidden');

        try {
            for (let i = 0; i < lines.length; i++) {
                 loadingText.textContent = `총 ${lines.length}개의 대사 중 ${i+1}번째 대사 합성 중...`;
                 const { speaker, text, start, end } = lines[i];
                 const voiceId = voiceMapping[speaker];
                 
                // Remove bracketed emotion tags just before sending to TTS
                 const textForTTS = text.replace(/\(.*?\)/g, '').trim();
                 
                 const { audioUrl, blob } = await generateSpeechWithElevenLabs(textForTTS, voiceId);
                 
                 if (!window.generatedAudioBlobs) window.generatedAudioBlobs = [];
                 window.generatedAudioBlobs.push({ start, end, blob });

                 const audioHtml = `
                     <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px;">
                         <span class="playlist-label" data-index="${i}" style="font-size: 0.9rem; color: #ccc;"><b>[${speaker}]</b> ${text} <span style="font-size: 0.8em; color: var(--accent);">(구간: ${start}초 ~ ${end}초)</span></span>
                         <audio controls src="${audioUrl}" class="playlist-audio" data-start="${start}" data-end="${end}" data-index="${i}" style="width: 100%; height: 35px;"></audio>
                     </div>
                 `;
                 playlistContainer.insertAdjacentHTML('beforeend', audioHtml);
            }
            
            setupSequentialPlayback();
            
        } catch (error) {
            console.error('TTS Error:', error);
            alert(`오디오 생성 중 오류가 발생했습니다: ${error.message}`);
        } finally {
            loadingOverlay.classList.add('hidden');
            btnGenerateDubbing.disabled = false;
            btnGenerateDubbing.innerHTML = originalBtnText;
            loadingText.textContent = '영상을 분석하고 있습니다...';
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
            throw new Error(errResult.detail?.message || `HTTP error! status: ${response.status}`);
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

            // Scroll to video
            videoPreview.scrollIntoView({ behavior: 'smooth', block: 'center' });

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

                // Trigger download
                const blob = await response.blob();
                const downloadUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = 'ai-dubbing-result.mp4';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(downloadUrl);

            } catch (err) {
                console.error('Muxing error:', err);
                alert(`영상 병합 중 오류가 발생했습니다: ${err.message}`);
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
});

