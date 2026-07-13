let speechRecognition = null;
let isConverting = false;
let allTranscriptText = '';
let selectedSummaryType = null;

let audioContext = null;
let analyserNode = null;
let micStream = null;
let waveformAnimationId = null;
let currentUser = null;

// groq
const GROQ_API_KEY = KEYS.GROQ_API_KEY;

// Initialize on page load
window.onload = function() {
    initializeSpeechRecognition();
    updateAuthUI();  
};

(function() {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
        document.documentElement.setAttribute('data-theme', 'dark');
})();


function smoothScrollTo(element, duration = 900) {
    const targetY = element.getBoundingClientRect().top + window.scrollY - 20;
    const startY = window.scrollY;
    const diff = targetY - startY;
    let startTime = null;

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);
        window.scrollTo(0, startY + diff * easeInOutCubic(progress));
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// cursor-reactive
(function () {
    const el = document.querySelector('.conversion-options');
    if (!el) return;
    let tx = 0, ty = 70, cx = 0, cy = 70;

    document.addEventListener('mousemove', (e) => {
        tx = (e.clientX / window.innerWidth) * 100;
        ty = (e.clientY / window.innerHeight) * 100;
    });

    function loop() {
        cx += (tx - cx) * 0.06;
        cy += (ty - cy) * 0.06;
        el.style.setProperty('--mx', cx + '%');
        el.style.setProperty('--my', cy + '%');
        requestAnimationFrame(loop);
    }
    loop();
})();


//supabase
const SUPABASE_URL = KEYS.SUPABASE_URL;
const SUPABASE_KEY = KEYS.SUPABASE_KEY;
let supabaseClient = null;
let supabaseReady = false;

try {
    if (SUPABASE_URL.startsWith('http') && SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR_')) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        supabaseReady = true;
    } else {
        console.warn('Supabase not configured yet — replace SUPABASE_URL / SUPABASE_KEY in script.js');
    }
} catch (err) {
    console.error('Supabase failed to initialize:', err);
}

// speech
function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        speechRecognition = new SpeechRecognition();

        speechRecognition.continuous = true;
        speechRecognition.interimResults = true;
        speechRecognition.lang = 'en-US';
        speechRecognition.maxAlternatives = 1;

        return true;
    }
    return false;
}

function showAlert(message, type = 'info') {
    const existingAlert = document.querySelector('.alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    document.body.appendChild(alert);
    setTimeout(() => {
        if (alert.parentNode) {
            alert.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => alert.remove(), 300);
        }
    }, 4000);
}


async function startLiveConversion() {
    if (isConverting) {
        stopLiveConversion();
        return;
    }
    if (!speechRecognition && !initializeSpeechRecognition()) {
        showAlert('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.', 'error');
        return;
    }
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupWaveformAnalyser(micStream);
        allTranscriptText = '';
        speechRecognition.onstart = function() {
            isConverting = true;
            updateConversionUI(true);
            startWaveformAnimation();
            showAlert('Live conversion started! Start speaking...', 'success');
        };

        speechRecognition.onresult = function(event) {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                    allTranscriptText += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }
            updateTranscriptionDisplay(allTranscriptText, interimTranscript);
        };

        speechRecognition.onerror = function(event) {
            showAlert('Speech recognition error: ' + event.error, 'error');
            stopLiveConversion();
        };
        speechRecognition.onend = function() {
            if (isConverting) {
                setTimeout(() => {
                    if (isConverting) speechRecognition.start();
                }, 100);
            } else {
                updateConversionUI(false);
            }
        };
        speechRecognition.start();
    } catch (error) {
        showAlert('Error accessing microphone: ' + error.message, 'error');
        updateConversionUI(false);
    }
}

function stopLiveConversion() {
    isConverting = false;
    if (speechRecognition) speechRecognition.stop();
    stopWaveformAnimation();
    teardownWaveformAnalyser();
    updateConversionUI(false);
    showAlert('Live conversion stopped', 'info');
    if (allTranscriptText.trim()) saveTranscript(allTranscriptText, 'live recording');
}

function updateConversionUI(converting) {
    isConverting = converting;
    const liveConvertBtn = document.getElementById('liveConvertBtn');
    if (liveConvertBtn) {
        if (converting) {
            liveConvertBtn.textContent = 'Stop conversion';
            liveConvertBtn.classList.add('recording');
        } else {
            liveConvertBtn.textContent = 'Start live conversion';
            liveConvertBtn.classList.remove('recording');
        }
    }
}

function updateTranscriptionDisplay(finalText, interimText) {
    const resultsContent = document.getElementById('resultsContent');
    if (resultsContent) {
        const displayText = finalText + (interimText ? ` <span class="interim-text">${interimText}</span>` : '');
        resultsContent.innerHTML = `
            <div class="transcript-content">
                <div class="transcript-text">
                    ${displayText || '<span class="interim-text">Start speaking to see transcription...</span>'}
                </div>
                ${finalText ? `
                <div class="action-buttons">
                    <button class="btn btn-primary" onclick="copyTranscript()">Copy text</button>
                    <button class="btn btn-secondary" onclick="downloadTranscript()">Download</button>
                    <button class="btn btn-secondary" onclick="clearResults()">Clear</button>
                </div>
                ` : ''}
            </div>
        `;
    }
}


function setupWaveformAnalyser(stream) {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 64;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyserNode);
    } catch (error) {
        analyserNode = null;
    }
}

function teardownWaveformAnalyser() {
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    analyserNode = null;
}

function startWaveformAnimation() {
    const waveformEl = document.getElementById('waveform');
    const bars = document.querySelectorAll('.waveform-bar');
    if (!waveformEl || bars.length === 0) return;
    waveformEl.classList.add('active');
    if (!analyserNode) return;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    function draw() {
        analyserNode.getByteFrequencyData(dataArray);
        bars.forEach((bar, i) => {
            const dataIndex = Math.floor((i / bars.length) * dataArray.length);
            const level = dataArray[dataIndex] / 255;
            const scale = Math.max(0.12, Math.min(1, level * 1.4));
            bar.style.transform = `scaleY(${scale})`;
        });
        waveformAnimationId = requestAnimationFrame(draw);
    }
    draw();
}

function stopWaveformAnimation() {
    if (waveformAnimationId) {
        cancelAnimationFrame(waveformAnimationId);
        waveformAnimationId = null;
    }
    const waveformEl = document.getElementById('waveform');
    if (waveformEl) waveformEl.classList.remove('active');
    document.querySelectorAll('.waveform-bar').forEach(bar => {
        bar.style.transform = 'scaleY(0.15)';
    });
}

async function convertAudio() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            showAlert('No file selected', 'error');
            return;
        }
        if (!file.type.startsWith('audio/')) {
            showAlert('Please select an audio file', 'error');
            return;
        }
        const resultsContent = document.getElementById('resultsContent');
        if (resultsContent) {
            resultsContent.innerHTML = `
                <div class="ai-processing">
                    <div class="ai-spinner"></div>
                    <h4>Converting audio...</h4>
                    <p>Processing: ${file.name}</p>
                    <p class="result-meta">Size: ${(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
            `;
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const mockTranscriptions = [
                "This is a sample transcription of your audio recording. The speech-to-text conversion has been completed successfully. The audio quality was excellent and all words were clearly recognized.",
                "Hello, this is a test recording for the AI Studio voice platform. The audio quality is excellent and the transcription is working well. We can process various audio formats including MP3, WAV, and M4A files.",
                "Welcome to AI Studio. This recording demonstrates the audio to text conversion feature that processes your voice recordings into readable text. The system uses advanced speech recognition technology.",
                "Today's meeting notes: We discussed the project timeline, budget allocations, and the next phase of development. All team members were present and contributed valuable insights. Action items were assigned to each department."
            ];

            const transcript = mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];
            allTranscriptText = transcript;

            displayTranscriptionResult(transcript, 0.95);
            saveTranscript(transcript, file.name);
            showAlert(`Audio file "${file.name}" converted successfully!`, 'success');

        } catch (error) {
            showAlert('Conversion failed: ' + error.message, 'error');
        }
    };
    fileInput.click();
}

function displayTranscriptionResult(transcript, confidence) {
    const resultsContent = document.getElementById('resultsContent');
    if (resultsContent) {
        resultsContent.innerHTML = `
            <div class="transcript-result">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 12px;">
                    <h3 style="color: var(--text-primary); margin: 0; font-size: 1.05rem;">Transcription complete</h3>
                    <span class="stat-chip">Confidence ${Math.round(confidence * 100)}%</span>
                </div>
                <div class="transcript-text">${transcript}</div>
                <div class="action-buttons">
                    <button class="btn btn-primary" onclick="copyTranscript()">Copy text</button>
                    <button class="btn btn-secondary" onclick="downloadTranscript()">Download</button>
                    <button class="btn btn-secondary" onclick="clearResults()">Clear</button>
                </div>
                <div class="result-meta">
                    Converted on ${new Date().toLocaleString()}
                </div>
            </div>
        `;
    }
}

function showAISummaryModal() {
    const modal = document.getElementById('aiSummaryModal');
    if (modal) {
        modal.classList.add('active');
        selectedSummaryType = null;
        document.querySelectorAll('.summary-option').forEach(option => {
            option.classList.remove('selected');
        });
        document.getElementById('textInputSection').classList.remove('active');
    }
}

function closeAISummaryModal() {
    const modal = document.getElementById('aiSummaryModal');
    if (modal) modal.classList.remove('active');
}

function selectSummaryType(type) {
    selectedSummaryType = type;
    document.querySelectorAll('.summary-option').forEach(option => {
        option.classList.remove('selected');
    });

    event.target.closest('.summary-option').classList.add('selected');
    const types = {
        'quick': 'Quick summary',
        'detailed': 'Detailed summary',
        'bulletpoints': 'Bullet points',
        'action': 'Action items'
    };

    showAlert(`${types[type]} selected. Choose your input source below.`, 'info');
}

async function summarizeFromTranscript() {
    if (!selectedSummaryType) {
        showAlert('Please select a summary type first', 'error');
        return;
    }
    if (!allTranscriptText || allTranscriptText.trim().length === 0) {
        showAlert('No transcript available. Please create a transcript first.', 'error');
        return;
    }
    closeAISummaryModal();
    await saveTranscript(allTranscriptText, 'transcript');  
    await generateSummary(allTranscriptText, 'transcript');
}

async function summarizeFromAudio() {
    if (!selectedSummaryType) {
        showAlert('Please select a summary type first', 'error');
        return;
    }
    closeAISummaryModal();
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            showAlert('No file selected', 'error');
            return;
        }
        if (!file.type.startsWith('audio/')) {
            showAlert('Please select an audio file', 'error');
            return;
        }
        showProcessingStatus(`Converting audio file: ${file.name}...`);

        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const mockTranscription = "This is a mock transcription of your audio file. The content discusses various important topics and provides valuable insights on the subject matter. Key points are covered systematically with detailed explanations and examples. The discussion includes actionable recommendations and next steps for implementation.";
            showProcessingStatus('Generating AI summary...');
            await saveTranscript(mockTranscription, `audio (${file.name})`);
            await generateSummary(mockTranscription, `audio (${file.name})`);
        } catch (error) {
            showAlert('Failed to convert audio to text: ' + error.message, 'error');
        }
    };
    fileInput.click();
}

function summarizeFromText() {
    if (!selectedSummaryType) {
        showAlert('Please select a summary type first', 'error');
        return;
    }
    document.getElementById('textInputSection').classList.add('active');
    document.getElementById('customTextInput').focus();
}

async function generateCustomTextSummary() {
    const customText = document.getElementById('customTextInput').value.trim();
    if (!customText) {
        showAlert('Please enter some text to summarize', 'error');
        return;
    }
    if (customText.length < 50) {
        showAlert('Text is too short for meaningful summarization. Please enter at least 50 characters.', 'error');
        return;
    }
    closeAISummaryModal();
    await saveTranscript(customText, 'pasted notes');
    await generateSummary(customText, 'custom');
}

async function generateSummary(inputText, sourceType) {
    if (!GROQ_API_KEY || GROQ_API_KEY === 'gsk_YOUR_FREE_GROQ_API_KEY_HERE') {
        showAlert('Please add your Groq API key in the script.js file', 'error');
        const resultsContent = document.getElementById('resultsContent');
        if (resultsContent) {
            resultsContent.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <h3 style="color: var(--text-primary); margin-bottom: 1rem;">API key setup required</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 1rem; line-height: 1.6;">
                        To use AI summarization, you need a free Groq API key:
                    </p>
                    <ol style="text-align: left; max-width: 500px; margin: 0 auto 1.5rem; color: var(--text-secondary); line-height: 1.8;">
                        <li>Go to <a href="https://console.groq.com/keys" target="_blank" style="color: var(--text-primary);">console.groq.com/keys</a></li>
                        <li>Sign up for a free account (no credit card needed!)</li>
                        <li>Create a new API key</li>
                        <li>Open your <strong>script.js</strong> file</li>
                        <li>Replace <code style="background: var(--surface-muted); padding: 2px 6px; border-radius: 3px;">gsk_YOUR_FREE_GROQ_API_KEY_HERE</code> with your actual key</li>
                    </ol>
                    <a href="https://console.groq.com/keys" target="_blank" class="btn btn-primary">Get free API key</a>
                </div>
            `;
        }
        return;
    }
    showProcessingStatus('AI is analyzing your content...');

    try {
        const summaryPrompts = {
            'quick': 'Provide a brief summary highlighting only the most important key points in 2-3 sentences.',
            'detailed': 'Provide a comprehensive and detailed summary covering all main points, context, and important details.',
            'bulletpoints': 'Summarize the content as a bulleted list of key points. Format each point clearly with bullet points (•).',
            'action': 'Extract and list all action items, tasks, decisions, and next steps from this content. Number each item clearly (1., 2., etc.).'
        };
        const prompt = `${summaryPrompts[selectedSummaryType]}\n\nContent to summarize:\n${inputText}`;
        const summaryText = await callGroqAI(prompt);
        const aiTitle = await generateMeetingTitle(inputText); 
        const summaryResult = {
            type: selectedSummaryType,
            title: aiTitle,
            content: summaryText,
            originalLength: inputText.length,
            summaryLength: summaryText.length,
            compressionRatio: Math.round((1 - summaryText.length / inputText.length) * 100)
        };
        displaySummaryResult(summaryResult, sourceType);
        saveSummary(summaryResult.content, selectedSummaryType, summaryResult.title);
        showAlert('AI summary generated successfully!', 'success');

    } catch (error) {
        console.error('AI Summary Error:', error);
        showAlert('Failed to generate summary: ' + error.message, 'error');
        const resultsContent = document.getElementById('resultsContent');
        if (resultsContent) {
            resultsContent.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <h3 style="color: var(--error); margin-bottom: 1rem;">Error</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 1rem;">${error.message}</p>
                    <p style="color: var(--text-tertiary); font-size: 0.9rem;">Please check your API key and try again</p>
                    <button class="btn btn-primary" onclick="clearResults()" style="margin-top: 1rem;">Try again</button>
                </div>
            `;
        }
    }
}

async function generateMeetingTitle(inputText) {
    try {
        const titlePrompt = `Generate a short, specific title (max 6 words) for this meeting based on its content. Return ONLY the title, no quotes, no punctuation at the end.\n\nContent:\n${inputText.slice(0, 1000)}`;
        const title = await callGroqAI(titlePrompt);
        return title.replace(/["']/g, '').trim();
    } catch {
        return getTitleForType(selectedSummaryType);   // fallback if title generation fails
    }
}

function getTitleForType(type) {
    const titles = {
        'quick': 'Quick summary',
        'detailed': 'Detailed summary',
        'bulletpoints': 'Key points',
        'action': 'Action items'
    };
    return titles[type] || 'AI summary';
}

async function callGroqAI(prompt) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that creates concise and accurate summaries. Always follow the user instructions precisely.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 1,
            stream: false
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }
    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response from AI service');
    }
    return data.choices[0].message.content.trim();
}

function generateQuickSummary(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const keyPoints = sentences.slice(0, Math.min(3, Math.ceil(sentences.length * 0.3)));
    return {
        type: 'quick',
        title: 'Quick summary',
        content: `Key points:\n\n${keyPoints.map(point => `• ${point.trim()}`).join('\n')}`,
        originalLength: text.length,
        summaryLength: keyPoints.join(' ').length,
        compressionRatio: Math.round((1 - keyPoints.join(' ').length / text.length) * 100)
    };
}

function generateDetailedSummary(text) {
    const words = text.split(' ').filter(w => w.length > 0);
    const wordCount = words.length;
    const summary = wordCount > 100 ?
        `This content provides a comprehensive discussion on the subject matter. The main themes include systematic analysis with detailed explanations and context. Key insights are presented with supporting evidence and examples throughout. The content covers various aspects methodically, providing thorough understanding of the topic with important conclusions and recommendations highlighted.` :
        `This is a detailed analysis of the provided content. ${text.substring(0, 200)}...`;
    return {
        type: 'detailed',
        title: 'Detailed summary',
        content: summary,
        originalLength: text.length,
        summaryLength: summary.length,
        compressionRatio: Math.round((1 - summary.length / text.length) * 100)
    };
}

function generateBulletPointSummary(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 15);
    const bulletPoints = sentences.slice(0, Math.min(6, sentences.length)).map(sentence =>
        sentence.trim().substring(0, 80) + (sentence.length > 80 ? '...' : '')
    );
    return {
        type: 'bulletpoints',
        title: 'Key points',
        content: bulletPoints.map(point => `• ${point}`).join('\n'),
        originalLength: text.length,
        summaryLength: bulletPoints.join(' ').length,
        compressionRatio: Math.round((1 - bulletPoints.join(' ').length / text.length) * 100)
    };
}

function generateActionItemsSummary(text) {
    const actionWords = ['should', 'need', 'must', 'will', 'plan', 'decide', 'implement', 'review', 'follow up', 'contact', 'schedule', 'complete'];
    const sentences = text.toLowerCase().split(/[.!?]+/);
    const actionSentences = sentences.filter(sentence =>
        actionWords.some(word => sentence.includes(word))
    ).slice(0, 5);
    const actions = actionSentences.length > 0 ?
        actionSentences.map((action, index) => `${index + 1}. ${action.trim().charAt(0).toUpperCase() + action.trim().slice(1)}`) :
        [
            '1. Review the main points discussed',
            '2. Follow up on key decisions made',
            '3. Schedule next steps if applicable',
            '4. Share summary with relevant stakeholders'
        ];

    return {
        type: 'action',
        title: 'Action items',
        content: actions.join('\n'),
        originalLength: text.length,
        summaryLength: actions.join(' ').length,
        compressionRatio: Math.round((1 - actions.join(' ').length / text.length) * 100)
    };
}

function displaySummaryResult(summaryResult, sourceType) {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;
    resultsContent.innerHTML = `
        <div class="summary-result">
            <div style="margin-bottom: 1.5rem;">
                <h3 style="color: var(--text-primary); margin: 0; font-size: 1.05rem;">${summaryResult.title}</h3>
            </div>
            <div class="transcript-text" style="white-space: pre-line;">
                ${summaryResult.content}
            </div>
            <div class="action-buttons">
                <button class="btn btn-primary" onclick="copySummary()">Copy summary</button>
                <button class="btn btn-secondary" onclick="downloadSummary()">Download</button>
                <button class="btn btn-secondary" onclick="clearResults()">Clear</button>
            </div>
            <div class="result-meta">
                Source: ${sourceType} &middot; Compression: ${summaryResult.compressionRatio}% &middot; ${new Date().toLocaleString()}
            </div>
        </div>
    `;
}

function showProcessingStatus(message) {
    const resultsContent = document.getElementById('resultsContent');
    if (resultsContent) {
        resultsContent.innerHTML = `
            <div class="ai-processing">
                <div class="ai-spinner"></div>
                <h4>AI processing...</h4>
                <p>${message}</p>
            </div>
        `;
    }
}

function copyTranscript() {
    const transcriptText = document.querySelector('.transcript-text')?.textContent;
    if (transcriptText) {
        navigator.clipboard.writeText(transcriptText.trim()).then(() => {
            showAlert('Transcript copied to clipboard!', 'success');
        }).catch(() => {
            showAlert('Error copying to clipboard', 'error');
        });
    }
}

function copySummary() {
    const summaryText = document.querySelector('.transcript-text')?.textContent;
    if (summaryText) {
        navigator.clipboard.writeText(summaryText.trim()).then(() => {
            showAlert('Summary copied to clipboard!', 'success');
        }).catch(() => {
            showAlert('Error copying to clipboard', 'error');
        });
    }
}

function downloadTranscript() {
    const transcriptText = document.querySelector('.transcript-text')?.textContent;
    if (transcriptText) {
        const blob = new Blob([transcriptText.trim()], { type: 'text/plain' });
        downloadFile(blob, `ai_studio_transcript_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`);
        showAlert('Transcript downloaded successfully!', 'success');
    }
}

function downloadSummary() {
    const summaryText = document.querySelector('.transcript-text')?.textContent;
    const summaryTitle = document.querySelector('h3')?.textContent || 'AI Summary';
    if (summaryText) {
        const content = `${summaryTitle}\n\nGenerated: ${new Date().toLocaleString()}\n\n${summaryText.trim()}`;
        const blob = new Blob([content], { type: 'text/plain' });
        downloadFile(blob, `ai_studio_summary_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`);
        showAlert('AI summary downloaded!', 'success');
    }
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function clearResults() {
    const resultsContent = document.getElementById('resultsContent');
    if (resultsContent) {
        resultsContent.innerHTML = `
            <div class="empty-state">
                <p>Ready to process your content. Choose an option above to get started.</p>
            </div>
        `;
    }
    allTranscriptText = '';
    selectedSummaryType = null;
    if (isConverting) {
        stopLiveConversion();
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

function updateAuthUI() {
    const signInBtn = document.getElementById('signInBtn');
    const userMenuWrapper = document.getElementById('userMenuWrapper');
    const guestBanner = document.getElementById('guestBanner');
    const myMeetingsBtn = document.getElementById('myMeetingsBtn'); 

    if (currentUser) {
        if (signInBtn) signInBtn.style.display = 'none';
        if (userMenuWrapper) userMenuWrapper.style.display = 'block';
        if (guestBanner) guestBanner.classList.add('hidden');
        if (myMeetingsBtn) myMeetingsBtn.style.display = 'inline-block';
        const rawName = currentUser.user_metadata?.name || currentUser.email || 'User';
        const initials = rawName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const shortName = rawName.split(' ')[0] + ' ' + (rawName.split(' ')[1]?.[0] || '') ;
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const dropdownName = document.getElementById('dropdownName');
        const dropdownEmail = document.getElementById('dropdownEmail');
        if (userAvatar) userAvatar.textContent = initials;
        if (userName) userName.textContent = shortName.trim();
        if (dropdownName) dropdownName.textContent = rawName;
        if (dropdownEmail) dropdownEmail.textContent = currentUser.email || '';
    } else {
        if (signInBtn) signInBtn.style.display = 'block';
        if (userMenuWrapper) userMenuWrapper.style.display = 'none';
        if (guestBanner) guestBanner.classList.remove('hidden');
        if (myMeetingsBtn) myMeetingsBtn.style.display = 'none';
    }
}

async function handleSignIn() {
    if (!supabaseReady) { showAlert('Backend not configured yet - Supabase URL/key are still placeholders.', 'error'); return; }
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email || !password) { showAlert('Please fill in all fields.', 'error'); return; }
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { showAlert(error.message, 'error'); return; }
    currentUser = data.user;
    closeSignInModal();
    updateAuthUI();
    showAlert('Welcome back!', 'success');
}

async function handleSignUp() {
    if (!supabaseReady) { showAlert('Backend not configured yet  - Supabase URL/key are still placeholders.', 'error'); return; }
    const name = document.getElementById('authName').value.trim();
    const email = document.getElementById('authEmailUp').value.trim();
    const password = document.getElementById('authPasswordUp').value;
    if (!name || !email || !password) { showAlert('Please fill in all fields.', 'error'); return; }
    const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { name } } });
    if (error) { showAlert(error.message, 'error'); return; }
    currentUser = data.user;
    closeSignInModal();
    updateAuthUI();
    showAlert('Account created, do check your email to confirm.', 'success');
}

async function signOut() {
    if (supabaseReady) await supabaseClient.auth.signOut();
    currentUser = null;
    closeUserDropdown();
    updateAuthUI();
    showAlert('Signed out successfully.', 'info');
}

function showSignInModal() {
    document.getElementById('signInModal').classList.add('active');
    switchToSignIn();
}
function closeSignInModal() {
   document.getElementById('signInModal').classList.remove('active');
}
function switchToSignUp() {
    document.getElementById('signInForm').style.display = 'none';
    document.getElementById('signUpForm').style.display = 'block';
    document.getElementById('authModalTitle').textContent = 'Create account';
}
function switchToSignIn() {
    document.getElementById('signUpForm').style.display = 'none';
    document.getElementById('signInForm').style.display = 'block';
    document.getElementById('authModalTitle').textContent = 'Sign in';
}

function toggleUserDropdown() {
    document.getElementById('userDropdown').classList.toggle('open');
}

function closeUserDropdown() {
    document.getElementById('userDropdown').classList.remove('open');
}

document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('userMenuWrapper');
    if (wrapper && !wrapper.contains(e.target)) closeUserDropdown();
});

// Restore session on page load, only if Supabase is actually configured
if (supabaseReady) {
    supabaseClient.auth.getSession().then(({ data }) => {
        currentUser = data.session?.user || null;
        updateAuthUI();
    });
} else {
    updateAuthUI();
}

async function handleForgotPassword() {
    if (!supabaseReady) { showAlert('Backend not configured yet.', 'error'); return; }
    const email = document.getElementById('authEmail').value.trim();
    if (!email) {
        showAlert('Enter your email above first, then click "Forgot password?"', 'error');
        return;
    }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) { showAlert(error.message, 'error'); return; }
    showAlert('Password reset link sent! Check your email.', 'success');
}


async function loadDashboard() {
    const section = document.getElementById('dashboardSection');
    const content = document.getElementById('dashboardContent');
    section.style.display = 'block';
    smoothScrollTo(section);

    const { data: summaries } = await supabaseClient
        .from('summaries')
        .select('*')
        .order('created_at', { ascending: false });

    if (!summaries || summaries.length === 0) {
        content.innerHTML = `<div class="empty-state"><p>No MOMs generated yet. Generate one to see it here.</p></div>`;
        return;
    }

    const statsHtml = `
      <div class="dash-stats">
        <div class="dash-stat"><div class="dash-stat-label">MOMs generated</div><div class="dash-stat-value">${summaries.length}</div></div>
      </div>`;

    const cardsHtml = summaries.map(s => {
        const date = new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const time = new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const snippet = s.content.slice(0, 120);
        return `
        <div class="dash-card">
          <div class="dash-card-title">${s.title || 'MOM'}</div>
          <div class="dash-card-meta">${date} &middot; ${time}</div>
          <div class="dash-card-snippet">${snippet}…</div>
          <div class="dash-card-actions">
            <button class="btn btn-secondary" onclick="viewSavedSummary('${s.id}')">View</button>
            <button class="btn btn-secondary" onclick="deleteSummary('${s.id}')" style="color: var(--error); border-color: rgba(180, 35, 24, 0.35);">Delete</button>
          </div>
        </div>`;
    }).join('');

    content.innerHTML = statsHtml + `<div class="dash-grid">${cardsHtml}</div>`;
}

async function viewSavedSummary(id) {
    const { data } = await supabaseClient.from('summaries').select('*').eq('id', id).single();
    if (data) {
        document.getElementById('resultsContent').innerHTML = `
          <div class="summary-result">
            <div style="margin-bottom: 1.5rem;">
                <h3 style="color: var(--text-primary); margin: 0; font-size: 1.05rem;">${data.title}</h3>
            </div>
            <div class="transcript-text" style="white-space: pre-line;">${data.content}</div>
          </div>`;
        smoothScrollTo(document.querySelector('.results-container'));
    }
}

async function viewTranscript(id) {
    const { data } = await supabaseClient.from('transcripts').select('content').eq('id', id).single();
    if (data) {
        document.getElementById('resultsContent').innerHTML = `
          <div class="transcript-text">${data.content}</div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function generateFromSaved(id) {
    const { data } = await supabaseClient.from('transcripts').select('content').eq('id', id).single();
    if (data) {
        window.currentTranscript = data.content;
        showAISummaryModal();
    }
}
let lastTranscriptId = null;

async function saveTranscript(content, source) {
    if (!supabaseReady || !currentUser) return;
    const { data, error } = await supabaseClient
        .from('transcripts')
        .insert({ user_id: currentUser.id, content, source })
        .select()
        .single();
    if (!error && data) lastTranscriptId = data.id;
}

async function saveSummary(content, type, title) {
    if (!supabaseReady || !currentUser || !lastTranscriptId) return;
    await supabaseClient
        .from('summaries')
        .upsert({
            id: lastTranscriptId,
            user_id: currentUser.id,
            title: title || getTitleForType(type),
            content,
            source_type: type
        });
}
async function deleteSummary(id) {
    if (!confirm('Delete this MOM? This cannot be undone.')) return;
    const { error } = await supabaseClient.from('summaries').delete().eq('id', id);
    if (error) {
        showAlert('Failed to delete: ' + error.message, 'error');
        return;
    }
    showAlert('MOM deleted', 'success');
    loadDashboard();
}